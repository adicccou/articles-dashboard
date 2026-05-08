export interface GeminiMessage {
  role: "user" | "assistant";
  content: string;
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
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
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
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${error}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").filter(Boolean).join("\n").trim();
  if (!text) {
    throw new Error(
      `Unexpected Gemini API response format${data.promptFeedback ? `: ${JSON.stringify(data.promptFeedback)}` : ""}`,
    );
  }

  return text;
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
