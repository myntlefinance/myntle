import type { UIMessage } from "ai";

/* ─────────────────────────────────────────────────────────
 * THREAD CACHE
 * Module-level memory shared by every view that shows chats.
 * ChatView and TrashView both seed their first paint from here
 * and refresh in the background, so navigating between them
 * never flashes an empty list. Nothing here touches React.
 * ───────────────────────────────────────────────────────── */

export type ThreadItem = { id: string; label: string | null };

export type TrashedItem = { id: string; label: string | null; deletedAt: string };

// Per-chat history cache for the session. Clicking a visited chat renders
// instantly from here; a background revalidate keeps it honest. Hovering a
// thread warms one entry. Nothing is prefetched in bulk.
export const messageCache = new Map<string, UIMessage[]>();
export const prefetchInflight = new Set<string>();
export const trashedMessageCache = new Map<string, UIMessage[]>();
export const trashedPrefetchInflight = new Set<string>();
export const threadPagination = new Map<string, { hasMore: boolean; oldestSeq?: number }>();

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
  prefetchInflight.delete(slug);
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
  prefetchInflight.clear();
  trashedPrefetchInflight.clear();
  threadPagination.clear();
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

/** Hover intent on a thread: warm its history so opening it is instant. */
export function prefetchThread(slug: string) {
  if (messageCache.has(slug) || prefetchInflight.has(slug)) return;
  prefetchInflight.add(slug);
  void fetch(`/api/conversations/${encodeURIComponent(slug)}/messages?limit=20`)
    .then((res) => {
      if (res.status === 401) {
        clearThreadCache();
        return null;
      }
      return res.ok ? res.json() : null;
    })
    .then((body: { messages?: UIMessage[]; hasMore?: boolean; oldestSeq?: number } | null) => {
      if (body?.messages && body.messages.length > 0) {
        setCachedMessages(slug, body.messages);
        if (body.hasMore !== undefined) {
          threadPagination.set(slug, {
            hasMore: body.hasMore,
            oldestSeq: body.oldestSeq,
          });
        }
      }
    })
    .catch(() => undefined)
    .finally(() => {
      prefetchInflight.delete(slug);
    });
}

/** Hover intent on a trashed thread: warm its history so previewing it is instant. */
export function prefetchTrashedThread(slug: string) {
  if (trashedMessageCache.has(slug) || trashedPrefetchInflight.has(slug)) return;
  trashedPrefetchInflight.add(slug);
  void fetch(`/api/conversations/${encodeURIComponent(slug)}/messages?limit=100&trashed=1`)
    .then((res) => {
      if (res.status === 401) {
        clearThreadCache();
        return null;
      }
      return res.ok ? res.json() : null;
    })
    .then((body: { messages?: UIMessage[] } | null) => {
      if (body?.messages && body.messages.length > 0) {
        trashedMessageCache.set(slug, body.messages);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      trashedPrefetchInflight.delete(slug);
    });
}

