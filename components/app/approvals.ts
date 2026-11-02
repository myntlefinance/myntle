import type { UIMessage } from "ai";
import { parseTradeAction, type TradeAction } from "@/lib/trade/action";
import {
  assetName,
  formatAmount,
  inputOf,
  outputOf,
  stateOf,
  str,
  toolNameOf,
  type AssetMeta,
  type ToolPart,
} from "./toolParts";
import {
  getApprovalTx,
  isApprovalDenied,
  rememberApprovalDenied,
} from "./approvalStore";

export type ApprovalStatus = "awaiting" | "approved" | "denied";

/** One settlement row from the database, keyed by tool approval id. */
export type SettlementSnapshot = {
  state: string;
  transactionId: string;
  depositAddress?: string | null;
  explorerUrls?: string[];
};

/** Terminal database states painted directly; anything else keeps polling. */
export function settlementCardState(
  state: string,
): "settled" | "refunded" | "failed" | null {
  if (state === "settled") return "settled";
  if (state === "refunded") return "refunded";
  if (
    state === "failed" ||
    state === "incomplete_deposit" ||
    state === "needs_reconciliation"
  ) {
    return "failed";
  }
  return null;
}

export type ApprovalInfo = {
  approvalId: string;
  status: ApprovalStatus;
  /** Card birth: the host message's creation time, stable across reloads. */
  requestedAt: string;
  action: TradeAction;
  fromAssetId: string;
  fromSymbol: string;
  fromChain?: string;
  toAssetId: string;
  toSymbol: string;
  toChain?: string;
  amountIn: string;
  amountInUsd?: string;
  amountOut: string;
  amountOutUsd?: string;
  /** Current unit price of each side, when the catalogue priced it. */
  fromPriceUsd?: string;
  toPriceUsd?: string;
  minAmountOut?: string;
  minAmountOutRaw?: string;
  recipient: string;
  expiresAt?: string;
  slippageBps: number;
  swapInput?: {
    fromAssetId: string;
    toAssetId: string;
    amount: string;
    recipient: string;
    slippageBps?: number;
  };
  transactionId?: string;
  depositAddress?: string;
};

export function approvalIdOf(part: ToolPart): string | null {
  if (typeof part.approval === "object" && part.approval !== null) {
    const id = (part.approval as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

/** The user's decision on a responded part, or null while still waiting. */
export function approvalDecision(part: ToolPart): boolean | null {
  if (stateOf(part) !== "approval-responded") return null;
  const approval = part.approval;
  if (typeof approval === "object" && approval !== null) {
    const approved = (approval as { approved?: unknown }).approved;
    if (approved === true) return true;
    if (approved === false) return false;
  }
  return null;
}

export function collectApprovals(
  message: UIMessage,
  symbols: Map<string, string>,
  meta: Map<string, AssetMeta>,
  activeAddress?: string | null,
): ApprovalInfo[] {
  const parts = message.parts;
  // The card's birth is the host message's creation time: the row's
  // created_at on reload, the stream start live. Either way it is saved in
  // Supabase and never moves when the decision update lands.
  const metadata = message.metadata as { createdAt?: unknown } | undefined;
  const requestedAt =
    typeof metadata?.createdAt === "string" && metadata.createdAt.length > 0
      ? metadata.createdAt
      : new Date().toISOString();
  // The figures live on the latest get_quote output in the turn; the
  // approval input carries the pair the user actually agreed to.
  let quoted: Record<string, unknown> | null = null;
  for (const part of parts) {
    const p = part as ToolPart;
    if (toolNameOf(p) === "get_quote" && stateOf(p).startsWith("output")) {
      const out = outputOf(p);
      if (out.amountIn && out.amountOut) quoted = out;
    }
  }

  const out: ApprovalInfo[] = [];
  for (const part of parts) {
    const p = part as ToolPart;
    if (toolNameOf(p) !== "prepare_swap") continue;
    const state = stateOf(p);
    if (state !== "approval-requested" && state !== "approval-responded") continue;
    const approvalId = approvalIdOf(p);
    if (!approvalId) continue;
    const input = inputOf(p);
    const fromAssetId = str(input.fromAssetId);
    const toAssetId = str(input.toAssetId);
    const amount = str(input.amount);
    const recipient = str(input.recipient);
    if (!fromAssetId || !toAssetId || !amount || !recipient) continue;

    // The part state is the primary record; the store covers snapshots saved
    // before the decision landed, which still read as "requested".
    const decision = approvalDecision(p);
    if (decision === false) rememberApprovalDenied(approvalId);
    const stored = getApprovalTx(approvalId);
    const denied = decision === false || isApprovalDenied(approvalId);
    const status: ApprovalStatus = denied
      ? "denied"
      : decision === true || stored
        ? "approved"
        : "awaiting";

    // Display figures are truncated for humans; the raw values stay on
    // the signed message and the server record.
    const rawIn = str(quoted?.amountIn) ?? amount;
    const rawOut = str(quoted?.amountOut);
    const rawMin = str(quoted?.minAmountOut);
    // The action names what the money does, decided by the application —
    // never by the model alone. The same ticker landing back in the user's
    // own account is a deposit, plain and simple, no matter which label the
    // turn carried. Address formats never collide across ecosystems, so an
    // exact address match is sufficient with no chain check.
    const fromSymbol = assetName(fromAssetId, symbols);
    const toSymbol = assetName(toAssetId, symbols);
    const toSelf =
      !!activeAddress &&
      !!recipient &&
      activeAddress.toLowerCase() === recipient.toLowerCase();
    const action: TradeAction =
      fromSymbol.toUpperCase() === toSymbol.toUpperCase() && toSelf
        ? "deposit"
        : parseTradeAction(input.action);
    out.push({
      approvalId,
      status,
      requestedAt,
      action,
      fromAssetId,
      fromSymbol,
      fromChain: meta.get(fromAssetId)?.chain,
      toAssetId,
      toSymbol,
      toChain: meta.get(toAssetId)?.chain,
      amountIn: formatAmount(rawIn),
      amountInUsd: usd(rawIn, meta.get(fromAssetId)?.priceUsd),
      amountOut: rawOut ? formatAmount(rawOut) : "—",
      amountOutUsd: asUsd(str(quoted?.amountOutUsd)),
      fromPriceUsd: formatUnitPrice(meta.get(fromAssetId)?.priceUsd),
      toPriceUsd: formatUnitPrice(meta.get(toAssetId)?.priceUsd),
      minAmountOut: rawMin ? formatAmount(rawMin) : undefined,
      minAmountOutRaw: str(quoted?.minAmountOutRaw) ?? undefined,
      recipient,
      expiresAt: str(quoted?.expiresAt) ?? undefined,
      slippageBps:
        typeof input.slippageBps === "number" ? input.slippageBps : 100,
      swapInput:
        status === "awaiting"
          ? {
              fromAssetId,
              toAssetId,
              amount,
              recipient,
              slippageBps:
                typeof input.slippageBps === "number" ? input.slippageBps : 100,
            }
          : undefined,
      transactionId: stored?.transactionId,
      depositAddress: stored?.depositAddress,
    });
  }
  return out;
}

/** Asset ids a turn touches, so missing metadata can resolve server-side. */
export function collectApprovalAssetIds(parts: UIMessage["parts"]): string[] {
  const ids = new Set<string>();
  for (const part of parts) {
    const p = part as ToolPart;
    if (toolNameOf(p) !== "prepare_swap") continue;
    const input = inputOf(p);
    const from = str(input.fromAssetId);
    const to = str(input.toAssetId);
    if (from) ids.add(from);
    if (to) ids.add(to);
  }
  return [...ids];
}

/** Dollar value for a formatted amount and a catalogue price, or nothing
 * to show when either is unknown. */
function usd(amount: string, priceUsd?: number): string | undefined {
  if (priceUsd === undefined) return undefined;
  const n = Number(amount.replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  const value = n * priceUsd;
  if (!Number.isFinite(value)) return undefined;
  return value < 1000
    ? `$${value.toFixed(2)}`
    : `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Normalizes a money string to $ form. Bare engine figures gain the sign
 * and two decimals; already-signed values pass through untouched. */
function asUsd(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (text.length === 0) return undefined;
  if (text.startsWith("$")) return text;
  const n = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  return n < 1000
    ? `$${n.toFixed(2)}`
    : `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Unit price for a token popup, or nothing when the catalogue never
 * priced the asset. Precision follows magnitude so dust stays readable. */
function formatUnitPrice(priceUsd?: number): string | undefined {
  if (priceUsd === undefined || !Number.isFinite(priceUsd)) return undefined;
  if (priceUsd >= 1000) {
    return `$${Math.round(priceUsd).toLocaleString("en-US")}`;
  }
  if (priceUsd >= 1) return `$${priceUsd.toFixed(2)}`;
  if (priceUsd >= 0.01) return `$${priceUsd.toFixed(4)}`;
  if (priceUsd > 0) return `$${priceUsd.toPrecision(2)}`;
  return "$0.00";
}
