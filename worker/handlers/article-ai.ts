import { callAiText } from "../lib/ai";
import { callGeminiImage, formatGeminiUserError } from "../lib/gemini";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import type { Env } from "../lib/types";

type ArticleAssistField = "meta_title" | "meta_description" | "excerpt" | "category";

type ArticleAssistPayload = {
  field: ArticleAssistField;
  title?: string;
  content?: string;
  excerpt?: string;
  category?: string;
  site_names?: string[];
  site_domains?: string[];
  categories?: string[];
};

type ArticleCoverPayload = Omit<ArticleAssistPayload, "field"> & {
  cover_style_reference?: string;
};

type ArticleStylePayload = Omit<ArticleAssistPayload, "field">;

type AiSettings = {
  geminiApiKey: string;
  geminiFlashModel: string;
  geminiProModel: string;
  globalAiRules: string;
};

async function readAiSettings(env: Env): Promise<AiSettings> {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM app_settings WHERE key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')",
  ).all<{ key: string; value: string }>();

  const settings: AiSettings = {
    geminiApiKey: "",
    geminiFlashModel: "gemini-3.1-flash-preview",
    geminiProModel: "gemini-3.1-pro-preview",
    globalAiRules: "",
  };

  for (const row of rows.results ?? []) {
    if (row.key === "gemini_api_key" && row.value) settings.geminiApiKey = row.value;
    if (row.key === "gemini_flash_model" && row.value) settings.geminiFlashModel = row.value;
    if (row.key === "gemini_pro_model" && row.value) settings.geminiProModel = row.value;
    if (row.key === "global_ai_rules" && row.value) settings.globalAiRules = row.value;
  }

  return settings;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clampText(value: string | undefined, limit: number): string {
  const cleaned = stripHtml(value ?? "");
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}...` : cleaned;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response did not include JSON.");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function articleContext(payload: Omit<ArticleAssistPayload, "field">): string {
  return [
    `Title: ${payload.title?.trim() || "Untitled"}`,
    `Selected websites: ${(payload.site_names ?? []).join(", ") || "Not selected"}`,
    `Website domains: ${(payload.site_domains ?? []).join(", ") || "Not selected"}`,
    `Current category: ${payload.category?.trim() || "Not set"}`,
    `Current excerpt: ${payload.excerpt?.trim() || "Not set"}`,
    `Available categories: ${(payload.categories ?? []).join(", ") || "None"}`,
    `Article text: ${clampText(payload.content, 8000) || "No article text provided."}`,
  ].join("\n");
}

function fieldRules(field: ArticleAssistField): string {
  if (field === "meta_title") {
    return "Return the best SEO meta title. Keep it punchy, human, and 45-60 characters when possible.";
  }
  if (field === "meta_description") {
    return "Return the best SEO meta description. Keep it specific, readable, and 140-160 characters when possible.";
  }
  if (field === "excerpt") {
    return "Return a clear article excerpt for cards and previews. One sentence, 120-180 characters.";
  }
  return "Return the best category name. Prefer one existing category if it fits; otherwise return a concise new category name.";
}

function sanitizeStyleAttribute(value: string): string {
  const allowedProperties = new Set([
    "background-color",
    "color",
    "font-style",
    "font-weight",
    "text-decoration",
  ]);

  return value
    .split(";")
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => {
      const separatorIndex = rule.indexOf(":");
      if (separatorIndex === -1) return "";
      const property = rule.slice(0, separatorIndex).trim().toLowerCase();
      const rawValue = rule.slice(separatorIndex + 1).trim();
      if (!allowedProperties.has(property)) return "";
      if (/url\s*\(|expression\s*\(|javascript:/i.test(rawValue)) return "";
      return `${property}: ${rawValue}`;
    })
    .filter(Boolean)
    .join("; ");
}

function sanitizeHref(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return trimmed.replace(/"/g, "%22");
  }
  return "";
}

function sanitizeEditorHtml(html: string): string {
  const allowedTags = new Set([
    "a",
    "blockquote",
    "br",
    "em",
    "h2",
    "h3",
    "li",
    "ol",
    "p",
    "span",
    "strong",
    "u",
    "ul",
  ]);

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tagName, rawAttrs) => {
      const tag = String(tagName).toLowerCase();
      const closing = match.startsWith("</");
      const normalizedTag = tag === "b" ? "strong" : tag === "i" ? "em" : tag;

      if (!allowedTags.has(normalizedTag)) return "";
      if (closing) return normalizedTag === "br" ? "" : `</${normalizedTag}>`;
      if (normalizedTag === "br") return "<br>";

      const attrs = String(rawAttrs ?? "");
      if (normalizedTag === "a") {
        const hrefMatch = attrs.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        const href = sanitizeHref(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "");
        return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : "<a>";
      }

      if (normalizedTag === "span") {
        const styleMatch = attrs.match(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        const style = sanitizeStyleAttribute(styleMatch?.[1] ?? styleMatch?.[2] ?? "");
        return style ? `<span style="${style}">` : "<span>";
      }

      return `<${normalizedTag}>`;
    })
    .replace(/\s+\n/g, "\n")
    .trim();
}

export async function suggestArticleField(env: Env, request: Request): Promise<Response> {
  try {
    const settings = await readAiSettings(env);
    if (!settings.geminiApiKey) {
      return errorResponse("No Gemini API key is configured", 500);
    }

    const payload = await parseJson<ArticleAssistPayload>(request);
    if (!["meta_title", "meta_description", "excerpt", "category"].includes(payload.field)) {
      return errorResponse("Invalid autofill field", 400);
    }

    const responseText = await callAiText({
      apiKey: settings.geminiApiKey,
      model: settings.geminiFlashModel,
      fallbackModel: settings.geminiProModel,
      maxTokens: 500,
      system: [
        "You are an expert editor for a founder-run marketing dashboard.",
        "Read the article and generate one precise field value.",
        "Return raw JSON only, exactly: {\"value\":\"...\"}.",
        settings.globalAiRules ? `Global AI rules: ${settings.globalAiRules}` : "",
      ].filter(Boolean).join("\n"),
      messages: [
        {
          role: "user",
          content: `${fieldRules(payload.field)}\n\n${articleContext(payload)}`,
        },
      ],
    });

    const parsed = parseJsonObject(responseText);
    const value = typeof parsed.value === "string" ? parsed.value.trim() : "";
    if (!value) {
      return errorResponse("AI did not return a usable value.", 502);
    }

    return jsonResponse({ value });
  } catch (error) {
    return errorResponse(formatGeminiUserError(error), 500);
  }
}

export async function styleArticleContent(env: Env, request: Request): Promise<Response> {
  try {
    const settings = await readAiSettings(env);
    if (!settings.geminiApiKey) {
      return errorResponse("No Gemini API key is configured", 500);
    }

    const payload = await parseJson<ArticleStylePayload>(request);
    if (!stripHtml(payload.content ?? "")) {
      return errorResponse("Article content is required before styling.", 400);
    }

    const responseText = await callAiText({
      apiKey: settings.geminiApiKey,
      model: settings.geminiProModel,
      fallbackModel: settings.geminiFlashModel,
      maxTokens: 5000,
      system: [
        "You are a senior web editor inside a marketing dashboard.",
        "Style article body HTML for readability using only editor-compatible rich text.",
        "Allowed output tags: p, h2, h3, ul, ol, li, blockquote, strong, em, u, a, span, br.",
        "Do not use h1 because the title field already exists. Do not include images, tables, scripts, iframes, classes, ids, markdown, or a full HTML document.",
        "Do not invent facts, numbers, names, links, quotes, claims, or conclusions. Preserve the article's meaning and voice.",
        "Improve structure only: split long paragraphs, add useful h2/h3 headings when the article clearly supports them, turn obvious sequences into lists, lightly bold important phrases, and use blockquotes only for existing standout lines.",
        "Return raw JSON only, exactly: {\"html\":\"<p>...</p>\"}.",
        settings.globalAiRules ? `Global AI rules: ${settings.globalAiRules}` : "",
      ].filter(Boolean).join("\n"),
      messages: [
        {
          role: "user",
          content: [
            "Style this article body for best web readability.",
            "Keep the result polished but not overdesigned.",
            articleContext(payload),
          ].join("\n\n"),
        },
      ],
    });

    const parsed = parseJsonObject(responseText);
    const rawHtml = typeof parsed.html === "string" ? parsed.html.trim() : "";
    const html = sanitizeEditorHtml(rawHtml);
    if (!stripHtml(html)) {
      return errorResponse("AI did not return usable styled content.", 502);
    }

    return jsonResponse({ html });
  } catch (error) {
    return errorResponse(formatGeminiUserError(error), 500);
  }
}

export async function generateArticleCover(env: Env, request: Request): Promise<Response> {
  try {
    const settings = await readAiSettings(env);
    if (!settings.geminiApiKey) {
      return errorResponse("No Gemini API key is configured", 500);
    }

    const payload = await parseJson<ArticleCoverPayload>(request);
    const siteNames = (payload.site_names ?? []).join(", ") || "the selected website";
    const siteDomains = (payload.site_domains ?? []).join(", ") || "no domain provided";
    const imagePrompt = [
      "Create a professional web article hero image.",
      "Format: wide 16:9 landscape hero, optimized for web article cards and headers, target 1280x720 feel.",
      "Composition reference: bold editorial trading/finance hero image with large clear focal subject, dark cinematic background, energetic green accent highlights, charts or product-relevant visual motifs, and strong depth.",
      "Do not include distorted tiny labels, fake UI text, watermarks, brand logos you do not know, or unreadable text blocks.",
      `Website style and branding context: ${siteNames}; domains: ${siteDomains}.`,
      payload.cover_style_reference ? `User style reference: ${payload.cover_style_reference}` : "",
      `Article context:\n${articleContext(payload)}`,
    ].filter(Boolean).join("\n");

    const image = await callGeminiImage({
      apiKey: settings.geminiApiKey,
      model: "gemini-3.1-flash-image-preview",
      prompt: imagePrompt,
      aspectRatio: "16:9",
      imageSize: "1K",
    });

    const extension = image.mimeType.includes("jpeg") || image.mimeType.includes("jpg") ? "jpg" : "png";
    const key = `generated/article-covers/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const bytes = Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0));

    await env.MEDIA_BUCKET.put(key, bytes, {
      httpMetadata: {
        contentType: image.mimeType,
      },
    });

    const publicBaseUrl = env.PUBLIC_MEDIA_BASE_URL ?? "/api/media/";
    const url = publicBaseUrl.startsWith("http")
      ? `${publicBaseUrl.replace(/\/$/, "")}/${key}`
      : `${new URL(publicBaseUrl + key, request.url).toString()}`;

    return jsonResponse({
      key,
      url,
      mime_type: image.mimeType,
      prompt: imagePrompt,
      model: "gemini-3.1-flash-image-preview",
      aspect_ratio: "16:9",
      image_size: "1K",
      note: image.text,
    });
  } catch (error) {
    return errorResponse(formatGeminiUserError(error), 500);
  }
}
