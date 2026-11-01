import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";
import { getSupabaseAdmin } from "@/lib/db/client";
import {
  conversationFilter,
  permanentlyDeleteConversation,
  restoreConversation,
  softDeleteConversation,
} from "@/lib/db/conversations";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Restoring clears the deletion timestamp so the chat rejoins the list.
  if ((body as { restore?: unknown } | null)?.restore === true) {
    const restored = await restoreConversation(
      session.userId,
      decodeURIComponent(id),
    );
    if (!restored)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ conversation: restored });
  }

  const title =
    typeof (body as { title?: unknown })?.title === "string"
      ? ((body as { title: string }).title ?? "")
      : "";
  const cleaned = title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
  if (!cleaned) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("conversations")
    .update({ title: cleaned })
    .eq("user_id", session.userId)
    .is("deleted_at", null)
    .or(conversationFilter(decodeURIComponent(id)))
    .select("id, slug, title")
    .single();
  if (error || !data)
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ conversation: data });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const slug = decodeURIComponent(id);

  // Permanent deletion hard-deletes the row; messages cascade from it.
  if (url.searchParams.get("permanent") === "true") {
    const deleted = await permanentlyDeleteConversation(session.userId, slug);
    if (!deleted)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ deleted });
  }

  // The default path moves the chat to trash, where it stays for 30 days.
  const trashed = await softDeleteConversation(session.userId, slug);
  if (!trashed)
    return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({ deleted: trashed.id, deletedAt: trashed.deletedAt });
}
