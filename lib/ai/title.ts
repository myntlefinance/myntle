import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { nearAI } from "@/lib/ai/provider";

/** Generated titles are at most four words and fit the sidebar whole. */
export const TITLE_MAX_WORDS = 4;
export const TITLE_MAX_CHARS = 35;

const TITLE_SYSTEM =
  "Write a chat title for this finance request. At most 4 words and 35 characters, plain text, no quotes, no emoji, no trailing period. Name the action and the assets, nothing else.";
const TITLE_MAX_TOKENS = 200;
const TIER_TIMEOUT_MS = 8000;

/**
 * Clean model output into a title, or null when there is nothing usable.
 * Empty text is a failure, not a title: it moves the chain to the next
 * tier instead of falling back to the raw prompt.
 */
export function cleanTitle(raw: string): string | null {
  const words = raw
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, TITLE_MAX_WORDS)
    .join(" ");
  if (!words) return null;
  return words.length > TITLE_MAX_CHARS
    ? words.slice(0, TITLE_MAX_CHARS).trimEnd()
    : words;
}

function nearTitleModel(): string {
  return process.env.TITLE_MODEL_NEAR?.trim() || "openai/gpt-6-luna";
}

function openRouterFallbackModels(): string[] {
  return [process.env.TITLE_MODEL_FALLBACK_1, process.env.TITLE_MODEL_FALLBACK_2]
    .map((m) => m?.trim() ?? "")
    .filter((m) => m.length > 0);
}

async function tryTier(
  model: ReturnType<typeof nearAI>,
  providerOptions: Parameters<typeof generateText>[0]["providerOptions"],
  prompt: string,
): Promise<string | null> {
  try {
    const { text } = await generateText({
      model,
      system: TITLE_SYSTEM,
      prompt: prompt.slice(0, 500),
      maxOutputTokens: TITLE_MAX_TOKENS,
      abortSignal: AbortSignal.timeout(TIER_TIMEOUT_MS),
      // No temperature: Luna rejects anything but the default. Reasoning
      // is disabled instead — verified against the live API, which
      // answers with zero reasoning tokens when the flag is set.
      providerOptions,
    });
    return cleanTitle(text);
  } catch {
    return null;
  }
}

/**
 * NEAR first, then the OpenRouter fallbacks in order. Returns null when
 * every tier fails; the caller keeps "New chat" and retries next turn.
 */
export async function generateTitle(prompt: string): Promise<string | null> {
  if (process.env.NEAR_AI_CLOUD_API_KEY) {
    const title = await tryTier(
      nearAI(nearTitleModel()),
      { nearAiCloud: { reasoningEffort: "none" } },
      prompt,
    );
    if (title) return title;
  }
  if (process.env.OPENROUTER_API_KEY) {
    const openRouter = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    for (const modelId of openRouterFallbackModels()) {
      const title = await tryTier(
        openRouter(modelId),
        {
          openrouter: {
            reasoningEffort: "none",
            reasoning: { enabled: false },
          },
        },
        prompt,
      );
      if (title) return title;
    }
  }
  return null;
}
