import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  getConversationMessages,
  getTrashedConversationMessages,
} from "@/lib/db/conversations";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1),
    100,
  );
  const beforeRaw = url.searchParams.get("beforeSeq");
  const beforeSeq = beforeRaw ? Number(beforeRaw) : undefined;

  // Trashed chats are invisible to the normal loader, so the trash preview
  // reads them through this flag instead of restoring first.
  if (url.searchParams.get("trashed") === "1") {
    const { messages, title, deletedAt } = await getTrashedConversationMessages(
      session.userId,
      decodeURIComponent(id),
      limit,
      Number.isFinite(beforeSeq) ? beforeSeq : undefined,
    );
    if (!title && messages.length === 0)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ messages, title, deletedAt });
  }

  const { messages, title } = await getConversationMessages(
    session.userId,
    decodeURIComponent(id),
    limit,
    Number.isFinite(beforeSeq) ? beforeSeq : undefined,
  );
  return NextResponse.json({ messages, title });
}
