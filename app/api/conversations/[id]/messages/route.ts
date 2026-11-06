import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  conversationFilter,
  getConversationMessages,
  getTrashedConversationMessages,
} from "@/lib/db/conversations";
import { generateTitle } from "@/lib/ai/title";
import { getSupabaseAdmin } from "@/lib/db/client";

function extractUserText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const texts: string[] = [];
  for (const part of parts as Array<{ type?: unknown; text?: unknown }>) {
    if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
      texts.push(part.text.trim());
    }
  }
  return texts.join("\n");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "20") || 20, 1),
    100,
  );
  const beforeRaw = url.searchParams.get("beforeSeq");
  const beforeSeq = beforeRaw ? Number(beforeRaw) : undefined;

  // Trashed chats are invisible to the normal loader, so the trash preview
  // reads them through this flag instead of restoring first.
  if (url.searchParams.get("trashed") === "1") {
    const { messages, title, deletedAt, hasMore, oldestSeq } = await getTrashedConversationMessages(
      session.userId,
      decodeURIComponent(id),
      limit,
      Number.isFinite(beforeSeq) ? beforeSeq : undefined,
    );
    if (!title && messages.length === 0)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ messages, title, deletedAt, hasMore, oldestSeq });
  }

  const { messages, title, hasMore, oldestSeq } = await getConversationMessages(
    session.userId,
    decodeURIComponent(id),
    limit,
    Number.isFinite(beforeSeq) ? beforeSeq : undefined,
  );
  // Lazy repair for chats orphaned before the server backup existed:
  // an untitled (NULL) chat is named from its oldest prompt in the
  // background. Conditional so a manual rename always wins. Skipped on
  // older-page loads; the first page already triggered it.
  if (title === null && beforeSeq === undefined) {
    const slug = decodeURIComponent(id);
    const userId = session.userId;
    after(async () => {
      try {
        const sb = getSupabaseAdmin();
        const { data: conv } = await sb
          .from("conversations")
          .select("id")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .or(conversationFilter(slug))
          .single();
        const convId = (conv as { id: string } | null)?.id;
        if (!convId) return;
        const { data: oldest } = await sb
          .from("messages")
          .select("role, parts")
          .eq("conversation_id", convId)
          .order("seq", { ascending: true })
          .limit(10);
        if (!oldest) return;
        let prompt = "";
        for (const row of oldest as Array<{ role: string; parts: unknown }>) {
          if (row.role === "user") {
            prompt = extractUserText(row.parts).slice(0, 500);
            if (prompt.trim()) break;
          }
        }
        if (!prompt.trim()) return;
        const generated = await generateTitle(prompt);
        if (!generated) return;
        await sb
          .from("conversations")
          .update({ title: generated })
          .eq("id", convId)
          .is("title", null);
      } catch {
        // Repair failure leaves NULL; the next open retries.
      }
    });
  }
  return NextResponse.json({ messages, title, hasMore, oldestSeq });
}
