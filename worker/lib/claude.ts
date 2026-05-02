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

export async function generateCommentReply(
  redditComment: {
    subreddit: string;
    author: string;
    content: string;
  },
  agentInstructions: string,
  claudeApiKey: string,
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages/create", {
    method: "POST",
    headers: {
      "x-api-key": claudeApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-7",
      max_tokens: 500,
      system: agentInstructions,
      messages: [
        {
          role: "user",
          content: `You are replying to a Reddit comment in r/${redditComment.subreddit} from user ${redditComment.author}.\n\nTheir comment:\n\n"${redditComment.content}"\n\nWrite a helpful, authentic reply that would fit naturally in Reddit. Keep it under 500 characters. Do not mention that you are an AI.`,
        },
      ],
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

export async function validateAgentInstructions(
  instructions: string,
  claudeApiKey: string,
): Promise<boolean> {
  try {
    // Test with a simple prompt to ensure the instructions are valid
    const response = await fetch("https://api.anthropic.com/v1/messages/create", {
      method: "POST",
      headers: {
        "x-api-key": claudeApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 100,
        system: instructions,
        messages: [
          {
            role: "user",
            content: "Say 'ready' if you understood your role.",
          },
        ],
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}
