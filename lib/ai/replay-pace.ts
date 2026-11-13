import type { UIMessageChunk } from "ai";

/**
 * Replays a finished turn at a human pace.
 *
 * The durable stream stores every chunk without the delay the model produced
 * it with, so a reconnect after the turn finished delivered the whole answer
 * in one block. This transform keeps the exact chunk sequence (the client's
 * chunk cursor must stay aligned with the durable stream's indexes) and only
 * spaces the text deltas out. Chunk boundaries are preserved, never split.
 *
 * A live run is never paced: there is nothing to catch up on, and delaying
 * real tokens is worse than showing them.
 */
export type ReplayPaceOptions = {
  /** Shorter answers still take at least this long. */
  minMs?: number;
  /** Long answers are compressed into this window. */
  maxMs?: number;
  /** The unhurried character rate, in characters per second. */
  baseCps?: number;
};

export function paceFinishedReplay(
  stream: ReadableStream<UIMessageChunk>,
  options: ReplayPaceOptions = {},
): ReadableStream<UIMessageChunk> {
  const minMs = options.minMs ?? 600;
  const maxMs = options.maxMs ?? 4000;
  const baseCps = options.baseCps ?? 110;

  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const reader = stream.getReader();
      const chunks: UIMessageChunk[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      const textChunks = chunks.filter(
        (chunk) => chunk.type === "text-delta",
      ).length;
      const textChars = chunks.reduce(
        (total, chunk) =>
          chunk.type === "text-delta" ? total + chunk.delta.length : total,
        0,
      );

      // 110 characters a second feels like the model is still writing; a long
      // reply is compressed into at most four seconds so it never becomes a
      // wait of its own.
      const durationMs =
        textChars === 0
          ? 0
          : Math.min(maxMs, Math.max(minMs, (textChars / baseCps) * 1000));
      const delayMs =
        textChunks === 0
          ? 0
          : Math.min(50, Math.max(1, durationMs / textChunks));

      try {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
          if (chunk.type === "text-delta" && delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
        controller.close();
      } catch {
        // The reader went away mid-replay. The run is already complete, so
        // there is nothing to stop.
      }
    },
  });
}
