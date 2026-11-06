import { describe, it, expect } from "vitest";
import {
  approvalToMarkdown,
  balanceViewToMarkdown,
  buildAgentCopyHtml,
  buildAgentCopyText,
  type AgentCopySegment,
} from "@/components/app/agentCopy";
import type { ApprovalInfo } from "@/components/app/approvals";

const groups = [
  {
    id: "base",
    name: "Base",
    icon: "base",
    items: [
      {
        id: "usdc",
        symbol: "USDC",
        name: "USD Coin",
        amount: "100",
        valueUsd: 100,
        category: "stables" as const,
      },
      {
        id: "eth",
        symbol: "ETH",
        name: "Ether",
        amount: "0.5",
        valueUsd: 1500,
        category: "native" as const,
      },
    ],
  },
];

const approval: ApprovalInfo = {
  approvalId: "appr_1",
  status: "awaiting",
  requestedAt: new Date().toISOString(),
  action: "swap",
  fromAssetId: "usdc-base",
  fromSymbol: "USDC",
  fromChain: "Base",
  toAssetId: "near-near",
  toSymbol: "NEAR",
  toChain: "NEAR",
  amountIn: "100",
  amountOut: "95",
  amountOutUsd: "$500.00",
  minAmountOut: "94",
  recipient: "0xrecipient",
  slippageBps: 100,
};

describe("agentCopy", () => {
  it("serializes a balance card as a markdown table, not just prose", () => {
    const md = balanceViewToMarkdown({
      title: "Portfolio balances",
      groups,
    });
    expect(md).toContain("Portfolio balances");
    expect(md).toContain("| Network | Asset | Amount | Value |");
    expect(md).toContain("USDC");
    expect(md).toContain("$1,600.00");
  });

  it("serializes a trade card with the signed parameters", () => {
    const md = approvalToMarkdown(approval, null);
    expect(md).toContain("Swap 100 USDC for 95 NEAR");
    expect(md).toContain("Minimum received: 94 NEAR");
    expect(md).toContain("Recipient: 0xrecipient");
    expect(md).toContain("Pending");
  });

  it("builds one transcript in visual order, excluding tool calls", () => {
    const segments: AgentCopySegment[] = [
      { kind: "text", text: "Here is what I found." },
      {
        kind: "balance",
        view: { title: "Portfolio balances", groups },
      },
      { kind: "approval", approval, settlement: null },
    ];
    const text = buildAgentCopyText(segments);
    expect(text).toContain("Here is what I found.");
    expect(text).toContain("Portfolio balances");
    expect(text).toContain("Swap 100 USDC");
    // Tool pill labels never enter the transcript.
    expect(text).not.toContain("Ran 2 tools");
    expect(text).not.toContain("Thought for");

    const html = buildAgentCopyHtml(segments);
    expect(html).toContain("<table>");
    expect(html).toContain("USDC");
  });

  it("strips asset tags from copied prose but keeps code literal", () => {
    const text = buildAgentCopyText([
      {
        kind: "text",
        text: "The balance is <asset>USDC</asset>.\n\n```text\n<asset>USDC</asset>\n```",
      },
    ]);
    expect(text).toContain("The balance is USDC.");
    expect(text).toContain("```text\n<asset>USDC</asset>\n```");

    const html = buildAgentCopyHtml([
      { kind: "text", text: "The balance is <asset>USDC</asset>." },
    ]);
    expect(html).toContain("The balance is USDC.");
    expect(html).not.toContain("<asset>");
  });

  it("marks denied and settled states from trusted records, not prose", () => {
    const denied = approvalToMarkdown(
      { ...approval, status: "denied" },
      null,
    );
    expect(denied).toContain("Rejected");
    const settled = approvalToMarkdown(approval, {
      state: "settled",
      transactionId: "tx_1",
    });
    expect(settled).toContain("Executed");
  });
});
