import type { AssetGroup } from "@/lib/wallet/balances";
import type { ApprovalInfo, SettlementSnapshot } from "@/components/app/approvals";
import { settlementCardState } from "@/components/app/approvals";
import { stripAssetMarkup } from "@/components/app/assetMarkup";
import { actionTitle } from "@/lib/trade/action";

/**
 * Copyable transcript for an assistant turn.
 *
 * The copy button must reproduce what the reader actually sees: the reply
 * prose (which already carries markdown tables as source), plus the landmark
 * cards that never appear in that prose — the balance matrix and the trade
 * approval card. Tool pills and thinking traces are deliberately excluded:
 * they describe the run, not the answer.
 *
 * This module is the single place that decides that shape, so LiveResponse
 * and any future surface copy the same markdown in the same order.
 */

export type AgentCopyBalanceView = {
  title: string;
  address?: string;
  chain?: string;
  totalValueUsd?: number;
  groups: AssetGroup[];
};

export type AgentCopySegment =
  | { kind: "text"; text: string }
  | { kind: "balance"; view: AgentCopyBalanceView }
  | {
      kind: "approval";
      approval: ApprovalInfo;
      settlement?: SettlementSnapshot | null;
    };

/** Human state for the card, matching the SentenceTradeCard pill. */
export function approvalCopyState(
  approval: ApprovalInfo,
  settlement?: SettlementSnapshot | null,
): string {
  if (approval.status === "denied") return "Rejected";
  const snap = settlement ? settlementCardState(settlement.state) : null;
  if (snap === "settled") return "Executed";
  if (snap === "refunded") return "Refunded";
  if (snap === "failed") return "Failed";
  if (approval.status === "approved") return "Approved";
  return "Pending";
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\n\r]+/g, " ").trim();
}

export function formatCopyUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function sumGroups(groups: AssetGroup[]): number {
  let total = 0;
  for (const group of groups) {
    for (const item of group.items) {
      if (typeof item.valueUsd === "number" && Number.isFinite(item.valueUsd)) {
        total += item.valueUsd;
      }
    }
  }
  return total;
}

export function balanceViewToMarkdown(view: AgentCopyBalanceView): string {
  const total =
    typeof view.totalValueUsd === "number" && Number.isFinite(view.totalValueUsd)
      ? view.totalValueUsd
      : sumGroups(view.groups);
  const lines: string[] = [`## ${view.title} — ${formatCopyUsd(total)}`];
  if (view.address) {
    lines.push(
      view.chain ? `Wallet: ${view.address} (${view.chain})` : `Wallet: ${view.address}`,
    );
  }
  const rows: string[] = [];
  for (const group of view.groups) {
    for (const item of group.items) {
      rows.push(
        `| ${cell(group.name)} | ${cell(item.symbol)} | ${cell(item.amount)} | ${cell(formatCopyUsd(item.valueUsd))} |`,
      );
    }
  }
  if (rows.length > 0) {
    lines.push(
      "| Network | Asset | Amount | Value |",
      "| --- | --- | --- | --- |",
      ...rows,
    );
  } else {
    lines.push("No holdings found in this category.");
  }
  return lines.join("\n");
}

function rateOf(amountIn: string, amountOut: string): string | null {
  const rate =
    Number(amountOut.replace(/,/g, "")) / Number(amountIn.replace(/,/g, ""));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return String(Number(rate.toPrecision(4)));
}

export function approvalToMarkdown(
  approval: ApprovalInfo,
  settlement?: SettlementSnapshot | null,
): string {
  const state = approvalCopyState(approval, settlement);
  const verb = actionTitle(approval.action);
  const headline =
    approval.action === "deposit"
      ? `${verb} ${approval.amountIn} ${approval.fromSymbol} to Near Account [${state}]`
      : approval.action === "withdraw"
        ? `${verb} ${approval.amountIn} ${approval.fromSymbol} to ${approval.recipient} [${state}]`
        : `${verb} ${approval.amountIn} ${approval.fromSymbol} for ${approval.amountOut} ${approval.toSymbol} on Near Account [${state}]`;
  const lines = [`## ${headline}`];
  const fromLeg = approval.fromChain
    ? `${approval.fromSymbol} on ${approval.fromChain}`
    : approval.fromSymbol;
  const toLeg = approval.toChain
    ? `${approval.toSymbol} on ${approval.toChain}`
    : approval.toSymbol;
  if (approval.action !== "deposit") lines.push(`- From: ${fromLeg}`);
  if (approval.action !== "withdraw") lines.push(`- To: ${toLeg}`);
  if (approval.amountOutUsd) lines.push(`- Estimated value: ${approval.amountOutUsd}`);
  if (approval.minAmountOut) {
    lines.push(`- Minimum received: ${approval.minAmountOut} ${approval.toSymbol}`);
  }
  lines.push(`- Recipient: ${approval.recipient}`);
  const rate =
    approval.action !== "deposit" && approval.action !== "withdraw"
      ? rateOf(approval.amountIn, approval.amountOut)
      : null;
  if (rate) {
    lines.push(`- Rate: 1 ${approval.fromSymbol} ≈ ${rate} ${approval.toSymbol}`);
  }
  const slippage = (approval.slippageBps / 100).toFixed(2);
  lines.push(`- Slippage: ${slippage}%`);
  if (approval.expiresAt) lines.push(`- Price held until: ${approval.expiresAt}`);
  if (approval.transactionId) lines.push(`- Transaction: ${approval.transactionId}`);
  const deposit = settlement?.depositAddress ?? approval.depositAddress;
  if (deposit) lines.push(`- Deposit to: ${deposit}`);
  const explorers = settlement?.explorerUrls ?? [];
  for (const url of explorers.slice(0, 2)) {
    lines.push(`- Settlement: ${url}`);
  }
  return lines.join("\n");
}

/** Ordered segments joined as one markdown document. */
export function buildAgentCopyText(segments: AgentCopySegment[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "text") {
      const text = stripAssetMarkup(segment.text.trim());
      if (text) parts.push(text);
    } else if (segment.kind === "balance") {
      parts.push(balanceViewToMarkdown(segment.view));
    } else {
      parts.push(approvalToMarkdown(segment.approval, segment.settlement));
    }
  }
  return parts.join("\n\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTML twin of the markdown transcript, for rich paste targets. Text blocks
 * stay as plain paragraphs (their markdown tables remain readable source);
 * cards become real tables and lists so spreadsheets and docs keep shape.
 */
export function buildAgentCopyHtml(segments: AgentCopySegment[]): string {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "text") {
      const text = stripAssetMarkup(segment.text.trim());
      if (!text) continue;
      const paras = text.split(/\n{2,}/);
      for (const para of paras) {
        out.push(`<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`);
      }
    } else if (segment.kind === "balance") {
      const view = segment.view;
      const total =
        typeof view.totalValueUsd === "number" && Number.isFinite(view.totalValueUsd)
          ? view.totalValueUsd
          : sumGroups(view.groups);
      out.push(
        `<h3>${escapeHtml(view.title)} — ${escapeHtml(formatCopyUsd(total))}</h3>`,
      );
      if (view.address) {
        out.push(
          `<p>Wallet: ${escapeHtml(view.address)}${view.chain ? ` (${escapeHtml(view.chain)})` : ""}</p>`,
        );
      }
      out.push(
        "<table><thead><tr><th>Network</th><th>Asset</th><th>Amount</th><th>Value</th></tr></thead><tbody>",
      );
      for (const group of view.groups) {
        for (const item of group.items) {
          out.push(
            `<tr><td>${escapeHtml(group.name)}</td><td>${escapeHtml(item.symbol)}</td><td>${escapeHtml(item.amount)}</td><td>${escapeHtml(formatCopyUsd(item.valueUsd))}</td></tr>`,
          );
        }
      }
      out.push("</tbody></table>");
    } else {
      const approval = segment.approval;
      const state = approvalCopyState(approval, segment.settlement);
      const verb = actionTitle(approval.action);
      const headline =
        approval.action === "deposit"
          ? `${verb} ${approval.amountIn} ${approval.fromSymbol} to Near Account [${state}]`
          : approval.action === "withdraw"
            ? `${verb} ${approval.amountIn} ${approval.fromSymbol} to ${approval.recipient} [${state}]`
            : `${verb} ${approval.amountIn} ${approval.fromSymbol} for ${approval.amountOut} ${approval.toSymbol} on Near Account [${state}]`;
      out.push(`<h3>${escapeHtml(headline)}</h3><ul>`);
      if (approval.action !== "deposit") {
        out.push(
          `<li>From: ${escapeHtml(approval.fromChain ? `${approval.fromSymbol} on ${approval.fromChain}` : approval.fromSymbol)}</li>`,
        );
      }
      if (approval.action !== "withdraw") {
        out.push(
          `<li>To: ${escapeHtml(approval.toChain ? `${approval.toSymbol} on ${approval.toChain}` : approval.toSymbol)}</li>`,
        );
      }
      if (approval.minAmountOut) {
        out.push(
          `<li>Minimum received: ${escapeHtml(`${approval.minAmountOut} ${approval.toSymbol}`)}</li>`,
        );
      }
      out.push(`<li>Recipient: ${escapeHtml(approval.recipient)}</li>`);
      out.push(`<li>Slippage: ${escapeHtml(`${(approval.slippageBps / 100).toFixed(2)}%`)}</li>`);
      if (approval.expiresAt) {
        out.push(`<li>Price held until: ${escapeHtml(approval.expiresAt)}</li>`);
      }
      if (approval.transactionId) {
        out.push(`<li>Transaction: ${escapeHtml(approval.transactionId)}</li>`);
      }
      out.push("</ul>");
    }
  }
  return out.join("\n");
}

/**
 * Writes both clipboard flavors so prose pastes as markdown and cards paste
 * as tables. Falls back to plain text where ClipboardItem is unavailable.
 */
export async function writeAgentCopy(payload: {
  text: string;
  html?: string;
}): Promise<boolean> {
  const text = payload.text.trim();
  if (!text) return false;
  if (typeof navigator === "undefined") return false;
  const clipboard = navigator.clipboard;
  if (!clipboard) return false;
  const html = payload.html?.trim();
  try {
    if (
      html &&
      typeof ClipboardItem !== "undefined" &&
      typeof clipboard.write === "function"
    ) {
      const item = new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      await clipboard.write([item]);
      return true;
    }
  } catch {
    // Fall through to plain-text write below.
  }
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
