import { describe, expect, it } from "vitest";
import { convertToModelMessages } from "ai";
import { backfillApprovedSwapOutputs } from "./prune";
import { createTools } from "@/lib/ai/tools/registry";

const swapInput = {
  action: "deposit",
  amount: "2000000",
  recipient: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  toAssetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  fromAssetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
  slippageBps: 100,
};

// Shape of an approval granted before prepare_swap had an execute function:
// approval-responded with no output, followed by a new user message.
function poisonedHistory() {
  return [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "prepare a deposit" }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-prepare_swap",
          toolCallId: "call_approved",
          state: "approval-responded",
          input: swapInput,
          approval: { id: "aitxt-1", approved: true },
        },
      ],
    },
    {
      id: "u2",
      role: "user",
      parts: [{ type: "text", text: "did it go through?" }],
    },
  ] as never;
}

describe("backfillApprovedSwapOutputs", () => {
  it("leaves denied approvals alone", () => {
    const messages = poisonedHistory();
    (messages[1] as never as { parts: { approval: { approved: boolean } }[] }).parts[1].approval.approved =
      false;
    const repaired = backfillApprovedSwapOutputs(messages);
    expect(repaired[1].parts[1]).toMatchObject({
      state: "approval-responded",
    });
    expect(repaired[1].parts[1]).not.toHaveProperty("output");
  });

  it("gives historical approved swaps a tool result the provider accepts", async () => {
    const repaired = backfillApprovedSwapOutputs(poisonedHistory());
    expect(repaired[1].parts[1]).toMatchObject({ state: "output-available" });

    const modelMessages = await convertToModelMessages(repaired, {
      tools: createTools(),
    });
    const toolMsg = modelMessages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const result = (toolMsg as { content: unknown[] }).content.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "tool-result" &&
        (c as { toolCallId?: string }).toolCallId === "call_approved",
    );
    expect(result).toBeDefined();
  });

  it("does not touch approvals at or after the last user message", () => {
    const messages = [
      ...poisonedHistory(),
      {
        id: "a2",
        role: "assistant",
        parts: [
          {
            type: "tool-prepare_swap",
            toolCallId: "call_live",
            state: "approval-responded",
            input: swapInput,
            approval: { id: "aitxt-2", approved: true },
          },
        ],
      },
    ] as never;
    const repaired = backfillApprovedSwapOutputs(messages);
    // a1 is history: repaired. a2 is the live turn: untouched.
    expect(repaired[1].parts[1]).toMatchObject({ state: "output-available" });
    expect(repaired[3].parts[0]).toMatchObject({
      state: "approval-responded",
    });
  });
});
