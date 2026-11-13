import { customAlphabet } from "nanoid";
import { generateId, type UIMessage } from "ai";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";
import { getSupabaseAdmin } from "./client";

const SLUG_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const nanoid24 = customAlphabet(SLUG_ALPHABET, 24);

export function newSlug(): string {
  return nanoid24();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function conversationFilter(value: string): string {
  // A slug must never be compared against the uuid column: Postgres rejects
  // the whole query with invalid input syntax instead of returning no rows.
  const v = value.replace(/"/g, "");
  if (UUID_RE.test(v)) return `id.eq.${v}`;
  return `slug.eq.${v}`;
}

/**
 * Resolves a chat the user owns, by slug or uuid, including one in the trash.
 *
 * Money routes take the conversation id from the browser, so it is resolved
 * and ownership-checked here before it is written onto a record. A chat that
 * has been trashed still counts: the decision and the settlement belong to
 * the turn, not to the sidebar.
 */
export async function conversationIdForUser(
  userId: string,
  conversationIdOrSlug: string,
): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .or(conversationFilter(conversationIdOrSlug))
    .maybeSingle();
  return ((data as { id: string } | null)?.id) ?? null;
}

export async function ensureConversation(args: {
  userId: string;
  conversationId?: string;
  title?: string | null;
}): Promise<{ id: string; slug: string }> {
  const sb = getSupabaseAdmin();
  if (args.conversationId) {
    const { data } = await sb
      .from("conversations")
      .select("id, slug")
      .eq("user_id", args.userId)
      .is("deleted_at", null)
      .or(conversationFilter(args.conversationId))
      .single();
    if (data) return { id: data.id as string, slug: data.slug as string };
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = newSlug();
    // Untitled stays NULL so the display fallback ("New chat") never
    // collides with a manual rename to that same text. Only a stored
    // string counts as named; generation and repair write solely where
    // the title IS NULL.
    const clean = args.title?.trim().slice(0, TITLE_MAX_CHARS) || null;
    const { data, error } = await sb
      .from("conversations")
      .insert({
        user_id: args.userId,
        slug,
        title: clean,
      })
      .select("id, slug")
      .single();
    if (!error && data)
      return { id: data.id as string, slug: data.slug as string };
    // Unique violation on slug: retry with a fresh slug. Anything else fails.
    if ((error as { code?: string } | null)?.code !== "23505") break;
  }
  throw new Error("The conversation could not start.");
}

/**
 * Records the durable run that owns the turn just started.
 *
 * The reconnect route looks a run up through this column, never through an id
 * supplied by the browser, so a run can only be read by the session that owns
 * the chat. A new turn replaces the pointer; an old run that finishes late
 * cannot clear the new turn because the clear is guarded by the run id.
 */
export async function setConversationRun(
  userId: string,
  conversationId: string,
  runId: string,
): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("conversations")
    .update({
      active_run_id: runId,
      active_run_started_at: new Date().toISOString(),
      active_run_finished_at: null,
    })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw new Error("The chat run could not be recorded.");
}

/** Marks the turn over. Late callbacks from an older run cannot match. */
export async function markConversationRunFinished(
  conversationId: string,
  runId: string,
): Promise<void> {
  const sb = getSupabaseAdmin();
  // Best effort: the marker only decides whether a page offers to resume.
  // A missing column before migration 011 must not fail a turn that already
  // generated and saved its answer.
  await sb
    .from("conversations")
    .update({ active_run_finished_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("active_run_id", runId);
}

/**
 * The run a reconnect may read, resolved from the chat the session owns.
 * Returns null when the chat is missing or has never had a run.
 */
export async function getConversationRun(
  userId: string,
  conversationIdOrSlug: string,
): Promise<{ id: string; activeRunId: string | null } | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("conversations")
    .select("id, active_run_id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .or(conversationFilter(conversationIdOrSlug))
    .maybeSingle();
  // Before migration 011 there is no run column and no resume.
  if (error || !data) return null;
  const row = data as { id: string; active_run_id: string | null };
  return { id: row.id, activeRunId: row.active_run_id };
}

export async function saveUIMessage(
  conversationId: string,
  message: UIMessage,
): Promise<void> {
  const sb = getSupabaseAdmin();
  const clientMsgId = message.id?.trim() || generateId();
  message.id = clientMsgId;
  // The same id dedupes retries, but newer content always wins: the
  // paused-turn snapshot (approval requested) must give way to the decided
  // update, or reloads resurrect dead approval buttons.
  const { error } = await sb.from("messages").upsert(
    {
      conversation_id: conversationId,
      role: message.role,
      parts: message.parts as unknown as object,
      client_msg_id: clientMsgId,
    },
    { onConflict: "conversation_id,client_msg_id", ignoreDuplicates: false },
  );
  if (error) throw new Error("The message could not be saved.");
}

export async function saveNewUIMessages(
  conversationId: string,
  messages: UIMessage[],
): Promise<void> {
  const rows = messages
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => {
      const clientMsgId = m.id?.trim() || generateId();
      // Callers rely on the in-place id (e.g. regenerate reuses it).
      m.id = clientMsgId;
      return {
        conversation_id: conversationId,
        role: m.role,
        parts: m.parts as unknown as object,
        client_msg_id: clientMsgId,
      };
    });
  if (rows.length === 0) return;
  try {
    // One turn = one upsert. Same dedupe semantics as the single-message
    // path (conversation_id,client_msg_id; newer wins).
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("messages")
      .upsert(rows, {
        onConflict: "conversation_id,client_msg_id",
        ignoreDuplicates: false,
      });
    if (error) throw error;
  } catch {
    // Never break streaming for a save failure: fall back to the
    // per-message loop (best-effort) and the next turn retries.
    for (const m of messages) {
      if (m.role !== "assistant" && m.role !== "user") continue;
      try {
        await saveUIMessage(conversationId, m);
      } catch {
        // Never break streaming for a save failure. The next turn retries.
      }
    }
  }
}

export async function listConversations(
  userId: string,
  limit = 20,
  cursor?: { updatedAt: string; id: string },
): Promise<Array<{ id: string; slug: string; title: string | null; updatedAt: string }>> {
  const sb = getSupabaseAdmin();
  let q = sb
    .from("conversations")
    .select("id, slug, title, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (cursor) {
    q = q.or(
      `updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await q;
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    title: (r.title as string | null) ?? null,
    updatedAt: r.updated_at as string,
  }));
}

export type TrashedConversation = {
  id: string;
  slug: string;
  title: string | null;
  updatedAt: string;
  deletedAt: string;
};

/** Chats the user deleted but that have not aged out yet. Newest first. */
export async function listTrashedConversations(
  userId: string,
  limit = 20,
): Promise<TrashedConversation[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("conversations")
    .select("id, slug, title, updated_at, deleted_at")
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    title: (r.title as string | null) ?? null,
    updatedAt: r.updated_at as string,
    deletedAt: r.deleted_at as string,
  }));
}

/** Move a chat to trash. Idempotent: deleting twice keeps the first timestamp. */
export async function softDeleteConversation(
  userId: string,
  conversationIdOrSlug: string,
): Promise<{ id: string; deletedAt: string } | null> {
  const sb = getSupabaseAdmin();
  const { data: conv } = await sb
    .from("conversations")
    .select("id, deleted_at")
    .eq("user_id", userId)
    .or(conversationFilter(conversationIdOrSlug))
    .maybeSingle();
  if (!conv) return null;
  if ((conv as { deleted_at: string | null }).deleted_at)
    return {
      id: (conv as { id: string }).id,
      deletedAt: (conv as { deleted_at: string }).deleted_at,
    };
  const { data, error } = await sb
    .from("conversations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", (conv as { id: string }).id)
    .eq("user_id", userId)
    .select("id, deleted_at")
    .single();
  if (error || !data) return null;
  return {
    id: (data as { id: string }).id,
    deletedAt: (data as { deleted_at: string }).deleted_at,
  };
}

/** Bring a trashed chat back to the list. */
export async function restoreConversation(
  userId: string,
  conversationIdOrSlug: string,
): Promise<{ id: string; slug: string } | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("conversations")
    .update({ deleted_at: null })
    .eq("user_id", userId)
    .or(conversationFilter(conversationIdOrSlug))
    .not("deleted_at", "is", null)
    .select("id, slug")
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: (data as { id: string }).id,
    slug: (data as { slug: string }).slug,
  };
}

/** Hard-delete one conversation. Messages and quotes cascade from the row. */
export async function permanentlyDeleteConversation(
  userId: string,
  conversationIdOrSlug: string,
): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const { data: conv } = await sb
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .or(conversationFilter(conversationIdOrSlug))
    .maybeSingle();
  if (!conv) return null;
  const { error } = await sb
    .from("conversations")
    .delete()
    .eq("id", (conv as { id: string }).id)
    .eq("user_id", userId);
  if (error) return null;
  return (conv as { id: string }).id;
}

/** Hard-delete every trashed chat for the user. Returns the count removed. */
export async function emptyTrash(userId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("conversations")
    .delete()
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .select("id");
  if (error || !data) return 0;
  return (data as Array<{ id: string }>).length;
}

/**
 * Hard-delete trashed chats older than 30 days. Runs opportunistically on
 * list reads so no scheduler is needed: a row can only survive past its
 * deadline while its owner never opens the app.
 */
export async function purgeExpiredTrash(userId?: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let q = sb
    .from("conversations")
    .delete()
    .lt("deleted_at", cutoff)
    .select("id");
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error || !data) return 0;
  return (data as Array<{ id: string }>).length;
}

export async function getTrashedConversationMessages(
  userId: string,
  conversationIdOrSlug: string,
  limit = 20,
  beforeSeq?: number,
): Promise<{
  messages: UIMessage[];
  title: string | null;
  deletedAt: string | null;
  hasMore: boolean;
  oldestSeq?: number;
}> {
  const sb = getSupabaseAdmin();
  const { data: conv } = await sb
    .from("conversations")
    .select("id, title, deleted_at")
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .or(conversationFilter(conversationIdOrSlug))
    .single();
  if (!conv) return { messages: [], title: null, deletedAt: null, hasMore: false };
  const title = ((conv as { title: string | null }).title ?? null) as string | null;
  const deletedAt = (conv as { deleted_at: string }).deleted_at ?? null;

  let q = sb
    .from("messages")
    .select("role, parts, client_msg_id, seq, created_at")
    .eq("conversation_id", (conv as { id: string }).id);

  if (beforeSeq !== undefined) {
    q = q.lt("seq", beforeSeq);
  }

  const { data } = await q.order("seq", { ascending: false }).limit(limit + 1);
  if (!data) return { messages: [], title, deletedAt, hasMore: false };

  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;
  const ordered = [...items].reverse();
  const oldestSeq = ordered.length > 0 ? (ordered[0].seq as number) : undefined;

  return {
    messages: ordered.map((r) => ({
      id: (r.client_msg_id as string) || `msg-${r.seq}`,
      role: r.role as UIMessage["role"],
      parts: (r.parts as UIMessage["parts"]) ?? [],
      metadata: {
        createdAt: (r.created_at as string) || undefined,
        seq: r.seq as number,
      },
    })),
    title,
    deletedAt,
    hasMore,
    oldestSeq,
  };
}

export async function getConversationMessages(
  userId: string,
  conversationIdOrSlug: string,
  limit = 20,
  beforeSeq?: number,
): Promise<{
  messages: UIMessage[];
  title: string | null;
  hasMore: boolean;
  oldestSeq?: number;
  /**
   * The durable run that owns this chat's current turn. A page load reads
   * these to decide whether the client should reconnect to that run instead
   * of showing the last saved snapshot.
   */
  activeRunId: string | null;
  activeRunStartedAt: string | null;
  activeRunFinishedAt: string | null;
}> {
  const sb = getSupabaseAdmin();
  // The run columns arrive with migration 011. A deployment that lands
  // before the migration must still read its chats, so a missing-column
  // error falls back to the old shape and simply disables resume.
  const full = await sb
    .from("conversations")
    .select("id, title, active_run_id, active_run_started_at, active_run_finished_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .or(conversationFilter(conversationIdOrSlug))
    .single();
  let row = full.data as
    | {
        id: string;
        title: string | null;
        active_run_id?: string | null;
        active_run_started_at?: string | null;
        active_run_finished_at?: string | null;
      }
    | null;
  if (!row && full.error) {
    const fallback = await sb
      .from("conversations")
      .select("id, title")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .or(conversationFilter(conversationIdOrSlug))
      .single();
    row = fallback.data as { id: string; title: string | null } | null;
  }
  if (!row) {
    return {
      messages: [],
      title: null,
      hasMore: false,
      activeRunId: null,
      activeRunStartedAt: null,
      activeRunFinishedAt: null,
    };
  }
  const title = row.title ?? null;
  const activeRunId = row.active_run_id ?? null;
  const activeRunStartedAt = row.active_run_started_at ?? null;
  const activeRunFinishedAt = row.active_run_finished_at ?? null;

  let q = sb
    .from("messages")
    .select("role, parts, client_msg_id, seq, created_at")
    .eq("conversation_id", row.id);

  if (beforeSeq !== undefined) {
    q = q.lt("seq", beforeSeq);
  }

  const { data } = await q.order("seq", { ascending: false }).limit(limit + 1);
  if (!data) {
    return {
      messages: [],
      title,
      hasMore: false,
      activeRunId,
      activeRunStartedAt,
      activeRunFinishedAt,
    };
  }

  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;
  const ordered = [...items].reverse();
  const oldestSeq = ordered.length > 0 ? (ordered[0].seq as number) : undefined;

  return {
    messages: ordered.map((r) => ({
      id: (r.client_msg_id as string) || `msg-${r.seq}`,
      role: r.role as UIMessage["role"],
      parts: (r.parts as UIMessage["parts"]) ?? [],
      metadata: {
        createdAt: (r.created_at as string) || undefined,
        seq: r.seq as number,
      },
    })),
    title,
    hasMore,
    oldestSeq,
    activeRunId,
    activeRunStartedAt,
    activeRunFinishedAt,
  };
}
