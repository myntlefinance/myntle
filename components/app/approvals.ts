import type { UIMessage } from "ai";
import { parseTradeAction, type TradeAction } from "@/lib/trade/action";
import { formatUsdPrice } from "@/lib/format/price";
import type { DepositMetadata } from "@/lib/intents/deposit-metadata";
import { normalizeEvmAddress } from "@/lib/intents/destination";
import { isNameLikeValue } from "@/lib/names/detect";
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
import { getApprovalTx } from "./approvalStore";

export type ApprovalStatus = "awaiting" | "approved" | "denied";

/** The server's record of a decision, keyed by tool approval id. */
export type ApprovalDecisions = Record<string, "approved" | "denied">;

/**
 * What a decision route needs beyond the id: which proposal it was, and the
 * stored preview the user was looking at. Every field is a reference, never a
 * figure — the server reconstructs the terms from `quoteId`.
 */
export type ApprovalDecisionContext = {
  toolName:
    | "prepare_swap"
    | "prepare_deposit"
    | "prepare_withdrawal"
    | "prepare_limit_order";
  quoteId?: string;
  requestedAt?: string;
};

/** One settlement row from the database, keyed by tool approval id. */
export type SettlementSnapshot = {
  state: string;
  transactionId: string;
  depositAddress?: string | null;
  explorerUrls?: string[];
  /** When 1Click was last read for this record. */
  statusCheckedAt?: string | null;
  /** The record's settled output, when it has one. */
  amountOut?: string | null;
  /** The deposit address's token, chain, raw amount, and deadline. */
  deposit?: DepositMetadata | null;
  /** The sender's registered funding hash, when the transfer was broadcast. */
  depositTxHash?: string | null;
  /** The resting order's own progress, when the record is a limit order. */
  limit?: {
    orderId: string;
    fillStatus: string;
    payoutStatus: string;
    filled?: string;
    filledPercent?: number;
    deadline?: string;
  } | null;
};

/** Terminal database states painted directly; anything else keeps polling. */
export function settlementCardState(
  state: string,
): "settled" | "refunded" | "failed" | "expired" | null {
  if (state === "settled") return "settled";
  if (state === "refunded") return "refunded";
  if (state === "expired") return "expired";
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
  /**
   * What funds the trade: the user's Near Account or their connected wallet.
   * Absent on messages stored before the tool named the route.
   */
  route?: "account" | "wallet";
  /** Which signer priced the quote. The server binds the exact account. */
  accountKind?: "wallet" | "passkey";
  /** The vault and its live APY when the output is a yield receipt. */
  earn?: {
    name: string;
    protocol: string;
    apy: number | null;
  } | null;
  recipient: string;
  refundTo?: string;
  expiresAt?: string;
  slippageBps: number;
  swapInput?: {
    fromAssetId: string;
    toAssetId: string;
    amount: string;
    recipient: string;
    refundTo?: string;
    slippageBps?: number;
    quoteId?: string;
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
  decisions?: ApprovalDecisions | null,
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
  // Every quote in the turn is a candidate, keyed by what it priced. A card
  // takes the latest one before it that matches its own inputs, including the
  // fields the wallet will sign, so a turn with two quotes cannot lend the
  // wrong terms to a card.
  type QuoteCandidate = {
    index: number;
    fromAssetId: string;
    toAssetId: string;
    amount: string;
    route: ApprovalInfo["route"];
    recipient: string;
    refundTo: string;
    slippageBps: number;
    quoteId: string;
    output: Record<string, unknown>;
  };
  const quoteCandidates: QuoteCandidate[] = [];
  parts.forEach((part, index) => {
    const p = part as ToolPart;
    if (toolNameOf(p) !== "get_quote" || !stateOf(p).startsWith("output")) return;
    const out = outputOf(p);
    // A preview without a stored row can never be approved: no quote id
    // means the card has nothing to submit against.
    if (typeof out.quoteId !== "string" || out.quoteId.length === 0) return;
    if (!out.amountIn || !out.amountOut) return;
    const input = inputOf(p);
    const recipient = str(input.recipient) || activeAddress || "";
    quoteCandidates.push({
      index,
      fromAssetId: str(input.fromAssetId) ?? "",
      toAssetId: str(input.toAssetId) ?? "",
      amount: str(input.amount) ?? "",
      route: quoteRouteOf(out),
      recipient,
      // The quote tool defaults an absent refund to the connected wallet.
      refundTo: str(input.refundTo) || activeAddress || recipient,
      slippageBps:
        typeof input.slippageBps === "number" ? input.slippageBps : 100,
      quoteId: out.quoteId,
      output: out,
    });
  });
  // One quote belongs to one awaiting card. Two identical quotes followed by
  // two proposals must yield two distinct quote ids, not the same latest one.
  const usedQuoteCandidates = new Set<number>();
  const usedQuoteIds = new Set<string>();
  const out: ApprovalInfo[] = [];
  for (const [index, part] of parts.entries()) {
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
    const refundTo = str(input.refundTo) || undefined;
    if (!fromAssetId || !toAssetId || !amount || !recipient) continue;

    // The record decides the status before any quote is assigned: a decided
    // card may display a quote but must not consume one meant for the next
    // awaiting card.
    const decision = approvalDecision(p);
    const recorded = decisions?.[approvalId];
    const stored = getApprovalTx(approvalId);
    const denied = recorded === "denied" || decision === false;
    const status: ApprovalStatus = denied
      ? "denied"
      : recorded === "approved" || decision === true || stored
        ? "approved"
        : "awaiting";
    const awaiting = status === "awaiting";
    const slippageBps =
      typeof input.slippageBps === "number" ? input.slippageBps : 100;
    const proposalRefund = refundTo || activeAddress || recipient;

    // The latest preceding matching quote that no earlier awaiting card
    // claimed. If the latest is taken, fall back to the next earlier one;
    // with none, the card refuses rather than borrowing unrelated terms.
    let matched: QuoteCandidate | null = null;
    for (let c = quoteCandidates.length - 1; c >= 0; c -= 1) {
      const candidate = quoteCandidates[c];
      if (candidate.index >= index) continue;
      if (awaiting && usedQuoteCandidates.has(candidate.index)) continue;
      if (awaiting && usedQuoteIds.has(candidate.quoteId)) continue;
      if (candidate.fromAssetId !== fromAssetId) continue;
      if (candidate.toAssetId !== toAssetId) continue;
      if (candidate.amount !== amount) continue;
      if (candidate.slippageBps !== slippageBps) continue;
      // The account-funded route overrides recipient and refund inside the
      // quote tool, and its card never signs those fields. A wallet route
      // signs them, so they must match the stored quote exactly.
      if (candidate.route !== "account") {
        if (!signedPartyMatches(recipient, candidate.recipient)) continue;
        if (!signedPartyMatches(proposalRefund, candidate.refundTo)) continue;
      }
      matched = candidate;
      break;
    }
    if (matched && awaiting) {
      usedQuoteCandidates.add(matched.index);
      usedQuoteIds.add(matched.quoteId);
    }
    const quoted = matched?.output ?? null;
    const quoteId = str(quoted?.quoteId) || undefined;
    // The card routes from the quote, not from the account kind: a wallet
    // session can spend its Near Account balance. New outputs name the
    // route; turns stored before it do carry only the internal mode, which
    // maps one to one. Neither value ever reaches the interface as a mode.
    const route = quoteRouteOf(quoted);

    // Display figures are truncated for humans; the raw values stay on
    // the signed message and the server record. When there is no quote in
    // this turn, there is nothing human-readable to show: the input amount
    // is a raw smallest-unit integer (1200000 = 1.2 USDC), so rendering it
    // as whole units would read as millions. Show an em dash instead; the
    // card already refuses to sign without fresh quote figures.
    const quotedIn = str(quoted?.amountIn);
    const rawOut = str(quoted?.amountOut);
    const rawMin = str(quoted?.minAmountOut);
    // The action names what the money does, decided by the application —
    // never by the model alone. The same ticker landing back in the user's
    // own account is a deposit, plain and simple, no matter which label the
    // turn carried. Address formats never collide across ecosystems, so an
    // exact address match is sufficient with no chain check.
    const fromSymbol = assetName(fromAssetId, symbols);
    const toSymbol = assetName(toAssetId, symbols);
    const earnRecord =
      quoted?.earn && typeof quoted.earn === "object"
        ? (quoted.earn as Record<string, unknown>)
        : null;
    const earn =
      earnRecord &&
      typeof earnRecord.name === "string" &&
      typeof earnRecord.protocol === "string"
        ? {
            name: earnRecord.name,
            protocol: earnRecord.protocol,
            apy:
              typeof earnRecord.apy === "number" &&
              Number.isFinite(earnRecord.apy)
                ? earnRecord.apy
                : null,
          }
        : null;
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
      amountIn: quotedIn ? formatAmount(quotedIn) : "—",
      amountInUsd: quotedIn ? usd(quotedIn, meta.get(fromAssetId)?.priceUsd) : undefined,
      amountOut: rawOut ? formatAmount(rawOut) : "—",
      amountOutUsd: asUsd(str(quoted?.amountOutUsd)),
      fromPriceUsd: formatUsdPrice(meta.get(fromAssetId)?.priceUsd),
      toPriceUsd: formatUsdPrice(meta.get(toAssetId)?.priceUsd),
      minAmountOut: rawMin ? formatAmount(rawMin) : undefined,
      minAmountOutRaw: str(quoted?.minAmountOutRaw) ?? undefined,
      route,
      accountKind:
        quoted?.accountKind === "passkey" || quoted?.accountKind === "wallet"
          ? quoted.accountKind
          : undefined,
      earn,
      recipient,
      refundTo,
      expiresAt: str(quoted?.expiresAt) ?? undefined,
      slippageBps,
      swapInput:
        status === "awaiting"
          ? {
              fromAssetId,
              toAssetId,
              amount,
              recipient,
              refundTo,
              slippageBps,
              quoteId,
            }
          : undefined,
      transactionId: stored?.transactionId,
      depositAddress: stored?.depositAddress,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* the cards on screen                                                 */
/* ------------------------------------------------------------------ */

/**
 * Every tool approval id the rendered cards can carry.
 *
 * This is how the interface asks the record what happened: by the ids it is
 * showing, not by conversation. A card from a first turn saved before the
 * chat had a row, from a trashed chat, or from a device that never saw the
 * decision all resolve to the same read.
 */
export function collectApprovalIds(messages: UIMessage[]): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      const p = part as ToolPart;
      const name = toolNameOf(p);
      if (
        name !== "prepare_swap" &&
        name !== "prepare_deposit" &&
        name !== "prepare_withdrawal" &&
        name !== "prepare_limit_order"
      ) {
        continue;
      }
      const id = approvalIdOf(p);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/** Asset ids a turn touches, so missing metadata can resolve server-side. */
export function collectApprovalAssetIds(parts: UIMessage["parts"]): string[] {
  const ids = new Set<string>();
  for (const part of parts) {
    const p = part as ToolPart;
    const name = toolNameOf(p);
    if (
      name !== "prepare_swap" &&
      name !== "prepare_deposit" &&
      name !== "get_withdrawal_quote" &&
      name !== "prepare_withdrawal" &&
      name !== "get_limit_order_quote"
    ) {
      continue;
    }
    const input = inputOf(p);
    if (name === "prepare_deposit") {
      const asset = str(input.assetId);
      if (asset) ids.add(asset);
      continue;
    }
    if (name === "get_limit_order_quote") {
      const out = outputOf(p);
      const base = str(out.baseAssetId);
      const quote = str(out.quoteAssetId);
      if (base) ids.add(base);
      if (quote) ids.add(quote);
      continue;
    }
    const from = str(input.fromAssetId);
    const to = str(input.toAssetId);
    if (from) ids.add(from);
    if (to) ids.add(to);
  }
  return [...ids];
}

/* ------------------------------------------------------------------ */
/* withdrawals                                                         */
/* ------------------------------------------------------------------ */

export type WithdrawalInfo = {
  approvalId: string;
  status: ApprovalStatus;
  requestedAt: string;
  fromAssetId: string;
  toAssetId: string;
  fromSymbol: string;
  toSymbol: string;
  fromChain?: string;
  toChain?: string;
  /** The raw smallest-unit amount the tool proposed. */
  amount: string;
  /** Whole units from the stored quote, when the turn priced one. */
  amountIn?: string;
  amountOut?: string;
  minAmountOut?: string;
  fee?: string;
  /** The server-normalised destination from the stored quote. */
  destination?: string;
  /** The name the destination resolved from, when one was passed. */
  destinationName?: string;
  destinationChain?: string;
  expiresAt?: string;
  quoteId?: string;
  transactionId?: string;
  depositAddress?: string;
};

/**
 * Collects the withdrawal proposals in one turn.
 *
 * The figures and the destination come from the stored `get_withdrawal_quote`
 * output, never from the model's prose. `prepare_withdrawal` only names the
 * user's asset, amount, and destination; the card's authoritative address is
 * the one the quote server normalised and stored.
 */
export function collectWithdrawals(
  message: UIMessage,
  symbols: Map<string, string>,
  meta: Map<string, AssetMeta>,
  decisions?: ApprovalDecisions | null,
): WithdrawalInfo[] {
  const metadata = message.metadata as { createdAt?: unknown } | undefined;
  const requestedAt =
    typeof metadata?.createdAt === "string" && metadata.createdAt.length > 0
      ? metadata.createdAt
      : new Date().toISOString();

  // Each stored quote is a candidate keyed by what it priced: the pair, the
  // amount, and the destination. A withdrawal card takes the latest quote
  // before it that matches all four, and no quote is shared between cards.
  type WithdrawalQuoteCandidate = {
    index: number;
    fromAssetId: string;
    toAssetId: string;
    amount: string;
    /** The raw input plus the server's resolved address and name. */
    destinationKeys: string[];
    quoteId: string;
    output: Record<string, unknown>;
  };
  const quoteCandidates: WithdrawalQuoteCandidate[] = [];
  message.parts.forEach((part, index) => {
    const p = part as ToolPart;
    if (toolNameOf(p) !== "get_withdrawal_quote") return;
    if (!stateOf(p).startsWith("output")) return;
    const out = outputOf(p);
    // A preview without a stored row can never be approved.
    if (typeof out.quoteId !== "string" || out.quoteId.length === 0) return;
    const input = inputOf(p);
    const fromAssetId = str(input.fromAssetId);
    const amount = str(input.amount);
    const destinationAddress = str(input.destinationAddress);
    if (!fromAssetId || !amount || !destinationAddress) return;
    const destinationKeys = [
      destinationAddress,
      str(out.destination),
      str(out.destinationName),
    ].filter((value): value is string => !!value);
    quoteCandidates.push({
      index,
      fromAssetId,
      toAssetId: str(input.toAssetId) || fromAssetId,
      amount,
      destinationKeys,
      quoteId: out.quoteId,
      output: out,
    });
  });
  const usedQuoteCandidates = new Set<number>();
  const usedQuoteIds = new Set<string>();

  const out: WithdrawalInfo[] = [];
  for (const [index, part] of message.parts.entries()) {
    const p = part as ToolPart;
    if (toolNameOf(p) !== "prepare_withdrawal") continue;
    const approvalId = approvalIdOf(p);
    if (!approvalId) continue;

    const input = inputOf(p);
    const inputFromAssetId = str(input.fromAssetId);
    const inputToAssetId = str(input.toAssetId) || inputFromAssetId;
    const amount = str(input.amount);
    const destinationAddress = str(input.destinationAddress);
    if (!inputFromAssetId || !inputToAssetId || !amount) continue;

    // The status decides whether this card may consume a quote. A decided
    // card may still display one, but must not starve the next awaiting card.
    const state = stateOf(p);
    const executed = state === "output-available" || state === "output-error";
    // The record decides first: a withdrawal refused on another device is
    // refused here too, and the snapshot cannot say otherwise.
    const decision = approvalDecision(p);
    const recorded = decisions?.[approvalId];
    const stored = getApprovalTx(approvalId);
    const denied = recorded === "denied" || decision === false;
    const status: ApprovalStatus = denied
      ? "denied"
      : recorded === "approved" || decision === true || stored || executed
        ? "approved"
        : "awaiting";
    const awaiting = status === "awaiting";

    // The latest preceding matching quote that no earlier awaiting card
    // claimed. The destination comparison is address-aware: checksum and
    // lower-case EVM forms are the same address, and a name quote matches its
    // resolved address proposal through the quote's own resolved values. The
    // reverse is not guessed: the model must pass the same destination string
    // to both tools when it has only an address.
    let matched: WithdrawalQuoteCandidate | null = null;
    for (let c = quoteCandidates.length - 1; c >= 0; c -= 1) {
      const candidate = quoteCandidates[c];
      if (candidate.index >= index) continue;
      if (awaiting && usedQuoteCandidates.has(candidate.index)) continue;
      if (awaiting && usedQuoteIds.has(candidate.quoteId)) continue;
      if (candidate.fromAssetId !== inputFromAssetId) continue;
      if (candidate.toAssetId !== inputToAssetId) continue;
      if (candidate.amount !== amount) continue;
      if (
        !destinationAddress ||
        !destinationMatches(destinationAddress, candidate.destinationKeys)
      ) {
        continue;
      }
      matched = candidate;
      break;
    }
    if (matched && awaiting) {
      usedQuoteCandidates.add(matched.index);
      usedQuoteIds.add(matched.quoteId);
    }
    const quoted = matched?.output ?? null;
    // The stored quote names the assets it priced. Without one, the proposal
    // still shows its own pair and amount from the tool input.
    const fromAssetId = str(quoted?.fromAssetId) || inputFromAssetId;
    const toAssetId = str(quoted?.toAssetId) || inputToAssetId;

    const quoteId = str(quoted?.quoteId) || undefined;
    // The destination is only ever the stored quote's value. A proposal with
    // no quote has no authoritative address to show, and the card disables
    // Approve rather than display the model's string.
    const destination = str(quoted?.destination) || undefined;
    const destinationName = str(quoted?.destinationName) || undefined;
    const destinationChain = str(quoted?.destinationChain) || undefined;

    out.push({
      approvalId,
      status,
      requestedAt,
      fromAssetId,
      toAssetId,
      fromSymbol: assetName(fromAssetId, symbols),
      toSymbol: assetName(toAssetId, symbols),
      fromChain: meta.get(fromAssetId)?.chain,
      toChain: meta.get(toAssetId)?.chain,
      amount,
      amountIn: str(quoted?.amountIn) || undefined,
      amountOut: str(quoted?.amountOut) || undefined,
      minAmountOut: str(quoted?.minAmountOut) || undefined,
      fee: str(quoted?.withdrawFeeFormatted) || undefined,
      destination,
      destinationName,
      destinationChain,
      expiresAt: str(quoted?.expiresAt) || undefined,
      quoteId,
      transactionId: stored?.transactionId,
      depositAddress: stored?.depositAddress,
    });
  }
  return out;
}

/**
 * The public route a quote names. New outputs carry `route`; turns stored
 * before it carry the internal mode, which maps one to one.
 */
function quoteRouteOf(
  output: Record<string, unknown> | null | undefined,
): "account" | "wallet" | undefined {
  if (output?.route === "account" || output?.route === "wallet") {
    return output.route;
  }
  if (output?.mode === "confidential-intents") return "account";
  if (output?.mode === "chain") return "wallet";
  return undefined;
}

/**
 * Whether a signed recipient or refund names the same party as the quote's.
 *
 * Two EVM addresses compare after normalisation. Two names compare
 * case-folded. A name and an address cannot be proven equal on the client, so
 * that pairing fails closed. Every other value — a Solana or NEAR address,
 * for example — compares exactly, because those are case-sensitive.
 */
function signedPartyMatches(proposal: string, quote: string): boolean {
  const left = proposal.trim();
  const right = quote.trim();
  if (!left || !right) return false;
  const leftEvm = normalizeEvmAddress(left);
  const rightEvm = normalizeEvmAddress(right);
  if (leftEvm && rightEvm) {
    return leftEvm.toLowerCase() === rightEvm.toLowerCase();
  }
  const leftName = isNameLikeValue(left);
  const rightName = isNameLikeValue(right);
  if (leftName && rightName) {
    return left.toLowerCase() === right.toLowerCase();
  }
  if (leftName || rightName) return false;
  return left === right;
}

/**
 * Whether a proposal's destination names the same place as a quote's.
 *
 * Two EVM addresses compare after normalisation, so a lowercase quote and a
 * checksummed proposal agree. Anything else compares trimmed, case-folded:
 * that lets a name quote match its resolved address through the quote's own
 * `destination` / `destinationName` values.
 */
function destinationMatches(
  proposal: string,
  candidates: readonly string[],
): boolean {
  const proposed = proposal.trim();
  if (!proposed) return false;
  const proposedEvm = normalizeEvmAddress(proposed);
  for (const candidate of candidates) {
    const other = candidate.trim();
    if (!other) continue;
    const otherEvm = normalizeEvmAddress(other);
    if (proposedEvm && otherEvm) {
      if (proposedEvm.toLowerCase() === otherEvm.toLowerCase()) return true;
      continue;
    }
    if (proposed.toLowerCase() === other.toLowerCase()) return true;
  }
  return false;
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
