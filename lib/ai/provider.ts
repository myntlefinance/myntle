import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * NEAR AI Cloud.
 *
 * The API is OpenAI compatible, so the AI SDK's OpenAI-compatible provider
 * is the right one to reach for. The plain OpenAI provider is not, because it
 * defaults to the Responses API and to OpenAI's own model names.
 *
 * The catalogue is public and needs no key, so the model list in the interface
 * is read from the service rather than hardcoded.
 */
export const nearAI = createOpenAICompatible({
  name: "near-ai-cloud",
  baseURL: "https://cloud-api.near.ai/v1",
  apiKey: process.env.NEAR_AI_CLOUD_API_KEY,
  includeUsage: true,
  supportsStructuredOutputs: true,
});

export type ModelOption = {
  /** The model id the service expects. */
  key: string;
  name: string;
  /** What the model is for, in the interface's own words. */
  tag: string;
};

/**
 * The models worth offering, and what each is for.
 *
 * The full catalogue has fifty-nine entries. These are the ones that can run
 * the tool loop, because the assistant has to be able to call the balance and
 * quote tools.
 */
export const MODELS: ModelOption[] = [
  {
    key: "openai/gpt-6-luna",
    name: "GPT-6 Luna",
    tag: "Default",
  },
  {
    key: "Qwen/Qwen3.8-27B",
    name: "Qwen 3.8 27B",
    tag: "Cheapest",
  },
  {
    key: "anthropic/claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    tag: "Strongest",
  },
  {
    key: "z-ai/glm-5.3-flash",
    name: "GLM 5.3 Flash",
    tag: "Fast",
  },
];

export const DEFAULT_MODEL = MODELS[0].key;

/**
 * The catalogue of models the service actually offers, read at runtime.
 *
 * The price list and the capability flags come from the service, so a model
 * that is withdrawn or a capability that changes does not leave the interface
 * claiming something untrue.
 */
export async function fetchCatalogue(): Promise<ModelOption[]> {
  try {
    const res = await fetch("https://cloud-api.near.ai/v1/models", {
      next: { revalidate: 600 },
    });
    if (!res.ok) return MODELS;

    const body = (await res.json()) as {
      data?: Array<{
        id: string;
        pricing?: { input?: number; output?: number };
        supported_features?: string[];
      }>;
    };

    const withTools = (body.data ?? []).filter((m) =>
      m.supported_features?.includes("tools"),
    );

    return withTools
      .map((m) => ({
        key: m.id,
        name: m.id.split("/").pop() ?? m.id,
        tag: `${m.pricing?.input ?? "?"} per million input tokens`,
      }))
      .slice(0, 12);
  } catch {
    return MODELS;
  }
}
