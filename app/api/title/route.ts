import { generateText } from "ai";
import { nearAI } from "@/lib/ai/provider";

export const TITLE_MAX = 84;
const TITLE_MODEL = "z-ai/glm-5.3-flash";

function cleanTitle(raw: string, fallback: string): string {
  const collapsed = raw
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const base = collapsed || fallback;
  return base.length > TITLE_MAX ? `${base.slice(0, TITLE_MAX).trimEnd()}` : base;
}

function fallbackTitle(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  return collapsed.length > TITLE_MAX
    ? `${collapsed.slice(0, TITLE_MAX).trimEnd()}…`
    : collapsed || "New chat";
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const prompt =
    typeof (raw as { prompt?: unknown })?.prompt === "string"
      ? ((raw as { prompt: string }).prompt ?? "")
      : "";
  if (!prompt.trim()) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!process.env.NEAR_AI_CLOUD_API_KEY) {
    return Response.json({ title: fallbackTitle(prompt) });
  }

  try {
    const { text } = await generateText({
      model: nearAI(TITLE_MODEL),
      system:
        "Write a short chat title for this finance request. At most 84 characters, plain text, no quotes, no emoji, no trailing period. Name the action and the assets, nothing else.",
      prompt: prompt.slice(0, 500),
      maxOutputTokens: 40,
    });
    return Response.json({ title: cleanTitle(text, fallbackTitle(prompt)) });
  } catch {
    return Response.json({ title: fallbackTitle(prompt) });
  }
}
