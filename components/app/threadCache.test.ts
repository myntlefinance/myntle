import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import type { UIMessage } from "ai";
import {
  getCachedMessages,
  setCachedMessages,
  deleteCachedMessages,
  clearThreadCache,
  hasTrashedCache,
  loadThreadMessages,
  loadTrashedMessages,
  markThreadRead,
  messageCache,
  prefetchThread,
  prefetchTrashedThread,
  readTrashedCache,
  newestTranscript,
  threadReadRecently,
  trashedMessageCache,
  writeTrashedCache,
} from "./threadCache";

describe("threadCache", () => {
  const store = new Map<string, string>();
  const localStore = new Map<string, string>();
  const mockSessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, val),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  const mockLocalStorage = {
    getItem: (key: string) => localStore.get(key) ?? null,
    setItem: (key: string, val: string) => localStore.set(key, val),
    removeItem: (key: string) => localStore.delete(key),
    clear: () => localStore.clear(),
    key: (i: number) => Array.from(localStore.keys())[i] ?? null,
    get length() {
      return localStore.size;
    },
  };

  beforeAll(() => {
    (globalThis as unknown as { sessionStorage: typeof mockSessionStorage }).sessionStorage = mockSessionStorage;
    (globalThis as unknown as { localStorage: typeof mockLocalStorage }).localStorage = mockLocalStorage;
  });

  afterAll(() => {
    delete (globalThis as unknown as { sessionStorage?: typeof mockSessionStorage }).sessionStorage;
    delete (globalThis as unknown as { localStorage?: typeof mockLocalStorage }).localStorage;
  });

  beforeEach(() => {
    store.clear();
    localStore.clear();
    clearThreadCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sampleMessages: UIMessage[] = [
    {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    },
    {
      id: "msg-2",
      role: "assistant",
      parts: [{ type: "text", text: "Hi there!" }],
    },
  ];

  it("stores and retrieves messages from memory and sessionStorage", () => {
    setCachedMessages("conv-1", sampleMessages);

    // Retrieve from memory
    const fromMem = getCachedMessages("conv-1");
    expect(fromMem).toEqual(sampleMessages);

    // Clear RAM cache only to verify sessionStorage fallback
    messageCache.clear();
    const fromSession = getCachedMessages("conv-1");
    expect(fromSession).toEqual(sampleMessages);
    // Should have repopulated RAM
    expect(messageCache.get("conv-1")).toEqual(sampleMessages);
  });

  it("deletes cached messages from both memory and sessionStorage", () => {
    setCachedMessages("conv-2", sampleMessages);
    expect(getCachedMessages("conv-2")).toBeDefined();

    deleteCachedMessages("conv-2");
    expect(getCachedMessages("conv-2")).toBeUndefined();
    expect(messageCache.get("conv-2")).toBeUndefined();
    expect(mockSessionStorage.getItem("myntle-msgs-conv-2")).toBeNull();
  });

  it("clears all cached threads and session storage keys on clearThreadCache", () => {
    setCachedMessages("conv-a", sampleMessages);
    setCachedMessages("conv-b", sampleMessages);

    clearThreadCache();

    expect(getCachedMessages("conv-a")).toBeUndefined();
    expect(getCachedMessages("conv-b")).toBeUndefined();
    expect(mockSessionStorage.getItem("myntle-msgs-conv-a")).toBeNull();
    expect(mockSessionStorage.getItem("myntle-msgs-conv-b")).toBeNull();
  });

  it("shares one message read between a hover prefetch and the open", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify({ messages: sampleMessages, hasMore: false }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const prefetch = loadThreadMessages("conv-hover", { prefetch: true });
    const open = loadThreadMessages("conv-hover");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("prefetch=1");

    const [first, second] = await Promise.all([prefetch, open]);
    expect(first).toEqual(second);
    expect(first.kind).toBe("ok");
    expect(threadReadRecently("conv-hover")).toBe(true);
    expect(getCachedMessages("conv-hover")).toEqual(sampleMessages);
  });

  it("marks a cold hover as a prefetch and skips a fresh one", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(JSON.stringify({ messages: sampleMessages }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    prefetchThread("conv-cold");
    expect(String(fetchMock.mock.calls[0][0])).toContain("prefetch=1");

    // The open joins the hover read instead of starting a second request.
    await loadThreadMessages("conv-cold");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Once the read landed, another hover has nothing left to warm.
    prefetchThread("conv-cold");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads a trashed preview at the 20-message page size", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(JSON.stringify({ messages: sampleMessages }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    prefetchTrashedThread("trash-1");
    const open = loadTrashedMessages("trash-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("limit=20");
    expect(url).toContain("trashed=1");

    await expect(open).resolves.toEqual({
      kind: "ok",
      body: { messages: sampleMessages },
    });
    expect(trashedMessageCache.get("trash-1")).toEqual(sampleMessages);
  });

  it("treats an empty trash list as a result, not a cache miss", () => {
    expect(hasTrashedCache()).toBe(false);

    writeTrashedCache([]);

    expect(hasTrashedCache()).toBe(true);
    expect(readTrashedCache()).toEqual([]);
  });

  it("remembers an empty trash across a reload", () => {
    mockLocalStorage.setItem("myntle-trashed-v2", "[]");

    expect(hasTrashedCache()).toBe(true);
    expect(readTrashedCache()).toEqual([]);
  });

  it("drops the trash marker on sign-out", () => {
    writeTrashedCache([]);
    clearThreadCache();

    expect(hasTrashedCache()).toBe(false);
  });
});

describe("newestTranscript", () => {
  const message = (id: string): UIMessage => ({
    id,
    role: "assistant",
    parts: [{ type: "text", text: id }],
  });
  const list = (...ids: string[]) => ids.map(message);

  it("keeps the server seed when it carries a turn the cache has not seen", () => {
    const seeded = list("a", "b", "c");
    const cached = list("a", "b");

    expect(newestTranscript(seeded, cached)).toBe(seeded);
  });

  it("keeps a cached reply the server seed predates", () => {
    const seeded = list("a", "b");
    const cached = list("a", "b", "c");

    expect(newestTranscript(seeded, cached)).toBe(cached);
  });

  it("keeps the seed when both sides end on the same turn", () => {
    // Same tail: either copy is equally fresh, so the server's page wins and
    // pagination refills the older pages on demand.
    const seeded = list("c", "d", "e");
    const cached = list("a", "b", "c", "d", "e");

    expect(newestTranscript(seeded, cached)).toBe(seeded);
  });

  it("falls back to whichever side exists", () => {
    expect(newestTranscript(undefined, list("a"))?.length).toBe(1);
    expect(newestTranscript(list("a"), undefined)?.length).toBe(1);
    expect(newestTranscript(undefined, undefined)).toEqual([]);
  });
});

describe("markThreadRead", () => {
  it("measures freshness from when the seed was read, not when it mounted", () => {
    markThreadRead("stale-seed", Date.now() - 60_000);
    expect(threadReadRecently("stale-seed")).toBe(false);

    markThreadRead("fresh-seed");
    expect(threadReadRecently("fresh-seed")).toBe(true);
  });
});
