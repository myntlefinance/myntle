import { describe, it, expect, vi } from "vitest";
import { saveUIMessage } from "./conversations";
import type { UIMessage } from "ai";

vi.mock("./client", () => {
  const tableData: Record<string, any[]> = { messages: [] };
  return {
    getSupabaseAdmin: () => ({
      from: (table: string) => ({
        upsert: vi.fn().mockImplementation((payload, options) => {
          tableData[table].push(payload);
          return Promise.resolve({ data: payload, error: null });
        }),
      }),
    }),
  };
});

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
