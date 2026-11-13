import type { UIMessage } from "ai";
import { assetName, inputOf, outputOf, stateOf, str, toolNameOf, type AssetMeta, type ToolPart } from "./toolParts";
import {
  approvalDecision,
  approvalIdOf,
  type ApprovalDecisions,
  type ApprovalStatus,
} from "./approvals";
import { getApprovalTx } from "./approvalStore";

/**
 * The limit-order proposals in one turn.
 *
 * The figures come from the stored `get_limit_order_quote` output, never from
 * the model's prose. `prepare_limit_order` only names the quote it is
 * proposing, so a card can never borrow another order's price or size.
 */
export type LimitOrderInfo = {
  approvalId: string;
  status: ApprovalStatus;
  requestedAt: string;
  side: "BUY" | "SELL";
  baseAssetId: string;
  quoteAssetId: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseChain?: string;
  quoteChain?: string;
  /** Base quantity in whole units, for the sentence. */
  quantity: string;
  /** Base quantity in the smallest unit, for the record. */
  quantityRaw: string;
  price: string;
  /** Quote-side total in whole units. */
  total: string;
  /** Quote-side total in the smallest unit. */
  totalRaw: string;
  funding: "account" | "wallet";
  /** Which signer priced the quote. The server binds the exact account. */
  accountKind?: "wallet" | "passkey";
  quoteId?: string;
  expiresAt?: string;
  transactionId?: string;
  depositAddress?: string;
  orderId?: string;
  fillStatus?: string;
  payoutStatus?: string;
  filled?: string;
  filledPercent?: number;
  deadline?: string;
};

function requestedAtOf(message: UIMessage): string {
  const metadata = message.metadata as { createdAt?: unknown } | undefined;
  return typeof metadata?.createdAt === "string" && metadata.createdAt.length > 0
    ? metadata.createdAt
    : new Date().toISOString();
}

export function collectLimitOrders(
  message: UIMessage,
  symbols: Map<string, string>,
  meta: Map<string, AssetMeta>,
  decisions?: ApprovalDecisions | null,
): LimitOrderInfo[] {
  const requestedAt = requestedAtOf(message);
  type Candidate = {
    quoteId: string;
    side: "BUY" | "SELL";
    baseAssetId: string;
    quoteAssetId: string;
    quantityRaw: string;
    quantity: string;
    price: string;
    total: string;
    totalRaw: string;
    funding: "account" | "wallet";
    accountKind?: "wallet" | "passkey";
    expiresAt?: string;
  };
  const candidates = new Map<string, Candidate>();
  for (const part of message.parts) {
    const p = part as ToolPart;
    if (toolNameOf(p) !== "get_limit_order_quote") continue;
    if (!stateOf(p).startsWith("output")) continue;
    const out = outputOf(p);
    const quoteId = str(out.quoteId);
    if (!quoteId) continue;
    const side = out.side === "BUY" ? "BUY" : out.side === "SELL" ? "SELL" : null;
    const baseAssetId = str(out.baseAssetId);
    const quoteAssetId = str(out.quoteAssetId);
    if (!side || !baseAssetId || !quoteAssetId) continue;
    candidates.set(quoteId, {
      quoteId,
      side,
      baseAssetId,
      quoteAssetId,
      quantityRaw: str(out.quantityRaw) ?? "",
      quantity: str(out.quantityFormatted) ?? "",
      price: str(out.price) ?? "",
      total: str(out.totalFormatted) ?? "",
      totalRaw: str(out.totalRaw) ?? "",
      funding: out.funding === "wallet" ? "wallet" : "account",
      accountKind:
        out.accountKind === "passkey" || out.accountKind === "wallet"
          ? out.accountKind
          : undefined,
      expiresAt: str(out.expiresAt) ?? undefined,
    });
  }

  const out: LimitOrderInfo[] = [];
  for (const part of message.parts) {
    const p = part as ToolPart;
    if (toolNameOf(p) !== "prepare_limit_order") continue;
    const state = stateOf(p);
    if (state !== "approval-requested" && state !== "approval-responded") {
      continue;
    }
    const approvalId = approvalIdOf(p);
    if (!approvalId) continue;
    const input = inputOf(p);
    const quoteId = str(input.quoteId);
    if (!quoteId) continue;
    const candidate = candidates.get(quoteId);
    if (!candidate) continue;

    const decision = approvalDecision(p);
    const recorded = decisions?.[approvalId];
    const stored = getApprovalTx(approvalId);
    const denied = recorded === "denied" || decision === false;
    const status: ApprovalStatus = denied
      ? "denied"
      : recorded === "approved" || decision === true || stored
        ? "approved"
        : "awaiting";

    out.push({
      approvalId,
      status,
      requestedAt,
      side: candidate.side,
      baseAssetId: candidate.baseAssetId,
      quoteAssetId: candidate.quoteAssetId,
      baseSymbol: assetName(candidate.baseAssetId, symbols),
      quoteSymbol: assetName(candidate.quoteAssetId, symbols),
      baseChain: meta.get(candidate.baseAssetId)?.chain,
      quoteChain: meta.get(candidate.quoteAssetId)?.chain,
      quantity: candidate.quantity,
      quantityRaw: candidate.quantityRaw,
      price: candidate.price,
      total: candidate.total,
      totalRaw: candidate.totalRaw,
      funding: candidate.funding,
      accountKind: candidate.accountKind,
      quoteId: candidate.quoteId,
      expiresAt: candidate.expiresAt,
      transactionId: stored?.transactionId,
      depositAddress: stored?.depositAddress,
      orderId: stored?.orderId,
    });
  }
  return out;
}
