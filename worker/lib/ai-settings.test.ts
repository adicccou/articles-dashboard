import { describe, expect, it } from "vitest";
import {
  buildAiRulesText,
  DEFAULT_AI_MODEL,
  resolveAiSettings,
  resolveDefaultAiApiKey,
} from "./ai-settings";
import type { Env } from "./types";

function env(values: Partial<Env> = {}): Env {
  return values as Env;
}

describe("AI settings resolver", () => {
  it("uses the Oilor default API without exposing a custom key", () => {
    const resolved = resolveAiSettings(env({ OILOR_AI_API_KEY: "default-key" }), {
      ai_api_mode: "oilor_default",
      custom_ai_api_key: "custom-key",
      ai_model: "gemini-custom",
    });

    expect(resolved.aiApiMode).toBe("oilor_default");
    expect(resolved.geminiApiKey).toBe("default-key");
    expect(resolved.aiModel).toBe("gemini-custom");
    expect(resolved.customApiKeySaved).toBe(true);
    expect(resolved.defaultApiAvailable).toBe(true);
  });

  it("uses the custom key only when custom mode is selected", () => {
    const resolved = resolveAiSettings(env({ OILOR_AI_API_KEY: "default-key" }), {
      ai_api_mode: "custom",
      custom_ai_api_key: "custom-key",
    });

    expect(resolved.geminiApiKey).toBe("custom-key");
    expect(resolved.geminiFlashModel).toBe(DEFAULT_AI_MODEL);
    expect(resolved.geminiProModel).toBe(DEFAULT_AI_MODEL);
  });

  it("keeps the legacy Gemini key as the default fallback", () => {
    expect(resolveDefaultAiApiKey(env(), { gemini_api_key: "legacy-default" })).toBe("legacy-default");
  });

  it("formats global and social rules for callers that need both", () => {
    expect(buildAiRulesText({
      globalAiRules: "Always be accurate.",
      socialAgentRules: "No hype. No hashtags.",
    }, {
      includeSocial: true,
      globalHeading: "Global",
      socialHeading: "Social",
    })).toBe("Global:\nAlways be accurate.\n\nSocial:\nNo hype. No hashtags.");
  });
});
