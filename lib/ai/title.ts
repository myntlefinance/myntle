import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { nearAI } from "@/lib/ai/provider";

/**
 * The model writes inside these limits and its answer is checked against
 * them. Nothing is ever cut to fit: a title that breaks a rule goes back
 * to the model, because slicing produced titles like "Check NEAR balance
 * and" where the conjunction outlived the words that completed it.
 */
export const TITLE_MAX_WORDS = 4;
export const TITLE_MAX_CHARS = 35;

const TITLE_SYSTEM = [
  "Write the title for a finance chat.",
  "",
  "The title must follow every rule:",
  `- At most ${TITLE_MAX_WORDS} words and ${TITLE_MAX_CHARS} characters.`,
  "- Plain text: no quotes, no emoji, no trailing period.",
  "- Name the action and the assets, nothing else.",
  "- Never end on a conjunction, article, or preposition. If the full phrase does not fit, choose shorter wording; the title is never cut.",
  "",
  'Good: "Swap USDC for NEAR"',
  'Good: "Check NEAR balance"',
  'Good: "Bridge USDC to Base"',
  "",
  "Return the title only.",
].join("\n");

const TITLE_MAX_TOKENS = 200;
const TIER_TIMEOUT_MS = 8000;

/** Words that cannot close a title because they leave the thought open. */
const TRAILING_CONNECTORS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "onto",
  "or",
  "over",
  "than",
  "the",
  "to",
  "under",
  "vs",
  "with",
]);

/** Strip the wrappers a model adds around an otherwise plain title. */
function sanitizeTitle(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+/, "")
    .replace(/[.…"'“”‘’]+$/, "")
    .trim();
}

/**
 * Why a title cannot be stored, or null when it can. The caller feeds the
 * reason back to the model instead of cutting the title down.
 */
export function titleProblem(raw: string): string | null {
  const title = sanitizeTitle(raw);
  if (!title) return "the answer was empty";
  const words = title.split(" ");
  if (words.length > TITLE_MAX_WORDS) {
    return `it has ${words.length} words, and the limit is ${TITLE_MAX_WORDS}`;
  }
  if (title.length > TITLE_MAX_CHARS) {
    return `it has ${title.length} characters, and the limit is ${TITLE_MAX_CHARS}`;
  }
  const last = words[words.length - 1].toLowerCase().replace(/[^a-z0-9]/g, "");
  if (TRAILING_CONNECTORS.has(last)) {
    return `it ends on "${last}", which leaves the phrase unfinished`;
  }
  return null;
}

/**
 * Clean model output into a title, or null when it broke a rule. Null
 * moves the chain to the next attempt or tier; it never stores a partial
 * title.
 */
export function cleanTitle(raw: string): string | null {
  const title = sanitizeTitle(raw);
  return titleProblem(title) === null ? title : null;
}

function nearTitleModel(): string {
  return process.env.TITLE_MODEL_NEAR?.trim() || "openai/gpt-6-luna";
}

function openRouterFallbackModels(): string[] {
  return [process.env.TITLE_MODEL_FALLBACK_1, process.env.TITLE_MODEL_FALLBACK_2]
    .map((m) => m?.trim() ?? "")
    .filter((m) => m.length > 0);
}

async function requestTitle(
  model: ReturnType<typeof nearAI>,
  providerOptions: Parameters<typeof generateText>[0]["providerOptions"],
  prompt: string,
): Promise<string | null> {
  try {
    const { text } = await generateText({
      model,
      system: TITLE_SYSTEM,
      prompt,
      maxOutputTokens: TITLE_MAX_TOKENS,
      abortSignal: AbortSignal.timeout(TIER_TIMEOUT_MS),
      // No temperature: Luna rejects anything but the default. Reasoning
      // is disabled instead — verified against the live API, which
      // answers with zero reasoning tokens when the flag is set.
      providerOptions,
    });
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

function correctionPrompt(prompt: string, raw: string): string {
  return [
    prompt.slice(0, 500),
    "",
    `Your previous title was "${sanitizeTitle(raw).slice(0, 120)}".`,
    `It is not usable because ${titleProblem(raw)}.`,
    `Write the title again inside every rule: at most ${TITLE_MAX_WORDS} words, at most ${TITLE_MAX_CHARS} characters, and never end on a conjunction, article, or preposition. Return the title only.`,
  ].join("\n");
}

async function tryTier(
  model: ReturnType<typeof nearAI>,
  providerOptions: Parameters<typeof generateText>[0]["providerOptions"],
  prompt: string,
): Promise<string | null> {
  const raw = await requestTitle(model, providerOptions, prompt.slice(0, 500));
  if (!raw) return null;
  const title = cleanTitle(raw);
  if (title) return title;
  // One corrective turn with the exact violation. If it still breaks the
  // rules, the tier is a failure and the next one tries.
  const retried = await requestTitle(
    model,
    providerOptions,
    correctionPrompt(prompt, raw),
  );
  return retried ? cleanTitle(retried) : null;
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
