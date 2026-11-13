import { describe, expect, it } from "vitest";
import type { UIMessageChunk } from "ai";
import { paceFinishedReplay } from "./replay-pace";

function streamOf(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<UIMessageChunk>) {
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

const textChunks: UIMessageChunk[] = [
  { type: "start", messageId: "m1" },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Hello " },
  { type: "text-delta", id: "t1", delta: "world" },
  { type: "text-end", id: "t1" },
  { type: "finish-step" },
  { type: "finish", finishReason: "stop" },
];

describe("paceFinishedReplay", () => {
  it("preserves the exact chunk sequence and text", async () => {
    const paced = await readAll(
      paceFinishedReplay(streamOf(textChunks), {
        minMs: 20,
        maxMs: 40,
        baseCps: 1000,
      }),
    );

    expect(paced.map((chunk) => chunk.type)).toEqual(
      textChunks.map((chunk) => chunk.type),
    );
    expect(
      paced
        .filter(
          (chunk): chunk is Extract<UIMessageChunk, { type: "text-delta" }> =>
            chunk.type === "text-delta",
        )
        .map((chunk) => chunk.delta)
        .join(""),
    ).toBe("Hello world");
    expect(paced.at(-1)?.type).toBe("finish");
  });

  it("spaces text chunks out", async () => {
    const startedAt = Date.now();
    await readAll(
      paceFinishedReplay(streamOf(textChunks), {
        minMs: 100,
        maxMs: 100,
        baseCps: 100,
      }),
    );
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(50);
  });

  it("does not delay a tool-only replay", async () => {
    const startedAt = Date.now();
    const chunks = await readAll(
      paceFinishedReplay(streamOf([{ type: "start", messageId: "m1" }]), {
        minMs: 500,
        maxMs: 500,
      }),
    );
    expect(chunks).toHaveLength(1);
    expect(Date.now() - startedAt).toBeLessThan(300);
  });
});
