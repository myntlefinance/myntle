import { describe, expect, it } from "vitest";
import { convertToModelMessages } from "ai";
import {
  backfillApprovedSwapOutputs,
  pruneHistoricalToolOutputs,
} from "./prune";
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

describe("pruneHistoricalToolOutputs", () => {
  function balanceHistory(showCard: boolean) {
    return [
      { id: "u1", role: "user", parts: [{ type: "text", text: "check USDC" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-get_wallet_balances",
            toolCallId: "call-check",
            state: "output-available",
            output: {
              source: "session",
              totalValueUsd: 5.2,
              showCard,
            },
          },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "and then?" }] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "..." }] },
    ] as never;
  }

  it("records that a single-asset check drew no table", () => {
    const pruned = pruneHistoricalToolOutputs(balanceHistory(false));

    expect(pruned[1].parts[0]).toMatchObject({
      output: {
        showCard: false,
        summary: expect.stringContaining("no table was drawn"),
      },
    });
  });

  it("keeps the card summary for an inventory result", () => {
    const pruned = pruneHistoricalToolOutputs(balanceHistory(true));

    expect(pruned[1].parts[0]).toMatchObject({
      output: {
        showCard: true,
        summary: expect.stringContaining("Detailed card was rendered"),
      },
    });
  });

  it("compacts older news outputs and leaves the newest turn intact", () => {
    const newsOutput = {
      source: "google-news",
      query: "solana etf",
      totalItems: 20,
      searchId: "abc123",
      items: Array.from({ length: 12 }, (_, i) => ({
        title: `Story ${i + 1}`,
        snippet: "x".repeat(2000),
      })),
    };
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "news on solana etf" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-get_google_news",
            toolCallId: "call-news-old",
            state: "output-available",
            output: newsOutput,
          },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "more on story 1" }] },
      {
        id: "a2",
        role: "assistant",
        parts: [
          {
            type: "tool-get_page_content",
            toolCallId: "call-page-new",
            state: "output-available",
            output: { source: "page", query: "story 1", items: [{ title: "Full text here" }] },
          },
        ],
      },
    ] as never;
    const pruned = pruneHistoricalToolOutputs(messages);

    // Older turn compacted to a summary; full snippets gone.
    expect(pruned[1].parts[0]).toMatchObject({
      output: {
        summary: {
          source: "google-news",
          query: "solana etf",
          count: 20,
          searchId: "abc123",
          note: expect.stringContaining("compacted"),
        },
      },
    });
    expect((pruned[1].parts[0] as unknown as { output: { summary: { titles: unknown[] } } }).output.summary.titles).toHaveLength(8);
    expect(JSON.stringify(pruned[1].parts[0])).not.toContain("x".repeat(100));
    // Newest assistant turn untouched.
    expect(pruned[3].parts[0]).toMatchObject({
      output: { items: [{ title: "Full text here" }] },
    });
  });

  it("compacts news outputs in the toolInvocation.result shape", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "x posts" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-get_x_posts",
            toolInvocation: {
              toolName: "get_x_posts",
              result: {
                source: "x",
                query: "myntle",
                items: [{ title: "Post one" }],
              },
            },
          },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "ok" }] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "done" }] },
    ] as never;
    const pruned = pruneHistoricalToolOutputs(messages);

    expect(pruned[1].parts[0]).toMatchObject({
      toolInvocation: {
        result: {
          summary: {
            source: "x",
            query: "myntle",
            count: 1,
            titles: ["Post one"],
          },
        },
      },
    });
  });

  it("does not touch quote or status outputs", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "quote please" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-get_quote",
            toolCallId: "call-quote",
            state: "output-available",
            output: { amountOut: "1.5", minAmountOut: "1.4" },
          },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "and?" }] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "..." }] },
    ] as never;
    const pruned = pruneHistoricalToolOutputs(messages);

    expect(pruned[1]).toBe(messages[1]);
  });
});
