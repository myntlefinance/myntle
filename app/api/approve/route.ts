import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { swapLifecycle, type SwapInput } from "@/workflows/swap-lifecycle";

export async function POST(req: Request) {
  const input = (await req.json()) as SwapInput;

  const run = await start(swapLifecycle, [input]);

  return NextResponse.json({ runId: run.runId });
}
