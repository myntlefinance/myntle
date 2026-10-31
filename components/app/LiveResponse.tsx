"use client";

import type { UIMessage } from "ai";
import StreamingText from "@/components/primitives/StreamingText";
import ThinkingState from "@/components/primitives/ThinkingState";
import ToolChips from "@/components/primitives/ToolChips";
import type { ToolStep } from "@/components/primitives/ToolChips";

/**
 * The assistant's live reply.
 *
 * It uses the same primitives the demo uses, so the thinking state, the tool
 * chips and the streaming text look exactly as they do in the harness. The
 * only difference is where the content comes from.
 */
export function LiveResponse({
  message,
  status,
}: {
  message: UIMessage;
  status: "submitted" | "streaming" | "ready" | "error";
}) {
  const text = message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");

  const steps: ToolStep[] = message.parts
    .filter((p): p is Extract<typeof p, { type: `tool-${string}` }> =>
      p.type.startsWith("tool-"),
    )
    .map((part) => ({
      icon: "think",
      label: toolLabel(part.type),
      chip: toolChip(part),
      mono: false,
      detailMono: false,
      detail: [],
    }));

  const waiting = status === "submitted" && text.length === 0 && steps.length === 0;

  return (
    <article
      className="min-w-0"
      style={{ animation: "fade-up 450ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      {steps.length > 0 ? (
        <div className="mb-4">
          <ToolChips steps={steps} />
        </div>
      ) : null}

      {waiting ? (
        <div className="flex min-h-6 items-center" style={{ animation: "fade-in 200ms ease-out both" }}>
          <ThinkingState />
        </div>
      ) : null}

      {text.length > 0 ? (
        <div style={{ animation: "fade-in 260ms ease both" }}>
          <StreamingText
            content={text.split(" ").map((word) => ({ text: word + " " }))}
          />
        </div>
      ) : null}
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
