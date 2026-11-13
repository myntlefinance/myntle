import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { getRun, type WorkflowReadableStream } from "workflow/api";
import { requireSession } from "@/lib/auth/session";
import { getConversationRun } from "@/lib/db/conversations";
import { paceFinishedReplay } from "@/lib/ai/replay-pace";

export const maxDuration = 300;

/**
 * Replays a chat run's durable stream from the last chunk the browser saw.
 *
 * The run id comes from the chat record, never from the request, so owning a
 * chat is what grants access to its stream. `startIndex` is the transport's
 * chunk cursor; the response carries the stream's tail index so a negative
 * cursor can be resolved on a later retry.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await getConversationRun(
    session.userId,
    decodeURIComponent(id),
  );
  if (!conversation) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const runId = conversation.activeRunId;
  if (!runId) {
    // Nothing has ever run in this chat, so there is nothing to resume.
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const startRaw = new URL(req.url).searchParams.get("startIndex");
  const startIndex = startRaw !== null ? Number(startRaw) : undefined;
  if (
    startIndex !== undefined &&
    (!Number.isSafeInteger(startIndex) || startRaw === "")
  ) {
    return Response.json({ error: "Invalid startIndex." }, { status: 400 });
  }

  const run = (() => {
    try {
      return getRun(runId);
    } catch {
      // The run aged out of the World's retention window.
      return null;
    }
  })();
  if (!run) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  let readable: WorkflowReadableStream<UIMessageChunk>;
  try {
    readable = run.getReadable<UIMessageChunk>({ startIndex });
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  let tailIndex: number;
  try {
    tailIndex = await readable.getTailIndex();
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  // A finished turn is replayed at a human pace; a live one is not delayed.
  // The chunk sequence is preserved exactly, so the transport's cursor still
  // maps to the durable stream on any later reconnect.
  const status = await run.status.catch(() => "unknown");
  const stream =
    status === "completed" &&
    req.headers.get("x-chat-replay-pace") !== "off"
      ? paceFinishedReplay(readable)
      : readable;

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "x-workflow-run-id": runId,
      "x-workflow-stream-tail-index": String(tailIndex),
    },
  });
}
