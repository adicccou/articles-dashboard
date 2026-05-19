export interface GeminiMessage {
  role: "user" | "assistant";
  content: string;
}

export class GeminiApiError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "GeminiApiError";
    this.statusCode = statusCode;
  }
}

export class GeminiRateLimitError extends GeminiApiError {
  constructor(message: string, statusCode = 429) {
    super(message, statusCode);
    this.name = "GeminiRateLimitError";
  }
}

export class GeminiBillingError extends GeminiApiError {
  constructor(message: string, statusCode = 429) {
    super(message, statusCode);
    this.name = "GeminiBillingError";
  }
}

interface GeminiTextRequest {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  messages: GeminiMessage[];
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  promptFeedback?: unknown;
};

type GeminiErrorResponse = {
  error?: {
    status?: string;
    message?: string;
  };
};

function isBillingOrCreditError(message: string): boolean {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const billingTerms = ["billing", "prepayment", "credit", "credits", "quota project"];
  const depletionTerms = ["depleted", "exhausted", "not enough", "insufficient", "payment"];
  return billingTerms.some((term) => normalized.includes(term)) &&
    depletionTerms.some((term) => normalized.includes(term));
}

async function readGeminiErrorText(response: Response): Promise<string> {
  const body = await response.text();
  if (!body.trim()) return "";
  try {
    const parsed = JSON.parse(body) as GeminiErrorResponse;
    const status = parsed.error?.status?.trim() ?? "";
    const message = parsed.error?.message?.trim() ?? "";
    return [status, message].filter(Boolean).join(" ");
  } catch {
    return body.trim();
  }
}

export interface ParsedStrategy {
  hard_rules: {
    bias_timeframe: string;
    entry_timeframe: string;
    required_sessions: string[];
    must_have_confirmations: string[];
    invalidations: string[];
  };
  soft_preferences: {
    favored_assets: string[];
    minimum_rr: number;
  };
  understanding_summary: string;
}

export async function callGeminiText({
  apiKey,
  model,
  maxTokens,
  system,
  messages,
}: GeminiTextRequest): Promise<string> {
  const body = JSON.stringify({
    systemInstruction: system
      ? {
          role: "system",
          parts: [{ text: system }],
        }
      : undefined,
    contents: messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.3,
    },
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
        body,
      },
    );

    if (!response.ok) {
      const errorText = await readGeminiErrorText(response);
      if (isBillingOrCreditError(errorText)) {
        throw new GeminiBillingError(`Gemini billing or credits unavailable for model ${model}: ${errorText}`, response.status);
      }

      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
        const retryAfter = response.headers.get("retry-after");
        const retryMs = retryAfter ? Number.parseFloat(retryAfter) * 1000 : (attempt + 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, Math.min(Number.isFinite(retryMs) ? retryMs : 1000, 5000)));
        continue;
      }

      if (response.status === 429) {
        throw new GeminiRateLimitError(`Gemini rate limit reached for model ${model}: ${errorText}`);
      }

      throw new GeminiApiError(`Gemini API request failed for model ${model}: ${errorText}`, response.status);
    }

    const data = (await response.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").filter(Boolean).join("\n").trim();
    if (!text) {
      throw new GeminiApiError(
        `Unexpected Gemini API response format${data.promptFeedback ? `: ${JSON.stringify(data.promptFeedback)}` : ""}`,
      );
    }

    return text;
  }

  throw new GeminiApiError(`Gemini request failed after retries for model ${model}.`);
}

export function formatGeminiUserError(error: unknown): string {
  if (error instanceof GeminiBillingError) {
    return "AI is not available because the connected Gemini project has no prepaid credits or billing quota left. Add credits/billing in Google AI Studio, or switch the dashboard to a Gemini API key from a project with credits.";
  }
  if (error instanceof GeminiRateLimitError) {
    return "AI is busy right now because the Gemini request limit was hit. Please wait a minute and try again.";
  }
  if (error instanceof GeminiApiError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return "AI is not available right now because the Gemini API key or project access is invalid.";
    }
    return "AI is temporarily unavailable right now. Please try again shortly.";
  }
  return "AI could not answer right now. Please try again shortly.";
}

export async function parseTradingStrategyToJSON(
  strategyText: string,
  geminiApiKey: string,
  model = "gemini-3.1-pro-preview",
): Promise<ParsedStrategy> {
  const systemPrompt = `You are an expert trading system parser. Your job is to read raw prose strategy instructions and extract them into a strict JSON playbook.
Do not output anything other than raw JSON.
You must return the JSON matching this exact structure:
{
  "hard_rules": {
    "bias_timeframe": "string (e.g. 4H, 1D, None)",
    "entry_timeframe": "string (e.g. 15M, 5M)",
    "required_sessions": ["string"],
    "must_have_confirmations": ["string"],
    "invalidations": ["string"]
  },
  "soft_preferences": {
    "favored_assets": ["string"],
    "minimum_rr": number
  },
  "understanding_summary": "string"
}
For the understanding_summary, write a single clear sentence summarizing what the strategy looks for.`;

  const responseText = await callGeminiText({
    apiKey: geminiApiKey,
    model,
    maxTokens: 1000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Parse the following strategy:\n\n${strategyText}`,
      },
    ],
  });

  try {
    const jsonStr = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr) as ParsedStrategy;
  } catch (error) {
    throw new Error(`Failed to parse Gemini output as JSON: ${error}\nRaw output: ${responseText}`);
  }
}
