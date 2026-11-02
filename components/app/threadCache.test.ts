import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import type { UIMessage } from "ai";
import {
  getCachedMessages,
  setCachedMessages,
  deleteCachedMessages,
  clearThreadCache,
  messageCache,
} from "./threadCache";

describe("threadCache", () => {
  const store = new Map<string, string>();
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

  beforeAll(() => {
    (globalThis as unknown as { sessionStorage: typeof mockSessionStorage }).sessionStorage = mockSessionStorage;
  });

  afterAll(() => {
    delete (globalThis as unknown as { sessionStorage?: typeof mockSessionStorage }).sessionStorage;
  });

  beforeEach(() => {
    store.clear();
    clearThreadCache();
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
});
