import { describe, it, expect, vi } from "vitest";
import type { UIMessage } from "ai";

const { messagesDb } = vi.hoisted(() => ({
  messagesDb: [] as Array<{
    conversation_id: string;
    role: string;
    parts: unknown[];
    client_msg_id: string;
    seq: number;
    created_at: string;
  }>,
}));

vi.mock("./client", () => {
  return {
    getSupabaseAdmin: () => ({
      from: (table: string) => {
        if (table === "conversations") {
          return {
            select: () => ({
              eq: () => ({
                is: () => ({
                  or: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { id: "conv-123", title: "Test Chat" },
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "messages") {
          return {
            upsert: vi.fn().mockImplementation((payload) => {
              messagesDb.push({
                ...payload,
                seq: messagesDb.length + 1,
                created_at: new Date().toISOString(),
              });
              return Promise.resolve({ data: payload, error: null });
            }),
            select: () => ({
              eq: (_col: string, convId: string) => {
                let filtered = messagesDb.filter((m) => m.conversation_id === convId);
                const queryObj = {
                  lt: (_c: string, val: number) => {
                    filtered = filtered.filter((m) => m.seq < val);
                    return queryObj;
                  },
                  order: (_c: string, opts: { ascending: boolean }) => {
                    filtered.sort((a, b) =>
                      opts.ascending ? a.seq - b.seq : b.seq - a.seq,
                    );
                    return queryObj;
                  },
                  limit: (limitCount: number) => {
                    const result = filtered.slice(0, limitCount);
                    return Promise.resolve({ data: result, error: null });
                  },
                };
                return queryObj;
              },
            }),
          };
        }
        return {};
      },
    }),
  };
});

vi.mock("@/lib/db/client", () => {
  return {
    getSupabaseAdmin: () => ({
      from: (table: string) => {
        if (table === "conversations") {
          return {
            select: () => ({
              eq: () => ({
                is: () => ({
                  or: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { id: "conv-123", title: "Test Chat" },
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "messages") {
          return {
            upsert: vi.fn().mockImplementation((payload) => {
              messagesDb.push({
                ...payload,
                seq: messagesDb.length + 1,
                created_at: new Date().toISOString(),
              });
              return Promise.resolve({ data: payload, error: null });
            }),
            select: () => ({
              eq: (_col: string, convId: string) => {
                let filtered = messagesDb.filter((m) => m.conversation_id === convId);
                const queryObj = {
                  lt: (_c: string, val: number) => {
                    filtered = filtered.filter((m) => m.seq < val);
                    return queryObj;
                  },
                  order: (_c: string, opts: { ascending: boolean }) => {
                    filtered.sort((a, b) =>
                      opts.ascending ? a.seq - b.seq : b.seq - a.seq,
                    );
                    return queryObj;
                  },
                  limit: (limitCount: number) => {
                    const result = filtered.slice(0, limitCount);
                    return Promise.resolve({ data: result, error: null });
                  },
                };
                return queryObj;
              },
            }),
          };
        }
        return {};
      },
    }),
  };
});

import { getConversationMessages, saveUIMessage } from "./conversations";

describe("saveUIMessage", () => {
  it("assigns a non-empty client_msg_id when message.id is empty", async () => {
    const msg: UIMessage = {
      id: "",
      role: "assistant",
      parts: [{ type: "text", text: "Hello" }],
    };

    await saveUIMessage("conv-123", msg);

    expect(msg.id).toBeTruthy();
    expect(msg.id.length).toBeGreaterThan(0);
  });

  it("preserves an existing client_msg_id", async () => {
    const msg: UIMessage = {
      id: "custom-id-456",
      role: "user",
      parts: [{ type: "text", text: "Test prompt" }],
    };

    await saveUIMessage("conv-123", msg);

    expect(msg.id).toBe("custom-id-456");
  });
});

describe("getConversationMessages backward pagination", () => {
  it("fetches the latest 20 messages in chronological order and signals hasMore", async () => {
    messagesDb.length = 0;
    // Populate 25 messages with seq 1..25
    for (let i = 1; i <= 25; i++) {
      messagesDb.push({
        conversation_id: "conv-123",
        role: i % 2 === 1 ? "user" : "assistant",
        parts: [{ type: "text", text: `Message ${i}` }],
        client_msg_id: `msg-${i}`,
        seq: i,
        created_at: new Date(Date.now() + i * 1000).toISOString(),
      });
    }

    const firstPage = await getConversationMessages("user-1", "conv-123", 20);

    expect(firstPage.messages).toHaveLength(20);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.oldestSeq).toBe(6);
    // Chronological order: first message in array is seq 6, last is seq 25
    expect(firstPage.messages[0].id).toBe("msg-6");
    expect(firstPage.messages[19].id).toBe("msg-25");

    // Next page: scrolling up with beforeSeq = 6
    const secondPage = await getConversationMessages("user-1", "conv-123", 20, 6);

    expect(secondPage.messages).toHaveLength(5);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.oldestSeq).toBe(1);
    expect(secondPage.messages[0].id).toBe("msg-1");
    expect(secondPage.messages[4].id).toBe("msg-5");
  });
});
