export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface ClaudeTextRequest {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  messages: ClaudeMessage[];
}

export async function callClaudeText({
  apiKey,
  model,
  maxTokens,
  system,
  messages,
}: ClaudeTextRequest): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} ${error}`);
  }

  const data = (await response.json()) as ClaudeResponse;
  const firstContent = data.content[0];

  if (!firstContent || firstContent.type !== "text") {
    throw new Error("Unexpected Claude API response format");
  }

  return firstContent.text;
}

export async function generateCommentReply(
  redditComment: {
    subreddit: string;
    author: string;
    content: string;
  },
  agentInstructions: string,
  claudeApiKey: string,
): Promise<string> {
  return callClaudeText({
    apiKey: claudeApiKey,
    model: "claude-sonnet-4-20250514",
    maxTokens: 500,
    system: agentInstructions,
    messages: [
      {
        role: "user",
        content: `You are replying to a Reddit comment in r/${redditComment.subreddit} from user ${redditComment.author}.\n\nTheir comment:\n\n"${redditComment.content}"\n\nWrite a helpful, authentic reply that would fit naturally in Reddit. Keep it under 500 characters. Do not mention that you are an AI.`,
      },
    ],
  });
}

export async function validateAgentInstructions(
  instructions: string,
  claudeApiKey: string,
): Promise<boolean> {
  try {
    await callClaudeText({
      apiKey: claudeApiKey,
      model: "claude-sonnet-4-20250514",
      maxTokens: 100,
      system: instructions,
      messages: [
        {
          role: "user",
          content: "Say 'ready' if you understood your role.",
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}
