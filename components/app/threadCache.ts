import type { UIMessage } from "ai";

/* ─────────────────────────────────────────────────────────
 * THREAD CACHE
 * Module-level memory shared by every view that shows chats.
 * ChatView and TrashView both seed their first paint from here
 * and refresh in the background, so navigating between them
 * never flashes an empty list. Nothing here touches React.
 * ───────────────────────────────────────────────────────── */

export type ThreadItem = { id: string; label: string };

export type TrashedItem = { id: string; label: string; deletedAt: string };

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

export function setCachedMessages(slug: string, messages: UIMessage[]) {
  messageCache.set(slug, messages);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(`myntle-msgs-${slug}`, JSON.stringify(messages));
    }
  } catch {
    // Quota or private mode.
  }
}

export function deleteCachedMessages(slug: string) {
  messageCache.delete(slug);
  prefetchInflight.delete(slug);
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

export function clearThreadCache() {
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
    const raw = localStorage.getItem("myntle-threads");
    if (raw) {
      const parsed = JSON.parse(raw) as ThreadItem[];
      if (Array.isArray(parsed)) {
        threadsMemoryCache = parsed;
        return parsed;
      }
    }
  } catch {
    // Ignore and fall through to empty.
  }
  return [];
}

export function writeThreadsCache(items: ThreadItem[]) {
  threadsMemoryCache = items;
  try {
    localStorage.setItem("myntle-threads", JSON.stringify(items));
  } catch {
    // Private mode. Memory cache still covers the session.
  }
}

// Synchronous name lookup so a switching chat never paints "New chat"
// for a frame. Memory first, then the persisted sidebar list.
export function findThreadLabel(slug: string | null): string | null {
  if (!slug) return null;
  if (threadsMemoryCache) {
    const hit = threadsMemoryCache.find((t) => t.id === slug);
    if (hit) return hit.label;
  }
  try {
    const raw = localStorage.getItem("myntle-threads");
    if (raw) {
      const parsed = JSON.parse(raw) as ThreadItem[];
      const hit = Array.isArray(parsed)
        ? parsed.find((t) => t.id === slug)
        : undefined;
      if (hit) return hit.label;
    }
  } catch {
    // Ignore and fall through to null.
  }
  return null;
}

export function readTrashedCache(): TrashedItem[] {
  if (trashedMemoryCache) return trashedMemoryCache;
  try {
    const raw = localStorage.getItem("myntle-trashed");
    if (raw) {
      const parsed = JSON.parse(raw) as TrashedItem[];
      if (Array.isArray(parsed)) {
        trashedMemoryCache = parsed;
        return parsed;
      }
    }
  } catch {
    // Ignore and fall through to empty.
  }
  return [];
}

export function writeTrashedCache(items: TrashedItem[]) {
  trashedMemoryCache = items;
  try {
    localStorage.setItem("myntle-trashed", JSON.stringify(items));
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
        conversations?: Array<{ slug: string; title: string }>;
      } | null;
      if (!body?.conversations) return readThreadsCache();
      const items = body.conversations.map((c) => ({
        id: c.slug,
        label: c.title,
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
        conversations?: Array<{ slug: string; title: string; deletedAt: string }>;
      } | null;
      if (!body?.conversations) return readTrashedCache();
      const items = body.conversations.map((c) => ({
        id: c.slug,
        label: c.title,
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

