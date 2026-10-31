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
  /** What the model is for, in the interface's own words. Left off the model
   * the application opens with: the default is stated by the selection, not
   * by a label. */
  tag?: string;
  enabled?: boolean;
};

/**
 * The models worth offering, and what each is for.
 *
 * The first entry is the one the composer opens with, so the default lives
 * here and nowhere else: no label on the picker row, no chip in the composer.
 *
 * The service's catalogue does not advertise `tools` for GPT-6 Luna, but it
 * was verified against the live API that the model emits real tool calls
 * with `finish_reason: "tool_calls"`, so it can drive the tool loop — trust
 * the API over the feature flags.
 */
export const MODELS: ModelOption[] = [
  {
    key: "openai/gpt-6-luna",
    name: "GPT-6 Luna",
    enabled: true,
  },
  {
    key: "z-ai/glm-5.3-flash",
    name: "GLM 5.3 Flash",
    tag: "Fast",
    enabled: true,
  },
  {
    key: "Qwen/Qwen3.8-27B",
    name: "Qwen 3.8 27B",
    tag: "Cheapest",
    enabled: false,
  },
  {
    key: "anthropic/claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    tag: "Strongest",
    enabled: false,
  },
];

export const DEFAULT_MODEL = "openai/gpt-6-luna";

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
