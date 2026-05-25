import type { Env } from "../lib/types";
import { errorResponse, jsonResponse, parseJson } from "../lib/http";
import { callAiText } from "../lib/ai";
import { formatGeminiUserError } from "../lib/gemini";
import { DEFAULT_USER_ID, ownerId, tableHasUserId, tableHasWorkspaceId, workspaceId } from "../lib/ownership";

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
  const hasWorkspaceId = await tableHasWorkspaceId(env, "app_settings");
  const hasUserId = await tableHasUserId(env, "app_settings");
  const rows = await env.DB.prepare(
    hasWorkspaceId
      ? "SELECT key, value FROM app_settings WHERE workspace_id = ? AND key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')"
      : hasUserId
      ? "SELECT key, value FROM app_settings WHERE user_id = ? AND key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')"
      : "SELECT key, value FROM app_settings WHERE key IN ('gemini_api_key', 'gemini_flash_model', 'gemini_pro_model', 'global_ai_rules')",
  ).bind(...(hasWorkspaceId ? [workspaceId(userId)] : hasUserId ? [ownerId(userId)] : [])).all<{ key: string; value: string }>();

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

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function detectReplyTopic(postContext: string, commentText: string): "feed_curation" | "phone_switch" | "trading_journal" | "generic" {
  const combined = `${postContext} ${commentText}`.toLowerCase();
  if (/\b(feed|curat|mute|block|junk|garbage|algo|algorithm|following|follow list|high-quality content|search)\b/i.test(combined)) {
    return "feed_curation";
  }
  if (/\b(android|iphone|ios|switch|pixel|samsung|oneplus|locked in|lock-in)\b/i.test(combined)) {
    return "phone_switch";
  }
  if (/\b(trade|trades|trading|journal|pnl|setup|setups|discipline|performance|reviewing)\b/i.test(combined)) {
    return "trading_journal";
  }
  return "generic";
}

function buildFallbackReply(payload: SuggestSocialReplyPayload, platform: "twitter" | "threads" | "reddit"): string {
  const charLimit = REPLY_CHAR_LIMITS[platform] ?? 450;
  const postContext = normalizeText(payload.post_preview ?? payload.post_title ?? "");
  const commentText = normalizeText(payload.comment_text ?? "");
  const lowerComment = commentText.toLowerCase();
  const askedQuestion = commentText.includes("?") || /\b(why|what|how|does|still works|really)\b/i.test(commentText);
  const skeptical = /\b(still works|hasn'?t|doesn'?t|not for me|really\?)\b/i.test(lowerComment);
  const supportive = /\b(exactly|true|same|agree|fair|right)\b/i.test(lowerComment);
  const topic = detectReplyTopic(postContext, commentText);

  if (topic === "feed_curation") {
    if (skeptical || askedQuestion) {
      return clampReply(
        "Yeah, but not on its own. What helps me more now is muting fast, hiding junk immediately, and rebuilding the feed around a small set of high-signal accounts instead of trusting the default feed.",
        charLimit,
      );
    }
    return clampReply(
      "Same here. The only thing that helps me is being ruthless with mutes and hides, then rebuilding around a small set of solid accounts. The default feed alone is still messy.",
      charLimit,
    );
  }

  if (topic === "phone_switch") {
    if (skeptical || askedQuestion) {
      return clampReply(
        "For me it still does, but not instantly. The big win was less lock-in, easier file access, and more control over the device once I cleaned up the setup.",
        charLimit,
      );
    }
    return clampReply(
      "Yeah, that was the main upside for me too. Once I got past the setup friction, the extra control and less lock-in made the switch feel worth it.",
      charLimit,
    );
  }

  if (topic === "trading_journal") {
    if (skeptical || askedQuestion) {
      return clampReply(
        "Only when I actually review the trades after logging them. If it is just a diary, not really. The value for me comes from spotting repeated mistakes and fixing them.",
        charLimit,
      );
    }
    return clampReply(
      "Exactly. The logging alone is not the point for me. The useful part is reviewing setups and catching the same bad habits before they repeat.",
      charLimit,
    );
  }

  if (supportive) {
    return clampReply(
      "Exactly. That is usually the difference for me too once I get more specific about what is actually working and what is just noise.",
      charLimit,
    );
  }

  if (skeptical || askedQuestion) {
    return clampReply(
      "Fair question. For me it only works when I stay pretty deliberate with it and adjust quickly when the obvious approach stops helping.",
      charLimit,
    );
  }

  return clampReply(
    "Yeah, that has been my experience too. It works a lot better once I stop relying on one default approach and get more deliberate about what I keep using.",
    charLimit,
  );
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
        "Stay strictly inside the topic of that exact post and that exact comment.",
        "Answer what the commenter is actually reacting to before adding any extra context.",
        "If the commenter questions whether something still works, answer that directly.",
        "Never reuse canned phrasing from a different conversation or topic.",
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
