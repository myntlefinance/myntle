import type { UIMessage } from "ai";
import { clearApprovalRecords } from "./approvalRecords";

/* ─────────────────────────────────────────────────────────
 * THREAD CACHE
 * Module-level memory shared by every view that shows chats.
 * ChatView and TrashView both seed their first paint from here
 * and refresh in the background, so navigating between them
 * never flashes an empty list. Nothing here touches React.
 * ───────────────────────────────────────────────────────── */

export type ThreadItem = { id: string; label: string | null };

export type TrashedItem = { id: string; label: string | null; deletedAt: string };

/** One first page from the messages route, shared by hover and open. */
export type ThreadMessagesBody = {
  messages?: UIMessage[];
  title?: string | null;
  hasMore?: boolean;
  oldestSeq?: number;
};

export type ThreadMessagesLoad =
  | { kind: "ok"; body: ThreadMessagesBody }
  | { kind: "unauthorized" }
  | { kind: "error" };

export type TrashedMessagesBody = {
  messages?: UIMessage[];
  title?: string | null;
  deletedAt?: string | null;
};

export type TrashedMessagesLoad =
  | { kind: "ok"; body: TrashedMessagesBody }
  | { kind: "unauthorized" }
  | { kind: "error" };

// Per-chat history cache for the session. Clicking a visited chat renders
// instantly from here; a background revalidate keeps it honest. Hovering a
// thread warms one entry. Nothing is prefetched in bulk.
export const messageCache = new Map<string, UIMessage[]>();
/** One message read per chat. A hover prefetch and the click join the same promise. */
const threadLoads = new Map<string, Promise<ThreadMessagesLoad>>();
/** When this tab last read a thread from the server, for the click freshness window. */
const threadReadAt = new Map<string, number>();
const THREAD_READ_FRESH_MS = 15_000;
export const trashedMessageCache = new Map<string, UIMessage[]>();
/** One trashed-preview read per chat, shared by hover and open. */
const trashedLoads = new Map<string, Promise<TrashedMessagesLoad>>();
export const threadPagination = new Map<string, { hasMore: boolean; oldestSeq?: number }>();

/**
 * The server seed and the copy this tab persisted can disagree when the
 * router hands back a payload it rendered before the last turn. Both lists
 * are chronological and share a prefix, so the one whose tail the other does
 * not contain is the newer read. The server wins a genuine divergence, and a
 * cached reply that is simply older never replaces a newer server read.
 */
export function newestTranscript(
  seeded: UIMessage[] | undefined,
  cached: UIMessage[] | undefined,
): UIMessage[] {
  if (!seeded?.length) return cached ?? [];
  if (!cached?.length) return seeded;
  const seededLast = seeded[seeded.length - 1].id;
  const cachedLast = cached[cached.length - 1].id;
  if (seededLast === cachedLast) return seeded;
  if (cached.some((message) => message.id === seededLast)) return cached;
  return seeded;
}

export function getCachedMessages(slug: string): UIMessage[] | undefined {
  const mem = messageCache.get(slug);
  if (mem && mem.length > 0) return mem;
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(`myntle-msgs-${slug}`);
      if (raw) {
        const parsed = JSON.parse(raw) as UIMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          messageCache.set(slug, parsed);
          return parsed;
        }
      }
    }
  } catch {
    // Ignore.
  }
  return undefined;
}

const persistAt = new Map<string, number>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const persistPending = new Map<string, UIMessage[]>();
const PERSIST_THROTTLE_MS = 1000;

function persistMessages(slug: string, messages: UIMessage[]) {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(`myntle-msgs-${slug}`, JSON.stringify(messages));
    }
  } catch {
    // Quota or private mode.
  }
  persistAt.set(slug, Date.now());
  persistPending.delete(slug);
}

export function setCachedMessages(slug: string, messages: UIMessage[]) {
  messageCache.set(slug, messages);
  const now = Date.now();
  const last = persistAt.get(slug) ?? 0;
  if (now - last >= PERSIST_THROTTLE_MS && !persistTimers.has(slug)) {
    persistMessages(slug, messages);
    return;
  }
  // Throttled: remember the latest and flush once the window passes, so the
  // turn-end state still lands in storage without stringifying every token.
  persistPending.set(slug, messages);
  if (!persistTimers.has(slug)) {
    const delay = Math.max(0, PERSIST_THROTTLE_MS - (now - last));
    persistTimers.set(
      slug,
      setTimeout(() => {
        persistTimers.delete(slug);
        const pending = persistPending.get(slug);
        if (pending) persistMessages(slug, pending);
      }, delay),
    );
  }
}

/** Flush any throttled sessionStorage write for a slug (or all slugs). */
export function flushCachedMessages(slug?: string) {
  if (slug) {
    const timer = persistTimers.get(slug);
    if (timer) {
      clearTimeout(timer);
      persistTimers.delete(slug);
    }
    const pending = persistPending.get(slug);
    if (pending) persistMessages(slug, pending);
    return;
  }
  for (const [key, timer] of persistTimers) {
    clearTimeout(timer);
    persistTimers.delete(key);
    const pending = persistPending.get(key);
    if (pending) persistMessages(key, pending);
  }
}

export function deleteCachedMessages(slug: string) {
  messageCache.delete(slug);
  threadLoads.delete(slug);
  threadReadAt.delete(slug);
  const timer = persistTimers.get(slug);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(slug);
  }
  persistPending.delete(slug);
  persistAt.delete(slug);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(`myntle-msgs-${slug}`);
    }
  } catch {
    // Ignore.
  }
}

// Survives chat-to-chat remounts within the session: the sidebar renders
// this instantly and refreshes in the background, so it never flashes empty.
let threadsMemoryCache: ThreadItem[] | null = null;
let trashedMemoryCache: TrashedItem[] | null = null;
let threadsInflightPromise: Promise<ThreadItem[]> | null = null;
let trashedInflightPromise: Promise<TrashedItem[]> | null = null;

// v2 keys: v1 stored the literal "New chat" for untitled chats, which is
// now NULL in the database. Old keys are dropped on first read so a stale
// placeholder can never masquerade as a manual rename.
const THREADS_KEY = "myntle-threads-v2";
const TRASHED_KEY = "myntle-trashed-v2";

export function clearThreadCache() {
  for (const [, timer] of persistTimers) clearTimeout(timer);
  persistTimers.clear();
  persistPending.clear();
  persistAt.clear();
  messageCache.clear();
  trashedMessageCache.clear();
  threadLoads.clear();
  threadReadAt.clear();
  trashedLoads.clear();
  threadPagination.clear();
  clearApprovalRecords();
  threadsInflightPromise = null;
  trashedInflightPromise = null;
  threadsMemoryCache = null;
  trashedMemoryCache = null;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("myntle-threads");
      localStorage.removeItem("myntle-trashed");
      localStorage.removeItem(THREADS_KEY);
      localStorage.removeItem(TRASHED_KEY);
      localStorage.removeItem("myntle-conv");
    }
    if (typeof sessionStorage !== "undefined") {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith("myntle-msgs-")) {
          sessionStorage.removeItem(key);
        }
      }
    }
  } catch {
    // Ignore.
  }
}

export function readThreadsCache(): ThreadItem[] {
  if (threadsMemoryCache) return threadsMemoryCache;
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ThreadItem[];
      if (Array.isArray(parsed)) {
        threadsMemoryCache = parsed;
        return parsed;
      }
    }
    // One-time drop of v1 entries whose "New chat" labels are ambiguous.
    localStorage.removeItem("myntle-threads");
  } catch {
    // Ignore and fall through to empty.
  }
  return [];
}

export function writeThreadsCache(items: ThreadItem[]) {
  threadsMemoryCache = items;
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(items));
  } catch {
    // Private mode. Memory cache still covers the session.
  }
}

// Synchronous name lookup so a switching chat never paints "New chat"
// for a frame. Memory first, then the persisted sidebar list. NULL means
// untitled; a stored "New chat" string means the user typed exactly that.
export function findThreadLabel(slug: string | null): string | null {
  if (!slug) return null;
  if (threadsMemoryCache) {
    const hit = threadsMemoryCache.find((t) => t.id === slug);
    if (hit) return hit.label ?? null;
  }
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ThreadItem[];
      const hit = Array.isArray(parsed)
        ? parsed.find((t) => t.id === slug)
        : undefined;
      if (hit) return (hit.label ?? null) as string | null;
    }
  } catch {
    // Ignore and fall through to null.
  }
  return null;
}

export function readTrashedCache(): TrashedItem[] {
  if (trashedMemoryCache) return trashedMemoryCache;
  try {
    const raw = localStorage.getItem(TRASHED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TrashedItem[];
      if (Array.isArray(parsed)) {
        trashedMemoryCache = parsed;
        return parsed;
      }
    }
    localStorage.removeItem("myntle-trashed");
  } catch {
    // Ignore and fall through to empty.
  }
  return [];
}

/**
 * Whether the trash has been read before, even if the answer was "nothing
 * deleted". `readTrashedCache` alone cannot say: it returns an empty array
 * both for a known-empty trash and for a cache that was never written, and
 * treating the second as the first is what made the page show a skeleton on
 * every visit. A stored empty array is a result, so the key's presence is
 * the marker.
 */
export function hasTrashedCache(): boolean {
  if (trashedMemoryCache !== null) return true;
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(TRASHED_KEY) !== null
    );
  } catch {
    return false;
  }
}

export function writeTrashedCache(items: TrashedItem[]) {
  trashedMemoryCache = items;
  try {
    localStorage.setItem(TRASHED_KEY, JSON.stringify(items));
  } catch {
    // Private mode. Memory cache still covers the session.
  }
}

/** Fetch the active list, persist it, and return it. Falls back to cache. */
export async function fetchThreads(limit = 20): Promise<ThreadItem[]> {
  if (threadsInflightPromise) return threadsInflightPromise;
  threadsInflightPromise = (async () => {
    try {
      const res = await fetch(`/api/conversations?limit=${limit}`);
      if (res.status === 401) {
        clearThreadCache();
        return [];
      }
      if (!res.ok) return readThreadsCache();
      const body = (await res.json()) as {
        conversations?: Array<{ slug: string; title: string | null }>;
      } | null;
      if (!body?.conversations) return readThreadsCache();
      const items = body.conversations.map((c) => ({
        id: c.slug,
        label: (c.title ?? null) as string | null,
      }));
      writeThreadsCache(items);
      return items;
    } catch {
      // Offline or transient failure: keep the last good list.
      return readThreadsCache();
    } finally {
      threadsInflightPromise = null;
    }
  })();
  return threadsInflightPromise;
}

/** Fetch the trash list, persist it, and return it. Falls back to cache. */
export async function fetchTrashed(limit = 100): Promise<TrashedItem[]> {
  if (trashedInflightPromise) return trashedInflightPromise;
  trashedInflightPromise = (async () => {
    try {
      const res = await fetch(`/api/conversations?trashed=1&limit=${limit}`);
      if (res.status === 401) {
        clearThreadCache();
        return [];
      }
      if (!res.ok) return readTrashedCache();
      const body = (await res.json()) as {
        conversations?: Array<{ slug: string; title: string | null; deletedAt: string }>;
      } | null;
      if (!body?.conversations) return readTrashedCache();
      const items = body.conversations.map((c) => ({
        id: c.slug,
        label: (c.title ?? null) as string | null,
        deletedAt: c.deletedAt,
      }));
      writeTrashedCache(items);
      return items;
    } catch {
      // Offline or transient failure: keep the last good list.
      return readTrashedCache();
    } finally {
      trashedInflightPromise = null;
    }
  })();
  return trashedInflightPromise;
}

/** Remember that this tab just read the thread from the server. */
export function markThreadRead(slug: string) {
  threadReadAt.set(slug, Date.now());
}

/** True when this tab read the thread recently enough to skip a duplicate. */
export function threadReadRecently(
  slug: string,
  maxAgeMs = THREAD_READ_FRESH_MS,
): boolean {
  const at = threadReadAt.get(slug);
  return at !== undefined && Date.now() - at < maxAgeMs;
}

/**
 * One first page of a thread, shared by the hover prefetch and the open.
 *
 * Both callers ask for the same slug, so the second one joins the promise
 * instead of starting a second GET. A prefetch marks the request so the
 * messages route skips its lazy title repair; a real open still repairs.
 * The loader owns the cache write and pagination, so callers only consume
 * the result.
 */
export function loadThreadMessages(
  slug: string,
  options: { prefetch?: boolean } = {},
): Promise<ThreadMessagesLoad> {
  const existing = threadLoads.get(slug);
  if (existing) return existing;

  const query = new URLSearchParams({ limit: "20" });
  if (options.prefetch) query.set("prefetch", "1");

  const request = (async (): Promise<ThreadMessagesLoad> => {
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(slug)}/messages?${query.toString()}`,
      );
      if (res.status === 401) {
        clearThreadCache();
        return { kind: "unauthorized" };
      }
      if (!res.ok) return { kind: "error" };
      const body = (await res.json()) as ThreadMessagesBody | null;
      if (!body) return { kind: "error" };
      if (body.messages && body.messages.length > 0) {
        setCachedMessages(slug, body.messages);
        markThreadRead(slug);
      }
      if (body.hasMore !== undefined) {
        threadPagination.set(slug, {
          hasMore: body.hasMore,
          oldestSeq: body.oldestSeq,
        });
      }
      return { kind: "ok", body };
    } catch {
      return { kind: "error" };
    }
  })();

  threadLoads.set(slug, request);
  void request.finally(() => {
    if (threadLoads.get(slug) === request) threadLoads.delete(slug);
  });
  return request;
}

/**
 * Hover intent on a thread: warm its history so opening it is instant.
 *
 * The card records are deliberately not warmed here. A decision and a
 * settlement are read by the card that is actually on screen, never by a
 * row someone merely hovered. A history already in the tab needs no
 * warm-up; a stale one is revalidated by the open, not by the hover.
 */
export function prefetchThread(slug: string) {
  if (threadLoads.has(slug) || threadReadRecently(slug)) return;
  if (getCachedMessages(slug)) return;
  void loadThreadMessages(slug, { prefetch: true });
}

/**
 * One first page of a trashed chat, shared by the hover preview and the open.
 *
 * A trashed chat cannot gain messages, so a preview already in the tab needs
 * no read at all. The page size matches the live thread: the preview shows
 * the tail, not the whole deleted transcript.
 */
export function loadTrashedMessages(
  slug: string,
): Promise<TrashedMessagesLoad> {
  const existing = trashedLoads.get(slug);
  if (existing) return existing;

  const request = (async (): Promise<TrashedMessagesLoad> => {
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(slug)}/messages?limit=20&trashed=1`,
      );
      if (res.status === 401) {
        clearThreadCache();
        return { kind: "unauthorized" };
      }
      if (!res.ok) return { kind: "error" };
      const body = (await res.json()) as TrashedMessagesBody | null;
      if (!body) return { kind: "error" };
      trashedMessageCache.set(slug, body.messages ?? []);
      return { kind: "ok", body };
    } catch {
      return { kind: "error" };
    }
  })();

  trashedLoads.set(slug, request);
  void request.finally(() => {
    if (trashedLoads.get(slug) === request) trashedLoads.delete(slug);
  });
  return request;
}

/** Hover intent on a trashed thread: warm its history so previewing it is instant. */
export function prefetchTrashedThread(slug: string) {
  if (trashedMessageCache.has(slug) || trashedLoads.has(slug)) return;
  void loadTrashedMessages(slug);
}

