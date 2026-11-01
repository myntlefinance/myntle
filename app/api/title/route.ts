import { generateTitle } from "@/lib/ai/title";

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
  // Null means every tier failed. The client keeps "New chat" and retries
  // on the next turn — the prompt is never used as the title.
  const title = await generateTitle(prompt);
  if (!title) return Response.json({ title: null }, { status: 502 });
  return Response.json({ title });
}
