import type { Env } from "../lib/types";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import { callAiText } from "../lib/ai";
import { formatGeminiUserError } from "../lib/gemini";
import { DEFAULT_USER_ID, ownerId, tableHasUserId } from "../lib/ownership";

type ReplyAiSettings = {
  geminiApiKey: string;
  geminiFlashModel: string;
  geminiProModel: string;
  globalAiRules: string;
};

type SuggestSocialReplyPayload = {
  platform?: string;
  post_preview?: string | null;
  post_title?: string | null;
  subreddit?: string | null;
  commenter_username?: string | null;
  commenter_name?: string | null;
  comment_text?: string | null;
};

const REPLY_CHAR_LIMITS: Record<string, number> = {
  twitter: 260,
  threads: 450,
  reddit: 700,
};

async function readReplyAiSettings(env: Env, userId = DEFAULT_USER_ID): Promise<ReplyAiSettings> {
  const hasUserId = await tableHasUserId(env, "app_settings");
  const rows = await env.DB.prepare(
    hasUserId
      ? "SELECT key, value FROM app_settings WHERE user_id = ? AND key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')"
      : "SELECT key, value FROM app_settings WHERE key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')",
  ).bind(...(hasUserId ? [ownerId(userId)] : [])).all<{ key: string; value: string }>();

  const settings: ReplyAiSettings = {
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

function normalizePlatform(value: string | null | undefined): "twitter" | "threads" | "reddit" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "twitter" || normalized === "x" || normalized === "twitter/x") return "twitter";
  if (normalized === "reddit") return "reddit";
  return "threads";
}

function cleanReplyText(value: string): string {
  return value
    .trim()
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "")
    .trim();
}

function clampReply(value: string, maxLength: number): string {
  const normalized = cleanReplyText(value).replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildFallbackReply(payload: SuggestSocialReplyPayload, platform: "twitter" | "threads" | "reddit"): string {
  const charLimit = REPLY_CHAR_LIMITS[platform] ?? 450;
  const commentText = String(payload.comment_text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const askedQuestion = commentText.includes("?") || /\b(why|what|how)\b/i.test(commentText);
  const supportive = /\b(exactly|true|same|agree|fair|right)\b/i.test(commentText);
  const mentionsSwitch = /\b(android|iphone|ios|switch)\b/i.test(commentText);

  const opening = supportive ? "Exactly." : askedQuestion ? "Fair question." : "Yeah.";
  const middle = mentionsSwitch
    ? "For me it is mostly about less lock-in and more control over how I use the phone day to day."
    : "For me it is mostly about having more control and more flexibility without being boxed into one setup.";
  const closing = supportive
    ? "That is what made the rough switch feel worth it."
    : "That is the freedom part for me.";

  return clampReply(`${opening} ${middle} ${closing}`, charLimit);
}

export async function suggestSocialReply(env: Env, request: Request, userId = DEFAULT_USER_ID): Promise<Response> {
  let payload: SuggestSocialReplyPayload | null = null;
  try {
    const settings = await readReplyAiSettings(env, userId);
    payload = await parseJson<SuggestSocialReplyPayload>(request);
    const platform = normalizePlatform(payload.platform);
    const commentText = String(payload.comment_text ?? "").trim();
    const postContext = String(payload.post_preview ?? payload.post_title ?? "").trim();
    const commenter = String(payload.commenter_username ?? payload.commenter_name ?? "").trim();
    const subreddit = String(payload.subreddit ?? "").trim();

    if (!commentText) {
      return errorResponse("comment_text is required", 400);
    }

    const charLimit = REPLY_CHAR_LIMITS[platform] ?? 450;
    if (!settings.geminiApiKey) {
      return jsonResponse({ reply_text: buildFallbackReply(payload, platform) });
    }

    const replyText = await callAiText({
      apiKey: settings.geminiApiKey,
      model: settings.geminiProModel,
      fallbackModel: settings.geminiFlashModel,
      maxTokens: 220,
      system: [
        "You write natural social media replies for the account owner.",
        "Use the owner's original post and the incoming comment to draft one reply.",
        "Keep it human, calm, specific, and easy to post as-is.",
        "Do not sound like customer support or an AI assistant.",
        "Do not use markdown, labels, bullet points, or surrounding quotation marks.",
        `Return only the reply text, and keep it under ${charLimit} characters.`,
        settings.globalAiRules?.trim() ? `Global rules:\n${settings.globalAiRules.trim()}` : "",
      ].filter(Boolean).join("\n\n"),
      messages: [
        {
          role: "user",
          content: [
            `Platform: ${platform}`,
            postContext ? `Original post:\n${postContext}` : "Original post:\nNo original post text was available. Infer the topic from the comment only when needed.",
            subreddit ? `Subreddit:\n${subreddit}` : "",
            commenter ? `Comment author:\n${commenter}` : "",
            `Incoming comment:\n${commentText}`,
            "Write one strong reply from the owner's perspective.",
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });

    return jsonResponse({ reply_text: cleanReplyText(replyText) });
  } catch (error) {
    if (payload) {
      const platform = normalizePlatform(payload.platform);
      return jsonResponse({ reply_text: buildFallbackReply(payload, platform) });
    }
    return errorResponse(formatGeminiUserError(error), 500);
  }
}
