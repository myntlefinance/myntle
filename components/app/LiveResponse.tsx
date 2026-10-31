"use client";

import type { UIMessage } from "ai";
import ActivityPills, {
  type ActivityBlock,
} from "@/components/app/ActivityPills";
import type { ToolStep } from "@/components/primitives/ToolChips";

/**
 * The assistant's live reply.
 *
 * The message parts arrive in stream order — reasoning deltas between tool
 * rounds, tool calls, and text — and are grouped into activity blocks in
 * that order: consecutive reasoning deltas form one thinking pill, a tool
 * part breaks the run and the next tool call continues the same pills, and
 * text renders as markdown through `components/app/Markdown`. Each
 * interrupt (a new tool run, new thinking after a result) therefore starts
 * a fresh pill; see
 * `components/app/ActivityPills` for the pill lifecycle.
 */
export function LiveResponse({
  message,
  status,
}: {
  message: UIMessage;
  status: "submitted" | "streaming" | "ready" | "error";
}) {
  const blocks: ActivityBlock[] = [];
  for (const part of message.parts) {
    if (part.type === "reasoning") {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "reasoning") last.text += part.text;
      else blocks.push({ kind: "reasoning", text: part.text });
    } else if (part.type.startsWith("tool-")) {
      const tool = part as { type: string; state?: string; input?: unknown };
      const step: ToolStep = {
        icon: "think",
        label: toolLabel(tool.type),
        chip: toolChip(tool),
        mono: false,
        detailMono: false,
        detail: [],
      };
      const last = blocks[blocks.length - 1];
      if (last?.kind === "tools") last.steps.push(step);
      else blocks.push({ kind: "tools", steps: [step] });
    } else if (part.type === "text" && part.text.length > 0) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "text") last.text += part.text;
      else blocks.push({ kind: "text", text: part.text });
    }
  }

  const running = status === "submitted" || status === "streaming";

  return (
    <article
      className="min-w-0"
      style={{ animation: "fade-up 450ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <ActivityPills blocks={blocks} running={running} />
    </article>
  );
}

function toolLabel(type: string): string {
  switch (type) {
    case "tool-get_quote":
      return "Quoted a price";
    case "tool-get_wallet_balances":
      return "Read balances";
    case "tool-get_supported_assets":
      return "Checked available assets";
    case "tool-get_transaction_status":
      return "Checked a trade";
    case "tool-prepare_swap":
      return "Prepared a trade";
    default:
      return "Working";
  }
}

function toolChip(part: { state?: string; input?: unknown }): string {
  if (part.state === "input-available" || part.state === "output-available") {
    const input = part.input as
      | { fromAssetId?: string; toAssetId?: string }
      | undefined;
    if (input?.fromAssetId && input?.toAssetId) {
      return `${short(input.fromAssetId)} → ${short(input.toAssetId)}`;
    }
    return "done";
  }
  if (part.state === "approval-requested") return "awaiting approval";
  return "working";
}

function short(assetId: string): string {
  const tail = assetId.split(":").pop() ?? assetId;
  return tail.length > 20 ? `…${tail.slice(-18)}` : tail;
}
