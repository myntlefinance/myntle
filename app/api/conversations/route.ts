import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  emptyTrash,
  listConversations,
  listTrashedConversations,
  purgeExpiredTrash,
} from "@/lib/db/conversations";

export async function GET(req: Request) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "20") || 20, 1),
    50,
  );
  const cursorUpdatedAt = url.searchParams.get("cursorUpdatedAt") ?? undefined;
  const cursorId = url.searchParams.get("cursorId") ?? undefined;

  if (url.searchParams.get("trashed") === "1") {
    // Expired trash check runs only when viewing trash so normal sidebar reads stay pure.
    void purgeExpiredTrash(session.userId).catch(() => undefined);
    const items = await listTrashedConversations(session.userId, limit);
    return NextResponse.json({ conversations: items });
  }

  const items = await listConversations(
    session.userId,
    limit,
    cursorUpdatedAt && cursorId
      ? { updatedAt: cursorUpdatedAt, id: cursorId }
      : undefined,
  );
  return NextResponse.json({ conversations: items });
}

/** Empty the whole trash bin at once. */
export async function DELETE(req: Request) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  if (url.searchParams.get("empty") !== "true")
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const removed = await emptyTrash(session.userId);
  return NextResponse.json({ removed });
}
