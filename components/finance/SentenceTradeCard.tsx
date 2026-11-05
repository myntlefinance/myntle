"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconCopy, IconExternalLink, IconUserCircle, IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { SpinnerRing } from "@/components/primitives/TaskRows";
import { TokenChip } from "@/components/finance/TokenChip";
import { TokenAvatar } from "@/components/finance/TokenAvatar";
import { NetworkIcon } from "@/components/finance/NetworkIcon";
import { PopupRow, TokenPopup } from "@/components/finance/TokenPopup";
import { DepositQr } from "@/components/finance/DepositQr";
import { useWallet } from "@/lib/wallet/registry";
import { evmChainForSlug } from "@/lib/wallet/evm-chains";
import { toHex } from "@/lib/wallet/types";
import { addressIdentity, shortAddr } from "@/lib/trade/identity";
import {
  canTransferDeposit,
  depositNetworkShortLabel,
  type DepositMetadata,
} from "@/lib/intents/deposit-metadata";
import {
  depositCardStateForRecord,
  depositExpired,
  depositPhaseForCardState,
  depositStatusMessage,
  needsFreshDepositAddress,
} from "@/lib/intents/deposit-status";
import {
  activateWarmState,
  globalIsWarm,
  onTooltipEnter,
  onTooltipLeave,
} from "@/components/app/tooltip";
import {
  claimHoverCard,
  dismissHoverCard,
  releaseHoverCard,
} from "@/components/app/hoverCard";
import { prefetchSymbolPrice } from "@/components/app/useAssetPrice";
import {
  APPROVAL_WINDOW_MS,
  buildTradeApprovalMessage,
  isApprovalWindowValid,
} from "@/lib/trade/approval-message";
import {
  getApprovalOutcome,
  getApprovalTx,
  rememberApprovalOutcome,
} from "@/components/app/approvalStore";
import { actionTitle, type TradeAction } from "@/lib/trade/action";
import type { SentenceApproval } from "./sentence-approval";

/* Kept on this module for callers and tests that already import it here;
 * the implementation lives with the chart and popup rows. */
export { TokenPopup };

export type SentenceCardState =
  | "awaiting"
  | "signing"
  | "submitting"
  | "submitted"
  | "waiting"
  | "processing"
  | "settled"
  | "refunded"
  | "incomplete"
  | "denied"
  | "expired"
  | "failed";

const TONE: Record<SentenceCardState, "neutral" | "accent" | "green" | "red" | "orange" | "yellow"> = {
  awaiting: "orange",
  signing: "accent",
  submitting: "accent",
  submitted: "accent",
  waiting: "yellow",
  processing: "accent",
  settled: "green",
  refunded: "neutral",
  incomplete: "red",
  denied: "red",
  expired: "red",
  failed: "red",
};

const LABEL: Record<SentenceCardState, string> = {
  awaiting: "Pending",
  signing: "Signing",
  submitting: "Approved",
  submitted: "Approved",
  waiting: "Waiting",
  processing: "Processing",
  settled: "Executed",
  refunded: "Refunded",
  incomplete: "Incomplete",
  denied: "Rejected",
  expired: "Expired",
  failed: "Failed",
};

/**
 * The sentence approval card.
 *
 * One sentence carries the proposal, built deterministically from the signed
 * parameters — never from model text. The drawer holds everything needed to
 * verify but not to decide, and the footer carries the decision: buttons
 * while awaiting, the status badge in their place after.
 */
export default function SentenceTradeCard({
  action = "swap",
  fromSymbol,
  fromChain,
  toSymbol,
  toChain,
  amountIn,
  amountOut,
  amountOutUsd,
  fromPriceUsd,
  toPriceUsd,
  minAmountOut,
  minAmountOutRaw,
  recipient,
  refundTo,
  expiresAt,
  slippageBps,
  requestedAt,
  state = "awaiting",
  depositAddress,
  depositMemo,
  depositMeta,
  transactionId,
  approvalId,
  initialExplorerUrls,
  swapInput,
  conversationId,
  runApproval,
  approveLabel = "Approve",
  sender,
  destinationChain,
  fee,
  disabled = false,
  onApprove,
  onDeny,
  onRecord,
}: {
  action?: TradeAction;
  fromSymbol: string;
  fromChain?: string;
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
  /** Raw smallest-unit minimum, bound by the wallet signature. */
  minAmountOutRaw?: string;
  recipient: string;
  /** Account refunds return to on the origin chain. Defaults to the connected wallet. */
  refundTo?: string;
  expiresAt?: string;
  /** Slippage tolerance the approval was quoted with, in basis points. */
  slippageBps?: number;
  /** Card birth, from the host message. Approvals older than the window expire. */
  requestedAt?: string;
  state?: SentenceCardState;
  depositAddress?: string;
  depositMemo?: string | null;
  /**
   * The record's own deposit metadata: the exact token, chain, raw amount,
   * and deadline the server issued with the address. Present on a reloaded
   * card so the QR and Transfer survive a refresh.
   */
  depositMeta?: DepositMetadata | null;
  transactionId?: string;
  /** Tool approval id, used to recall a settled outcome across reloads. */
  approvalId?: string;
  /** Explorer links already known from the database; the poll reconfirms. */
  initialExplorerUrls?: string[];
  swapInput?: {
    fromAssetId: string;
    toAssetId: string;
    amount: string;
    recipient: string;
    refundTo?: string;
    slippageBps?: number;
    quoteId?: string;
  };
  conversationId?: string | null;
  /**
   * The Intents approval to run instead of `/api/approve`.
   *
   * Present when the money path is an Intents route: the card asks the server
   * for a deposit address, or runs approve → sign → submit, and reads the
   * record after. A passkey swap, withdrawal, and deposit all arrive here;
   * the wallet swap keeps the `/api/approve` branch below, untouched.
   */
  runApproval?: SentenceApproval;
  /** Decision button label. A deposit says what it does. */
  approveLabel?: string;
  /**
   * The funding account for a deposit. `null` omits the "from" clause
   * entirely, which is what a passkey deposit needs: there is no wallet.
   */
  sender?: { label: string; icon?: string; chain?: string } | null;
  /** Human chain name for the withdrawal destination. */
  destinationChain?: string;
  /** Withdrawal fee in the origin token, shown only when the quote priced one. */
  fee?: string;
  disabled?: boolean;
  onApprove?: (tx?: { transactionId: string; depositAddress: string }) => void;
  onDeny?: () => void;
  /**
   * Records a freshly minted address without answering the approval again.
   * A new address is a reset of a decided deposit, not a second decision.
   */
  onRecord?: (tx: { transactionId: string; depositAddress: string }) => void;
}) {
  const { account, signMessage, signNEP413, sendDeposit } = useWallet();
  // The injected approval changes the whole journey: an Intents card has no
  // wallet signature and no `/api/approve`, so it also reads different
  // figures and details than the wallet card does.
  const intents = runApproval !== undefined;
  // The approval store survives a reload; the settlement snapshot may arrive
  // a moment later. Seed from the store so a Waiting card never loses the
  // address it already minted and disables its own Details button.
  const rememberedTx = approvalId ? getApprovalTx(approvalId) : undefined;
  const seededTxId = transactionId ?? rememberedTx?.transactionId;
  const seededDeposit = depositAddress ?? rememberedTx?.depositAddress;
  // A reload paints the remembered terminal outcome at once instead of
  // flashing Approved until the first status poll lands. The poll below
  // still reconfirms against the server record.
  const [txState, setTxState] = useState<SentenceCardState>(() => {
    // A deposit's record is the authority, and its mount refresh is the one
    // way a record can move back from a timeout. A remembered terminal
    // outcome could hide that restoration, so a deposit seeds from the
    // snapshot and lets the record decide. Every other card keeps the
    // remembered outcome for an instant reload paint.
    if (approvalId && !(intents && action === "deposit")) {
      const remembered = getApprovalOutcome(approvalId);
      if (remembered) return remembered;
    }
    return state;
  });
  const [txId, setTxId] = useState<string | undefined>(seededTxId);
  const [deposit, setDeposit] = useState<string | undefined>(seededDeposit);
  // A minted deposit carries the memo and deadline the server issued with the
  // address; a withdrawal replaces the displayed destination with the one the
  // server rebuilt from the stored quote.
  const [memo, setMemo] = useState<string | null>(depositMemo ?? null);
  // The record's deposit metadata outlives the turn that minted it. The
  // adapter fills it on a fresh mint; the settlement snapshot fills it on a
  // reload. Keeping it local means a poll can improve it without a re-quote.
  const [meta, setMeta] = useState<DepositMetadata | null>(
    () => depositMeta ?? null,
  );
  // The memo may arrive on either channel: the mint result carries it, and a
  // reloaded record carries it inside the metadata.
  const shownMemo = memo ?? meta?.memo ?? null;
  // A reclaimed deposit asks the server once for the authoritative state
  // before its own clock is allowed to expire the address. While that check
  // is running, or after it failed, the last known state stands.
  const [statusCheck, setStatusCheck] = useState<
    "idle" | "checking" | "ok" | "unavailable"
  >(() =>
    intents &&
    action === "deposit" &&
    seededDeposit &&
    seededTxId &&
    !isTerminalCardState(state) &&
    // A deadline that has already passed is not waiting for a check to
    // decide it. The refresh still runs and may reveal a detected deposit,
    // but the address is allowed to read Expired in the meantime.
    !depositExpired(expiresAt ?? depositMeta?.expiresAt, Date.now())
      ? "checking"
      : "idle",
  );
  const [feeLabel, setFeeLabel] = useState<string | undefined>(fee);
  const [boundRecipient, setBoundRecipient] = useState<string | undefined>();
  const [received, setReceived] = useState<string | null>(null);
  const [explorerUrls, setExplorerUrls] = useState<string[]>(
    initialExplorerUrls ?? [],
  );
  // A deposit address is the whole point of the drawer, so a reclaimed card
  // opens it instead of hiding the QR behind a Details click. A card with no
  // address never opens an empty drawer.
  const [detailsOpen, setDetailsOpen] = useState(
    () => intents && action === "deposit" && !!seededDeposit,
  );
  const [submitError, setSubmitError] = useState<string | null>(() =>
    // A terminal deposit's own sentence lives in the status block above the
    // faded panel. The red drawer is for an action that failed, not for a
    // record that settled badly.
    txState === "failed" && !(intents && action === "deposit")
      ? failureMessage("failed", action, intents)
      : null,
  );
  // One click, one mint or one signature: a second click while the first
  // request is in flight must not issue a second address or sign twice.
  const approveRef = useRef(false);
  const mintRef = useRef(false);
  const transferRef = useRef(false);
  const [minting, setMinting] = useState(false);
  const [transferring, setTransferring] = useState(false);
  // The mount refresh key. One authoritative check per address per card, not
  // an interval; a manual retry is the only way past a failed check.
  const refreshedKey = useRef<string | null>(null);
  // Quoted figures are local so a moved price can refresh the card in
  // place; props win whenever the turn produces a new quote.
  const [figures, setFigures] = useState({
    amountOut,
    amountOutUsd,
    minAmountOut,
    minAmountOutRaw,
    // The record's metadata carries the deadline a reloaded card never saw
    // in the turn, so the panel and the clock agree before any request.
    expiresAt: expiresAt ?? depositMeta?.expiresAt ?? undefined,
  });
  // The host message restates the decision, never the settlement: once the
  // card holds a live or terminal state (processing, waiting, remembered, or
  // polled), props must not drag it back to Approved.
  useEffect(() => {
    setTxState((current) =>
      current === "processing" ||
      current === "waiting" ||
      current === "settled" ||
      current === "refunded" ||
      current === "incomplete" ||
      current === "expired" ||
      current === "failed"
        ? current
        : state,
    );
  }, [state]);
  useEffect(() => {
    if (transactionId) setTxId(transactionId);
  }, [transactionId]);
  useEffect(() => {
    if (depositAddress) setDeposit(depositAddress);
  }, [depositAddress]);
  useEffect(() => setMemo(depositMemo ?? null), [depositMemo]);
  useEffect(() => {
    if (!depositMeta) return;
    setMeta(depositMeta);
    if (depositMeta.expiresAt) {
      setFigures((current) =>
        current.expiresAt
          ? current
          : { ...current, expiresAt: depositMeta.expiresAt ?? undefined },
      );
    }
  }, [depositMeta]);
  // A reloaded deposit opens its panel once the record's address arrives.
  useEffect(() => {
    if (intents && action === "deposit" && (depositAddress || deposit)) {
      setDetailsOpen(true);
    }
  }, [intents, action, depositAddress, deposit]);
  useEffect(() => setFeeLabel(fee), [fee]);
  useEffect(() => {
    setFigures({
      amountOut,
      amountOutUsd,
      minAmountOut,
      minAmountOutRaw,
      expiresAt: expiresAt ?? depositMeta?.expiresAt ?? undefined,
    });
  }, [
    amountOut,
    amountOutUsd,
    minAmountOut,
    minAmountOutRaw,
    expiresAt,
    depositMeta,
  ]);

  // An untouched card expires on its own clock so every render — live,
  // revisited, or reloaded — agrees. One precisely-timed flip, no ticker.
  const [clock, setClock] = useState(() => Date.now());
  const deadline = figures.expiresAt ? Date.parse(figures.expiresAt) : NaN;
  useEffect(() => {
    if (intents) {
      // The quote's own deadline governs the intents path, and a minted
      // deposit address expires on the same clock until it is funded.
      if (txState !== "awaiting" && txState !== "waiting") return;
      if (!Number.isFinite(deadline)) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      const timer = setTimeout(() => setClock(Date.now()), remaining + 250);
      return () => clearTimeout(timer);
    }
    if (txState !== "awaiting" || !requestedAt) return;
    const remaining =
      Date.parse(requestedAt) + APPROVAL_WINDOW_MS - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setClock(Date.now()), remaining + 250);
    return () => clearTimeout(timer);
  }, [intents, txState, requestedAt, deadline]);
  // A status check that is still running, or that failed, holds the card at
  // its last known state. A failed check is not evidence the address expired.
  const expiryHeld =
    intents &&
    action === "deposit" &&
    (statusCheck === "checking" || statusCheck === "unavailable");
  const expired = intents
    ? (txState === "awaiting" || txState === "waiting") &&
      Number.isFinite(deadline) &&
      deadline <= clock &&
      !expiryHeld
    : txState === "awaiting" &&
      !!requestedAt &&
      !isApprovalWindowValid(requestedAt, clock);
  // A host can say "waiting" because the tool approval was answered even when
  // the mint never returned an address. With no address there is no panel to
  // open and no Details to toggle; show Start again instead of a dead card.
  const missingDeposit =
    intents && action === "deposit" && txState === "waiting" && !deposit;
  // The rendered state: an untouched card past its window reads expired
  // on every surface, live or reloaded, with no ticker running.
  const viewState: SentenceCardState = expired
    ? "expired"
    : missingDeposit
      ? "awaiting"
      : txState;

  // The deposit panel's own vocabulary. A settled record keeps its success
  // even when the quote deadline has long passed; only waiting ages out.
  const depositPhase =
    intents && action === "deposit"
      ? depositPhaseForCardState(
          viewState === "settled" ||
            viewState === "refunded" ||
            viewState === "incomplete" ||
            viewState === "failed" ||
            viewState === "expired" ||
            viewState === "processing"
            ? viewState
            : "waiting",
          !!deposit,
        )
      : null;
  const depositMessage = depositPhase ? depositStatusMessage(depositPhase) : null;
  const depositFaded =
    (depositPhase !== null &&
      depositPhase !== "awaiting" &&
      depositPhase !== "waiting") ||
    // A fresh address is being minted: the old one is already abandoned, so
    // its panel must not invite a transfer while the request is in flight.
    (intents &&
      action === "deposit" &&
      !!deposit &&
      (viewState === "signing" || viewState === "submitting"));
  const depositTerminal = depositPhase
    ? needsFreshDepositAddress(depositPhase)
    : false;

  // One authoritative check on mount. The server holds the partner key and
  // makes exactly one 1Click call; the card makes exactly one request, and
  // only when an address exists and the record is not terminal.
  const applyExplorerUrls = useCallback((urls: unknown) => {
    if (!Array.isArray(urls)) return;
    setExplorerUrls(
      urls.filter((u): u is string => typeof u === "string").slice(0, 2),
    );
  }, []);

  const checkDepositStatus = useCallback(async () => {
    if (!txId) return;
    setStatusCheck("checking");
    try {
      const res = await fetch(
        `/api/tx/${encodeURIComponent(txId)}?refresh=1`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setStatusCheck("unavailable");
        return;
      }
      const body = (await res.json()) as {
        state?: string;
        statusCheck?: string;
        deposit?: DepositMetadata | null;
        outcome?: { explorerUrls?: unknown };
      };
      if (body.statusCheck === "unavailable") {
        setStatusCheck("unavailable");
        return;
      }
      setStatusCheck("ok");
      if (body.deposit) setMeta(body.deposit);
      if (body.state) {
        const next = depositCardStateForRecord(
          body.state,
          body.deposit?.expiresAt ?? figures.expiresAt,
          Date.now(),
        );
        setTxState(next);
        if (next !== "failed" && next !== "incomplete") setSubmitError(null);
      }
      applyExplorerUrls(body.outcome?.explorerUrls);
    } catch {
      // Keep the last known state; the retry sentence is the only claim.
      setStatusCheck("unavailable");
    }
  }, [txId, figures.expiresAt, applyExplorerUrls]);

  useEffect(() => {
    if (!intents || action !== "deposit") return;
    const key = depositRefreshKey({
      alreadyRefreshed: refreshedKey.current,
      txId,
      address: deposit,
      state: txState,
    });
    if (!key) return;
    refreshedKey.current = key;
    void checkDepositStatus();
  }, [intents, action, txId, deposit, txState, checkDepositStatus]);

  // After submission the card polls its own record, so a refresh keeps
  // showing the settlement rather than a stale approval. A deposit's
  // non-terminal states are read through the deposit table, which keeps a
  // timed-out workflow waiting while the address is still inside its quote.
  useEffect(() => {
    if (!txId) return;
    const polling =
      txState === "submitted" ||
      txState === "submitting" ||
      txState === "processing";
    if (!polling) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tx/${encodeURIComponent(txId)}`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          state?: string;
          deposit?: DepositMetadata | null;
          outcome?: { amountOut?: unknown; explorerUrls?: unknown };
        };
        if (cancelled || !body.state) return;
        if (intents && action === "deposit") {
          if (body.deposit) setMeta(body.deposit);
          const next = depositCardStateForRecord(
            body.state,
            body.deposit?.expiresAt ?? figures.expiresAt,
            Date.now(),
          );
          setTxState(next);
          if (
            next === "settled" ||
            next === "refunded" ||
            next === "failed" ||
            next === "incomplete"
          ) {
            if (approvalId) rememberApprovalOutcome(approvalId, next);
          }
          if (next !== "failed" && next !== "incomplete") setSubmitError(null);
        } else if (body.state === "settled") {
          if (approvalId) rememberApprovalOutcome(approvalId, "settled");
          setTxState("settled");
          // The received amount is the record's own, never the quote's
          // expected output: a withdrawal can settle short and still settle.
          if (intents && action === "withdraw") {
            const amount = receivedFrom(body.outcome);
            if (amount) setReceived(amount);
          }
        } else if (body.state === "refunded") {
          if (approvalId) rememberApprovalOutcome(approvalId, "refunded");
          setTxState("refunded");
        } else if (body.state === "failed") {
          if (approvalId) rememberApprovalOutcome(approvalId, "failed");
          setTxState("failed");
          setSubmitError(failureMessage(body.state, action, intents));
        } else if (body.state === "incomplete_deposit") {
          // Terminal without settlement: the deposit arrived short of the
          // quoted amount. Stop the spinner instead of polling forever.
          if (approvalId) rememberApprovalOutcome(approvalId, "failed");
          setTxState("failed");
          setSubmitError(failureMessage(body.state, action, intents));
        } else if (body.state === "needs_reconciliation") {
          // Terminal without settlement: the workflow gave up waiting.
          if (approvalId) rememberApprovalOutcome(approvalId, "failed");
          setTxState("failed");
          setSubmitError(failureMessage(body.state, action, intents));
        } else {
          setTxState(polledState(body.state, action, intents));
        }
        applyExplorerUrls(body.outcome?.explorerUrls);
      } catch {
        // Next tick retries.
      }
    };
    const timer = setInterval(tick, 4000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [txId, txState, approvalId, action, intents, figures.expiresAt, applyExplorerUrls]);

  const handleApprove = async () => {
    // The injected path first. A passkey card has no trade message to sign
    // and no wallet to sign it with, so the wallet branch below must never
    // see it; the guard is the presence of the adapter, not the card state.
    if (runApproval) {
      await approveThroughAdapter({
        action,
        runApproval,
        expired,
        inFlight: approveRef,
        setState: setTxState,
        setError: setSubmitError,
        setTxId,
        setDeposit,
        setMemo,
        setDepositMeta: setMeta,
        setFee: setFeeLabel,
        setFigures: (patch) =>
          setFigures((current) => ({ ...current, ...patch })),
        setDestination: setBoundRecipient,
        openDetails: () => setDetailsOpen(true),
        onMinted: ({ transactionId, depositAddress }) => {
          refreshedKey.current = `${transactionId}:${depositAddress}`;
        },
        onApprove,
      });
      return;
    }
    if (!swapInput) {
      onApprove?.();
      return;
    }
    if (expired) {
      setSubmitError("Your approval has expired. Please try a fresh quote.");
      return;
    }
    if (!account) {
      setSubmitError("Connect a wallet first.");
      return;
    }
    if (!figures.minAmountOutRaw || !figures.expiresAt) {
      setSubmitError("Ask for a fresh quote first.");
      return;
    }
    setSubmitError(null);

    // The wallet signs the exact parameters. Nothing is submitted until
    // the signature exists, and the server rechecks every field it covers
    // against its own saved quote — a moved value fails the comparison.
    const slippageBps = swapInput.slippageBps ?? 100;
    // Refunds must be valid on the origin chain. The model may name one;
    // otherwise the connected wallet pays and is refunded.
    const refundToAddr = swapInput.refundTo || refundTo || account.address;
    const message = buildTradeApprovalMessage({
      fromAssetId: swapInput.fromAssetId,
      toAssetId: swapInput.toAssetId,
      amount: swapInput.amount,
      recipient: swapInput.recipient,
      refundTo: refundToAddr,
      slippageBps,
      minAmountOut: figures.minAmountOutRaw,
      expiresAt: figures.expiresAt,
      requestedAt: requestedAt ?? new Date().toISOString(),
    });

    setTxState("signing");
    let auth: {
      signature: string;
      publicKey?: string;
      recipientField?: string;
      nonce?: string;
    };
    try {
      auth = await signTrade(message);
    } catch {
      setTxState("awaiting");
      setSubmitError("Signature was rejected. Nothing was submitted.");
      return;
    }

    setTxState("submitting");
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...swapInput,
          slippageBps,
          refundTo: refundToAddr,
          minAmountOut: figures.minAmountOutRaw,
          expiresAt: figures.expiresAt,
          requestedAt: requestedAt ?? new Date().toISOString(),
          message,
          ...auth,
          conversationId,
          approvalId,
        }),
      });
      if (res.status === 409) {
        const moved = (await res.json().catch(() => null)) as {
          message?: string;
          fresh?: {
            amountOut: string;
            minAmountOut: string;
            minAmountOutRaw: string;
            expiresAt: string;
          };
        } | null;
        if (moved?.fresh) setFigures((f) => ({ ...f, ...moved.fresh }));
        setTxState("awaiting");
        setSubmitError(moved?.message ?? "The price has moved. Please review and resubmit.");
        return;
      }
      if (res.status === 401) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        setTxState("awaiting");
        if (body?.error === "wallet-changed" && body.message) {
          setSubmitError(body.message);
        } else if (body?.error === "Not signed in.") {
          setSubmitError("Please sign in with your wallet, then approve again.");
        } else {
          setSubmitError("Signature was rejected. Nothing was submitted.");
        }
        return;
      }
      if (!res.ok) throw new Error("submit failed");
      const body = (await res.json()) as {
        transactionId: string;
        depositAddress: string;
        depositMemo?: string | null;
        amountIn?: string;
        tokenContract?: string | null;
        originChain?: string;
        originChainId?: number | null;
        originChainName?: string | null;
      };
      setTxId(body.transactionId);
      setDeposit(body.depositAddress);

      // The wet quote holds the deposit. Fund it from the connected wallet
      // with the exact quoted amount, then register the hash so the status
      // poll moves off pending. A rejected deposit leaves funds untouched;
      // the record stays and the workflow times out on its own.
      try {
        const amount = body.amountIn ?? swapInput.amount;
        const { txHash, senderAccount } = await sendDeposit({
          depositAddress: body.depositAddress,
          amount,
          tokenAddress: body.tokenContract ?? undefined,
          tokenMint: body.tokenContract ?? undefined,
          tokenContract: body.tokenContract ?? undefined,
          chainId: body.originChainId ?? undefined,
          chainName: body.originChainName ?? undefined,
        });
        // Register the hash so the status poll moves off pending. Retried,
        // because a single dropped request would leave the settlement
        // waiting on auto-detection with the card reading as stuck. The
        // poll stays authoritative either way.
        await registerDepositTx({
          transactionId: body.transactionId,
          txHash,
          senderAccount,
          memo: body.depositMemo ?? null,
        });
      } catch (err) {
        setTxState("awaiting");
        if (err instanceof Error && err.message === "chain-switch-rejected") {
          setSubmitError(
            `Switch to the ${body.originChainName ?? "required"} network in your wallet, then approve again.`,
          );
        } else if (err instanceof Error && err.message === "unsupported-network") {
          setSubmitError("Deposits from this network aren't supported yet.");
        } else {
          setSubmitError("The deposit was rejected. Nothing was moved.");
        }
        return;
      }

      setTxState("submitted");
      onApprove?.({
        transactionId: body.transactionId,
        depositAddress: body.depositAddress,
      });
    } catch {
      setTxState("awaiting");
      setSubmitError("Unable to execute trade. Please try again.");
    }
  };

  async function signTrade(message: string): Promise<{
    signature: string;
    publicKey?: string;
    recipientField?: string;
    nonce?: string;
  }> {
    if (!account) throw new Error("no-wallet");
    if (account.kind === "near") {
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
      const recipientField =
        typeof window !== "undefined" ? window.location.origin : "";
      const signed = await signNEP413({
        message,
        recipient: recipientField,
        nonce: nonceBytes,
      });
      return {
        signature: signed.signature,
        publicKey: signed.publicKey,
        recipientField,
        nonce: toHex(nonceBytes),
      };
    }
    const signatureBytes = await signMessage(new TextEncoder().encode(message));
    return {
      signature:
        account.kind === "evm" ? `0x${toHex(signatureBytes)}` : toHex(signatureBytes),
    };
  }

  const handleDeny = () => {
    setTxState("denied");
    onDeny?.();
  };

  /**
   * Funds the minted address from the connected wallet.
   *
   * The transfer is the same one the card has always offered a wallet: the
   * exact raw amount, the quote's token, and the quote's chain, so
   * `sendDeposit` can switch networks before it sends. The hash is registered
   * so 1Click notices sooner; the record still decides the outcome.
   */
  const handleTransfer = async () => {
    if (!deposit || !txId || !meta || transferRef.current) return;
    if (!canTransferDeposit(meta, account?.kind ?? null)) {
      return;
    }
    transferRef.current = true;
    setTransferring(true);
    setSubmitError(null);
    try {
      const { txHash, senderAccount } = await sendDeposit({
        depositAddress: deposit,
        amount: meta.amountInRaw,
        tokenAddress: meta.tokenContract,
        tokenMint: meta.tokenContract,
        tokenContract: meta.tokenContract,
        chainId: meta.chainId,
        chainName: meta.chainName,
      });
      await registerDepositTx({
        transactionId: txId,
        txHash,
        senderAccount,
        memo: shownMemo,
      });
      setTxState("processing");
    } catch (err) {
      if (err instanceof Error && err.message === "chain-switch-rejected") {
        setSubmitError(
          `Switch to the ${meta.chainName ?? "required"} network in your wallet, then try again.`,
        );
      } else if (err instanceof Error && err.message === "unsupported-network") {
        setSubmitError("Deposits from this network aren't supported yet.");
      } else {
        setSubmitError("The deposit was rejected. Nothing was moved.");
      }
    } finally {
      transferRef.current = false;
      setTransferring(false);
    }
  };

  /**
   * Abandons a terminal address and mints a fresh one through the same
   * adapter. The old address is never reused: an expired quote, a short
   * deposit, or a refunded one has no address worth funding again.
   */
  const handleNewAddress = async () => {
    if (!runApproval || mintRef.current) return;
    const previous = txState;
    mintRef.current = true;
    setMinting(true);
    setSubmitError(null);
    setTxState("signing");
    try {
      const result = await runApproval({ onPhase: setTxState });
      if (!result.ok) {
        setTxState(previous);
        if (!result.expired) setSubmitError(result.message);
        return;
      }
      setTxId(result.transactionId);
      setDeposit(result.depositAddress);
      setMemo(result.depositMemo ?? null);
      setFigures((current) => ({
        ...current,
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      }));
      if (result.deposit) setMeta(result.deposit);
      else setMeta(null);
      setExplorerUrls([]);
      setReceived(null);
      setStatusCheck("idle");
      setClock(Date.now());
      setDetailsOpen(true);
      setTxState("waiting");
      // A freshly minted address has no revisit check due; the next mount
      // will make the one authoritative request.
      refreshedKey.current = `${result.transactionId}:${result.depositAddress}`;
      // The decision is already answered; only the record changes.
      onRecord?.({
        transactionId: result.transactionId,
        depositAddress: result.depositAddress,
      });
    } catch {
      setTxState(previous);
      setSubmitError("The deposit could not be prepared. Please try again.");
    } finally {
      mintRef.current = false;
      setMinting(false);
    }
  };

  const busy =
    txState === "signing" ||
    txState === "submitting" ||
    txState === "submitted" ||
    txState === "processing";
  const awaiting = viewState === "awaiting";

  const rate = rateOf(amountIn, figures.amountOut);
  const senderAddress = sender === null ? undefined : account?.address;
  const senderIdentity = senderAddress
    ? addressIdentity(account, senderAddress, fromChain)
    : null;
  // A withdrawal shows the stored quote's destination until the server
  // rebuilds it; the passkey deposit has no wallet source at all.
  const shownRecipient = boundRecipient ?? recipient;
  const recipientIdentity = addressIdentity(account, shownRecipient, toChain);

  // Hover detail cards: one open at a time across every chip surface. The
  // shared tooltip coordinator decides first (animate) vs warm (instant);
  // the hover-card claim closes any other card before this one paints.
  const cardId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [instant, setInstant] = useState(false);
  const anchors = useRef(new Map<string, HTMLElement>());
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusOpened = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [popupEl, setPopupEl] = useState<HTMLDivElement | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      releaseHoverCard(cardId);
    },
    [cardId],
  );
  const cancelHoverTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const closePopup = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpenId(null);
    releaseHoverCard(cardId);
    onTooltipLeave();
  }, [cardId]);
  const prefetchPrice = (id: string) => {
    if (id === "token-from" && !fromPriceUsd) {
      prefetchSymbolPrice(fromSymbol, fromChain);
    } else if (id === "token-to" && !toPriceUsd) {
      prefetchSymbolPrice(toSymbol, toChain);
    }
  };
  const openChip = (id: string, isInstant: boolean) => {
    prefetchPrice(id);
    claimHoverCard(cardId, closePopup);
    if (openId === id) {
      activateWarmState();
      return;
    }
    setInstant(isInstant);
    setOpenId(id);
    activateWarmState();
  };
  const hoverSoon = (id: string) => {
    cancelHoverTimer();
    // Close a card owned by another chip before this hover begins its own
    // (possibly delayed) open, so two cards never overlap.
    dismissHoverCard(cardId);
    prefetchPrice(id);
    onTooltipEnter();
    // Same chip already showing: keep its current entrance state rather than
    // re-opening it and restarting the pop-in.
    if (openId === id) return;
    // Switching between open chips skips the delay, after the tooltip
    // rule: the first appearance waits and animates, the rest are instant.
    if (openId !== null || globalIsWarm) {
      openChip(id, true);
      return;
    }
    closeTimer.current = setTimeout(() => openChip(id, false), 120);
  };
  const hoverAway = (id: string) => {
    // A re-render or a portal appearing can produce a synthetic mouseleave
    // while the pointer is still on the chip. Trust the live hover state.
    if (anchors.current.get(id)?.matches(":hover")) return;
    cancelHoverTimer();
    onTooltipLeave();
    closeTimer.current = setTimeout(closePopup, 150);
  };
  const registerAnchor = useCallback((id: string, el: HTMLElement | null) => {
    if (el) anchors.current.set(id, el);
    else anchors.current.delete(id);
  }, []);
  const hoverPopup = useCallback(
    (hovering: boolean) => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      if (hovering) {
        onTooltipEnter();
        return;
      }
      onTooltipLeave();
      closeTimer.current = setTimeout(closePopup, 150);
    },
    [closePopup],
  );
  // The popup portals to the body, outside this root, so blur only closes
  // when focus leaves both the sentence and the open card.
  const sentenceBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (rootRef.current?.contains(next)) return;
    if (popupEl?.contains(next)) return;
    closePopup();
  };
  const hover = (id: string, chip: React.ReactNode) => (
    <HoverChip
      id={id}
      open={openId === id}
      chip={chip}
      register={registerAnchor}
      focusOpened={focusOpened}
      onEnter={hoverSoon}
      onLeave={hoverAway}
      onFocusChip={(cid) => openChip(cid, true)}
      onToggle={(cid, isOpen) => {
        if (isOpen) {
          closePopup();
          return;
        }
        openChip(cid, true);
      }}
      onEscape={closePopup}
    />
  );
  const popup: {
    label: string;
    height: number;
    body: React.ReactNode;
  } | null =
    openId === "venue" ? (
      {
        label: "Near Account details",
        height: 150,
        body: <VenuePopup address={account?.address} />,
      }
    ) : openId === "token-from" ? (
      {
        label: `${fromSymbol} details`,
        height: 220,
        body: (
          <TokenPopup
            symbol={fromSymbol}
            chain={fromChain}
            price={fromPriceUsd}
          />
        ),
      }
    ) : openId === "token-to" ? (
      {
        label: `${toSymbol} details`,
        height: 220,
        body: (
          <TokenPopup symbol={toSymbol} chain={toChain} price={toPriceUsd} />
        ),
      }
    ) : openId === "sender" && senderIdentity ? (
      {
        label: "Wallet details",
        height: 120,
        body: (
          <AddressPopup
            address={senderIdentity.address}
            isSelf={senderIdentity.isSelf}
            name={account?.walletName}
            icon={account?.walletIcon}
          />
        ),
      }
    ) : openId === "recipient" && shownRecipient ? (
      {
        label: "Address details",
        height: 120,
        body: (
          <AddressPopup
            address={shownRecipient}
            isSelf={recipientIdentity.isSelf}
            name={account?.walletName}
            icon={account?.walletIcon}
          />
        ),
      }
    ) : null;
  // The sentence renders the action it is given; classification lives
  // upstream in collectApprovals.
  const verb = actionTitle(action);
  // The sentence is a deterministic template over the signed parameters.
  // figures.amountOut (not the prop) so a re-quote refreshes it in place.
  const sentence =
    action === "deposit" ? (
      <>
        {sender === null ? "Deposit" : "Send"} <Amount>{amountIn}</Amount>{" "}
        {hover(
          "token-from",
          <TokenChip symbol={fromSymbol} badge={fromChain} />,
        )}{" "}
        {sender === null ? null : sender ? (
          <>
            from <AddressChip label={sender.label} icon={sender.icon} />{" "}
          </>
        ) : senderIdentity ? (
          <>
            from{" "}
            {hover(
              "sender",
              <AddressChip
                label={senderIdentity.label}
                icon={senderIdentity.icon}
              />,
            )}{" "}
          </>
        ) : (
          <>
            from <AddressChip label="your wallet" />{" "}
          </>
        )}
        {sender === null ? "in" : "to"} your{" "}
        {hover("venue", <VenueChip label="Near Account" />)}
      </>
    ) : action === "withdraw" ? (
      <>
        {verb} <Amount>{amountIn}</Amount>{" "}
        {hover(
          "token-from",
          <TokenChip symbol={fromSymbol} badge={fromChain} />,
        )}{" "}
        from your {hover("venue", <VenueChip label="Near Account" />)}{" "}
        {shownRecipient ? (
          <>
            to{" "}
            {hover(
              "recipient",
              <AddressChip
                label={recipientIdentity.label}
                icon={recipientIdentity.icon}
              />,
            )}
          </>
        ) : null}
      </>
    ) : (
      <>
        {verb} <Amount>{amountIn}</Amount>{" "}
        {hover(
          "token-from",
          <TokenChip symbol={fromSymbol} badge={fromChain} />,
        )}{" "}
        for <Amount>{figures.amountOut}</Amount>{" "}
        {hover(
          "token-to",
          <TokenChip symbol={toSymbol} badge={toChain} />,
        )}{" "}
        on {hover("venue", <VenueChip label="Near Account" />)}
      </>
    );

  // The deposit panel's figures. The QR encodes a transfer only when the
  // record names an EVM token, its chain, and the exact raw amount; every
  // other case falls back to the bare address that any wallet understands.
  const networkLabel = depositNetworkShortLabel(meta, fromChain);
  const qrValue = deposit ?? "";
  const contract = meta?.tokenContract?.trim() ?? "";
  const explorerBase = evmChainForSlug(
    meta?.chainSlug ?? fromChain ?? "",
  )?.explorerUrl;
  const contractUrl =
    contract && explorerBase
      ? `${explorerBase.replace(/\/$/, "")}/token/${contract}`
      : null;
  const tokenSymbol = fromSymbol || meta?.symbol || "";
  const transferReady = canTransferDeposit(meta, account?.kind ?? null);
  // A deposit has nothing to draw until the server issues its address, so
  // the Details control stays disabled instead of opening an empty drawer.
  const detailsEnabled = !(intents && action === "deposit") || !!deposit;

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div
        className="primitive-card-pad"
        style={{ paddingTop: 14, paddingBottom: 14 }}
      >
        {/* The sentence is a block container; the chips are inline spans, so
            nothing here can break a paragraph's content model. */}
        <div
          ref={rootRef}
          data-sentence
          onBlur={sentenceBlur}
          className="text-[15px] leading-[2] text-ink [text-wrap:pretty]"
        >
          {sentence}
        </div>
        {intents &&
        action === "deposit" &&
        ((!deposit && viewState === "awaiting") ||
          depositMessage ||
          (deposit && statusCheck === "unavailable") ||
          depositTerminal ||
          explorerUrls.length > 0) ? (
          <div className="pt-1.5">
            {!deposit && viewState === "awaiting" ? (
              <p className="text-xs text-ink-3">
                Click Start to begin the deposit process.
              </p>
            ) : null}
            {depositMessage ? (
              <p className="text-xs text-ink-2">{depositMessage}</p>
            ) : null}
            {deposit &&
            viewState === "waiting" &&
            statusCheck === "ok" ? (
              <p className="pt-1 text-xs text-ink-3">
                <button
                  type="button"
                  onClick={() => void checkDepositStatus()}
                  className="text-accent-ink hover:underline"
                >
                  Check status
                </button>
              </p>
            ) : null}
            {deposit && statusCheck === "unavailable" ? (
              <p className="pt-1 text-xs text-ink-3">
                The deposit status could not be checked.{" "}
                <button
                  type="button"
                  onClick={() => void checkDepositStatus()}
                  className="text-accent-ink hover:underline"
                >
                  Check again
                </button>
              </p>
            ) : null}
            {depositTerminal ? (
              <div className="pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleNewAddress}
                  disabled={minting}
                >
                  New address
                </Button>
              </div>
            ) : null}
            {explorerUrls.length > 0 ? (
              <div className="flex flex-col items-start gap-0.5 pt-1">
                {explorerUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent-ink hover:underline"
                  >
                    View on explorer
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {popup && openId ? (
        <Popup
          anchor={anchors.current.get(openId) ?? null}
          label={popup.label}
          height={popup.height}
          instant={instant}
          dialogRef={setPopupEl}
          onClose={closePopup}
          onHoverChange={hoverPopup}
        >
          {popup.body}
        </Popup>
      ) : null}

      {/* error drawer — same expanding section as the primitive */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: submitError ? "1fr" : "0fr",
          opacity: submitError ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div
            className="primitive-card-pad"
            style={{ paddingTop: 0, paddingBottom: 6 }}
          >
            {submitError ? (
              <p
                key={submitError}
                role="alert"
                className="text-xs text-red"
                style={{ animation: "fade-in 180ms ease-out both" }}
              >
                {submitError}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* details drawer — the primitive's expanding section */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: detailsOpen ? "1fr" : "0fr",
          opacity: detailsOpen ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-line bg-surface px-3.5 py-2">
            {intents && action === "deposit" ? (
              <>
                {deposit ? (
                  <div
                    aria-hidden={depositFaded || undefined}
                    inert={depositFaded || undefined}
                    className={`transition-opacity duration-300 ${
                      depositFaded
                        ? "pointer-events-none opacity-40 select-none"
                        : ""
                    }`}
                    style={{
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    <div className="pb-2 pt-1">
                      <DepositQr value={qrValue} />
                    </div>
                    <div className="flex flex-col items-center gap-2 pb-2">
                      <p className="max-w-full break-all select-all text-center text-xs leading-relaxed text-ink">
                        {deposit}
                      </p>
                      <CopyAddressButton value={deposit} />
                    </div>
                    <DetailRow label="Token">
                      <span className="inline-flex items-center gap-1.5">
                        <TokenAvatar symbol={tokenSymbol} size={14} />
                        {tokenSymbol}
                      </span>
                    </DetailRow>
                    {contract ? (
                      <DetailRow label="Contract address">
                        {contractUrl ? (
                          <a
                            href={contractUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={contract}
                            className="inline-flex min-w-0 items-center justify-end gap-1 text-ink hover:underline"
                          >
                            <span className="truncate">{shortAddr(contract)}</span>
                            <IconExternalLink
                              size={12}
                              stroke={1.8}
                              className="shrink-0"
                            />
                          </a>
                        ) : (
                          <span
                            className="min-w-0 truncate"
                            title={contract}
                          >
                            {shortAddr(contract)}
                          </span>
                        )}
                      </DetailRow>
                    ) : null}
                    {networkLabel ? (
                      <DetailRow label="Network">
                        <span className="inline-flex items-center gap-1.5">
                          <NetworkIcon
                            network={meta?.chainSlug ?? fromChain ?? "near"}
                            size={14}
                          />
                          {networkLabel}
                        </span>
                      </DetailRow>
                    ) : null}
                    {shownMemo ? (
                      <DetailRow label="Memo">
                        <span className="break-all">{shownMemo}</span>
                      </DetailRow>
                    ) : null}
                    {figures.expiresAt ? (
                      <DetailRow label="Valid until">
                        {new Date(figures.expiresAt).toLocaleString()}
                      </DetailRow>
                    ) : null}
                    {transferReady &&
                    !depositFaded &&
                    viewState !== "signing" &&
                    viewState !== "submitting" ? (
                      <div className="flex justify-end pt-2">
                        <Button
                          variant="accent"
                          size="sm"
                          onClick={handleTransfer}
                          disabled={transferring}
                        >
                          {transferring ? (
                            <>
                              <SpinnerRing active size={14} /> Use Wallet
                            </>
                          ) : (
                            <>
                              <IconWallet
                                size={14}
                                stroke={1.8}
                                className="shrink-0"
                              />
                              Use Wallet
                            </>
                          )}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : intents && action === "withdraw" ? (
              <>
                {shownRecipient ? (
                  <DetailRow label="Destination">
                    <span className="inline-flex min-w-0 items-start justify-end">
                      <span className="break-all select-all text-left">
                        {shownRecipient}
                      </span>
                      <CopyButton value={shownRecipient} />
                    </span>
                  </DetailRow>
                ) : null}
                {feeLabel ? (
                  <DetailRow label="Fee">
                    {feeLabel} {fromSymbol}
                  </DetailRow>
                ) : null}
                {destinationChain ? (
                  <DetailRow label="Chain">{destinationChain}</DetailRow>
                ) : null}
                {figures.minAmountOut ? (
                  <DetailRow label="Minimum received">
                    {figures.minAmountOut} {toSymbol}
                  </DetailRow>
                ) : null}
                {figures.expiresAt ? (
                  <DetailRow label="Deadline">
                    {new Date(figures.expiresAt).toLocaleTimeString()}
                  </DetailRow>
                ) : null}
                {explorerUrls.length > 0 ? (
                  <DetailRow label="Settlement">
                    <span className="flex flex-col items-end gap-0.5">
                      {explorerUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent-ink hover:underline"
                        >
                          View on explorer
                        </a>
                      ))}
                    </span>
                  </DetailRow>
                ) : null}
                {viewState === "settled" && received ? (
                  <DetailRow label="Received">
                    {received} {toSymbol}
                  </DetailRow>
                ) : null}
              </>
            ) : (
              <>
                {figures.minAmountOut ? (
                  <DetailRow label="Minimum received">
                    {figures.minAmountOut} {toSymbol}
                  </DetailRow>
                ) : null}
                {/* The swap identity rows describe a wallet trade. An Intents
                    swap has no external recipient and no wallet refund, so the
                    drawer keeps the figures and drops those three rows. */}
                {intents ? null : (
                  <>
                    <DetailRow label="Recipient">
                      <span className="inline-flex min-w-0 items-center">
                        <span className="truncate">{shortAddr(recipient)}</span>
                        <CopyButton value={recipient} />
                      </span>
                    </DetailRow>
                    {(() => {
                      const refundAddr = refundTo || account?.address;
                      return refundAddr &&
                        refundAddr.toLowerCase() !== recipient.toLowerCase() ? (
                        <DetailRow label="Refund to">
                          <span className="inline-flex min-w-0 items-center">
                            <span className="truncate">
                              {shortAddr(refundAddr)}
                            </span>
                            <CopyButton value={refundAddr} />
                          </span>
                        </DetailRow>
                      ) : null;
                    })()}
                  </>
                )}
                {rate ? (
                  <DetailRow label="Rate">
                    1 {fromSymbol} ≈ {rate} {toSymbol}
                  </DetailRow>
                ) : null}
                <DetailRow label="Slippage">
                  {((slippageBps ?? swapInput?.slippageBps ?? 100) / 100).toFixed(2)}%
                </DetailRow>
                {!intents && deposit ? (
                  <DetailRow label="Deposit to">
                    <span className="break-all">{deposit}</span>
                  </DetailRow>
                ) : null}
                {figures.expiresAt ? (
                  <DetailRow label="Price held until">
                    {new Date(figures.expiresAt).toLocaleTimeString()}
                  </DetailRow>
                ) : null}
                {explorerUrls.length > 0 ? (
                  <DetailRow label="Settlement">
                    <span className="flex flex-col items-end gap-0.5">
                      {explorerUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent-ink hover:underline"
                        >
                          View on explorer
                        </a>
                      ))}
                    </span>
                  </DetailRow>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      <div
        className="primitive-card-footer flex items-center justify-between gap-3 bg-surface"
        style={{ paddingTop: 6, paddingBottom: 6 }}
      >
        <span className="-ml-0.5 flex shrink-0 items-center">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((current) => !current)}
            disabled={!detailsEnabled}
            className="px-2.5 text-xs"
          >
            Details
          </Button>
        </span>

        <span
          key={viewState}
          className="-mr-0.5 flex min-w-0 items-center gap-2"
          style={{
            animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both",
          }}
        >
          {awaiting && (!disabled || missingDeposit) ? (
            <>
              <Button variant="secondary" size="sm" onClick={handleDeny}>
                Reject
              </Button>
              <Button variant="accent" size="sm" onClick={handleApprove}>
                {approveLabel}
              </Button>
            </>
          ) : (
            <>
              {busy ? <SpinnerRing active size={18} /> : null}
              <StatusPill tone={TONE[viewState]}>
                {LABEL[viewState]}
              </StatusPill>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function Amount({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold tabular-nums text-ink">{children}</strong>
  );
}

/* ── the injected approval ──────────────────────────────────────
 * A passkey card runs the server's own journey instead of a wallet
 * signature. Everything below is the card's half of that contract: the
 * state a poll lands in, the sentence a failure reads as, and the one
 * function `handleApprove` calls when `runApproval` is present. */

/** A card state that no later record read can advance. */
export function isTerminalCardState(state: SentenceCardState): boolean {
  return (
    state === "settled" ||
    state === "refunded" ||
    state === "incomplete" ||
    state === "failed" ||
    state === "expired" ||
    state === "denied"
  );
}

/**
 * The one mount refresh a deposit card is allowed.
 *
 * Returns the key to remember when the card should ask the server once for an
 * authoritative status, and null when it must not: no address yet, a terminal
 * record, or a check already made for this exact address. An interval would
 * turn a waiting card into a second poll; this cannot.
 */
export function depositRefreshKey(input: {
  alreadyRefreshed: string | null;
  txId?: string;
  address?: string;
  state: SentenceCardState;
}): string | null {
  if (!input.txId || !input.address) return null;
  if (isTerminalCardState(input.state)) return null;
  const key = `${input.txId}:${input.address}`;
  return input.alreadyRefreshed === key ? null : key;
}

/**
 * Registers a funding hash with the record.
 *
 * Retried because a single dropped request would leave the settlement waiting
 * on auto-detection with the card reading as stuck. The status poll stays
 * authoritative either way, so exhausting the retries is not a failure.
 */
export async function registerDepositTx(input: {
  transactionId: string;
  txHash: string;
  senderAccount?: string;
  memo?: string | null;
}): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(
        `/api/tx/${encodeURIComponent(input.transactionId)}/deposit`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            txHash: input.txHash,
            ...(input.senderAccount
              ? { nearSenderAccount: input.senderAccount }
              : {}),
            ...(input.memo ? { memo: input.memo } : {}),
          }),
        },
      );
      if (res.ok) return;
    } catch {
      // Next attempt retries.
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/** The state a poll's non-terminal record leaves the card in. */
export function polledState(
  recordState: string,
  action: TradeAction,
  intents: boolean,
): SentenceCardState {
  if (recordState === "processing" || (intents && recordState === "confirming")) {
    return "processing";
  }
  // A deposit stays waiting on its address; a withdrawal is already submitted
  // and its settlement is read from the record. A swap keeps processing until
  // the record settles, as every submitted intent does.
  if (intents && action === "deposit") return "waiting";
  if (intents && action === "withdraw") return "submitted";
  if (intents) return "processing";
  return "submitted";
}

/** The record's own received amount, or nothing. Never the quote's figure. */
export function receivedFrom(
  outcome: { amountOut?: unknown } | undefined,
): string | null {
  const value = outcome?.amountOut;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Failure copy names the action; a withdrawal settles, a deposit arrives. */
export function failureMessage(
  recordState: string,
  action: TradeAction,
  intents: boolean,
): string {
  if (intents) {
    if (action === "withdraw") {
      return "The withdrawal did not settle. The record has the details.";
    }
    // A signed intent is a trade, never a deposit: nothing was sent to an
    // address, so the wallet deposit sentences would be a lie.
    if (action !== "deposit") {
      return "The trade did not settle. The record has the details.";
    }
  }
  if (recordState === "incomplete_deposit") {
    return "The deposit arrived short of the quoted amount.";
  }
  if (recordState === "needs_reconciliation") {
    return "The settlement timed out before confirming.";
  }
  return "Deposit failed. Nothing was moved.";
}

export type SentenceApprovalWiring = {
  action: TradeAction;
  runApproval: SentenceApproval;
  /** The rendered state has already aged out; nothing is requested. */
  expired: boolean;
  inFlight: { current: boolean };
  setState: (state: SentenceCardState) => void;
  setError: (message: string | null) => void;
  setTxId: (id: string) => void;
  setDeposit: (address: string) => void;
  setMemo: (memo: string | null) => void;
  /** The server's own token, chain, amount, and deadline for the address. */
  setDepositMeta?: (meta: DepositMetadata) => void;
  setFee: (fee: string | undefined) => void;
  setFigures: (
    patch: Partial<{
      amountOut: string;
      minAmountOut: string;
      expiresAt: string;
    }>,
  ) => void;
  setDestination: (destination: string) => void;
  openDetails: () => void;
  /** The address was just minted in this card, so no revisit check is due. */
  onMinted?: (tx: { transactionId: string; depositAddress: string }) => void;
  onApprove?: (tx?: { transactionId: string; depositAddress: string }) => void;
};

/**
 * Runs the injected approval and lands its result on the card.
 *
 * One in-flight click at a time; a failure returns to `awaiting` with the
 * server's own sentence (or `expired` when the quote says so); a mint opens
 * the details and waits for the deposit; a withdrawal replaces the displayed
 * destination with the server's rebuild and reads the record from there.
 *
 * The confidential account the withdrawal approves against is deliberately
 * not stored: the card never renders it.
 */
export async function approveThroughAdapter(
  input: SentenceApprovalWiring,
): Promise<void> {
  if (input.expired) {
    input.setState("expired");
    return;
  }
  if (input.inFlight.current) return;
  input.inFlight.current = true;
  input.setError(null);
  input.setState("signing");
  try {
    const result = await input.runApproval({ onPhase: input.setState });
    if (!result.ok) {
      input.setState(result.expired ? "expired" : "awaiting");
      input.setError(result.expired ? null : result.message);
      return;
    }

    input.setTxId(result.transactionId);
    input.setFigures({
      ...(result.amountOut !== undefined
        ? { amountOut: result.amountOut }
        : {}),
      ...(result.minAmountOut !== undefined
        ? { minAmountOut: result.minAmountOut }
        : {}),
      ...(result.expiresAt !== undefined
        ? { expiresAt: result.expiresAt }
        : {}),
    });
    if (result.fee !== undefined) input.setFee(result.fee);

    if (input.action === "deposit") {
      input.setDeposit(result.depositAddress);
      input.setMemo(result.depositMemo ?? null);
      if (result.deposit) input.setDepositMeta?.(result.deposit);
      input.openDetails();
      input.setState("waiting");
      input.onMinted?.({
        transactionId: result.transactionId,
        depositAddress: result.depositAddress,
      });
      input.onApprove?.({
        transactionId: result.transactionId,
        depositAddress: result.depositAddress,
      });
      return;
    }

    if (result.destination) input.setDestination(result.destination);
    input.setState("processing");
    // A swap hands the record back so a reload rejoins the settlement instead
    // of offering a second approval. A withdrawal host ignores it: its card
    // never retains the confidential account the intent signs against.
    input.onApprove?.({
      transactionId: result.transactionId,
      depositAddress: result.depositAddress,
    });
  } catch {
    input.setState("awaiting");
    input.setError("Unable to execute trade. Please try again.");
  } finally {
    input.inFlight.current = false;
  }
}

function VenueChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-[0.4em] whitespace-nowrap rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-middle font-medium leading-none text-ink">
      <span aria-hidden="true" className="inline-flex shrink-0">
        <NetworkIcon network="near" size={18} />
      </span>
      <span>{label}</span>
    </span>
  );
}

function AddressChip({ label, icon }: { label: string; icon?: string }) {
  return (
    <span className="inline-flex items-center gap-[0.4em] whitespace-nowrap rounded-full bg-field px-[0.625em] py-[0.25em] align-middle font-medium leading-none text-ink">
      {/* align-middle centers on the x-height middle, which reads low next
          to caps, so the mark lifts a tenth of an em to the cap middle. */}
      <span
        aria-hidden="true"
        className="relative -top-[0.1em] inline-flex shrink-0"
      >
        {icon ? (
          <BrandMark src={icon} />
        ) : (
          <IconWallet size={18} stroke={2} className="text-ink-2" />
        )}
      </span>
      <span>{label}</span>
    </span>
  );
}

/* Brand-mark optical centering. Wallet icons arrive with arbitrary
 * transparent padding, so the visible glyph can sit far from its box
 * center while the box itself is correctly placed. Measuring the ink
 * bounds once per source and translating the glyph centers it for every
 * wallet. Transform-only: layout never moves, so pill heights — driven by
 * the fixed 18px box — stay identical across chips. Anything unmeasurable
 * (tainted canvas, odd sizes, SSR) renders uncorrected. */

type InkCorrection = { x: number; y: number };

const inkCache = new Map<string, InkCorrection | null>();

/** Translate needed to center ink of bbox in a square box, or null when
 * the art is already centered within half a pixel. */
export function inkCorrection(
  natural: number,
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  box: number,
): InkCorrection | null {
  if (!Number.isFinite(natural) || natural <= 0) return null;
  const k = box / natural;
  const dx = -(((bbox.minX + bbox.maxX + 1) / 2 - natural / 2) * k);
  const dy = -(((bbox.minY + bbox.maxY + 1) / 2 - natural / 2) * k);
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  const quantize = (v: number) => Math.round(v * 2) / 2 + 0;
  return { x: quantize(dx), y: quantize(dy) };
}

function measureInk(src: string, box: number): Promise<InkCorrection | null> {
  const key = `${src}@${box}`;
  const hit = inkCache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const done = (value: InkCorrection | null) => {
      inkCache.set(key, value);
      resolve(value);
    };
    try {
      if (typeof Image === "undefined" || typeof document === "undefined") {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const W = img.naturalWidth;
          const H = img.naturalHeight;
          if (!W || !H || W !== H) return done(null);
          const cv = document.createElement("canvas");
          cv.width = W;
          cv.height = H;
          const ctx = cv.getContext("2d");
          if (!ctx) return done(null);
          ctx.drawImage(img, 0, 0);
          const px = ctx.getImageData(0, 0, W, H).data;
          let minX = W,
            maxX = -1,
            minY = H,
            maxY = -1;
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              if (px[(y * W + x) * 4 + 3] > 12) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxX < 0) return done(null);
          done(inkCorrection(W, { minX, maxX, minY, maxY }, box));
        } catch {
          // Tainted canvas or raster failure: render uncorrected.
          done(null);
        }
      };
      img.onerror = () => done(null);
      img.src = src;
    } catch {
      done(null);
    }
  });
}

function BrandMark({ src, size = 18 }: { src: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const [shift, setShift] = useState<InkCorrection | null>(null);
  if (failed) {
    return <IconWallet size={size} stroke={2} className="text-ink-2" />;
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      onLoad={(e) => {
        const el = e.currentTarget;
        void measureInk(el.currentSrc || src, size).then(setShift);
      }}
      className="block rounded-full object-contain"
      style={{
        width: size,
        height: size,
        ...(shift
          ? { transform: `translate(${shift.x}px, ${shift.y}px)` }
          : null),
      }}
    />
  );
}

/* Hover detail cards. One open at a time; the popup portals to the body so
 * no ancestor — inline wrapper, card with overflow-hidden, or stacking
 * context — can trap it or reflow the sentence. As a child of the inline
 * wrapper the fixed card would split the inline box and move the words
 * around it; outside the flow it cannot. */
/* Line-aware placement helpers. The sentence lays out in known line boxes;
 * the popup asks which visual line its chip sits on and prefers a side from
 * that — first and middle lines open above, the last line below — with
 * viewport fit holding a veto over both. */

/** Visual line tops of a sentence container, clustered so chip fragments
 * sitting a pixel or two off the text baseline do not fake extra lines. */
function sentenceLineTops(root: Element): number[] {
  const range = document.createRange();
  range.selectNodeContents(root);
  const tops = [...range.getClientRects()]
    .map((b) => Math.round(b.top))
    .sort((a, b) => a - b);
  const lines: number[] = [];
  for (const top of tops) {
    if (lines.length === 0 || top - lines[lines.length - 1] > 4) {
      lines.push(top);
    }
  }
  return lines;
}

/** Index of the line holding a vertical center, tolerant of sub-pixel tops. */
export function locateLineIndex(lineTops: number[], centerY: number): number {
  let index = 0;
  lineTops.forEach((top, i) => {
    if (top <= centerY + 1) index = i;
  });
  return index;
}

/** Preferred side first, viewport fit second. A side that fits nowhere
 * still loses to one that fits; when neither fits the legacy side wins. */
export function resolveAbove(
  prefersAbove: boolean,
  fitsAbove: boolean,
  fitsBelow: boolean,
): boolean {
  if (prefersAbove) return fitsAbove || !fitsBelow;
  return !fitsBelow && fitsAbove;
}

function HoverChip({
  id,
  open,
  chip,
  register,
  focusOpened,
  onEnter,
  onLeave,
  onFocusChip,
  onToggle,
  onEscape,
}: {
  id: string;
  open: boolean;
  chip: React.ReactNode;
  register: (id: string, el: HTMLElement | null) => void;
  focusOpened: React.RefObject<boolean>;
  onEnter: (id: string) => void;
  onLeave: (id: string) => void;
  onFocusChip: (id: string) => void;
  onToggle: (id: string, isOpen: boolean) => void;
  onEscape: () => void;
}) {
  return (
    <span
      ref={(el) => {
        register(id, el);
      }}
      tabIndex={0}
      aria-expanded={open}
      aria-haspopup="dialog"
      className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onMouseEnter={() => onEnter(id)}
      onMouseLeave={() => onLeave(id)}
      onFocus={() => {
        // A click trails its own focus-open and must not toggle straight
        // back shut; keyboard clicks carry no detail count and still toggle.
        focusOpened.current = true;
        onFocusChip(id);
      }}
      onClick={(e) => {
        if (e.detail !== 0 && focusOpened.current) {
          focusOpened.current = false;
          return;
        }
        focusOpened.current = false;
        onToggle(id, open);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onEscape();
      }}
    >
      {chip}
    </span>
  );
}

function Popup({
  anchor,
  label,
  height,
  instant,
  dialogRef,
  onClose,
  onHoverChange,
  children,
}: {
  anchor: HTMLElement | null;
  label: string;
  /** Estimated popup height, used only to pick which side it opens on. */
  height: number;
  /** True when switching from another open card: no entrance animation. */
  instant: boolean;
  dialogRef: (el: HTMLDivElement | null) => void;
  onClose: () => void;
  onHoverChange: (hovering: boolean) => void;
  children: React.ReactNode;
}) {
  const [box, setBox] = useState<
    { x: number; top?: number; bottom?: number; origin: string } | null
  >(null);

  useEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = 248;
    const x = Math.min(
      Math.max(8, r.left + r.width / 2 - w / 2),
      window.innerWidth - w - 8,
    );
    // Prefer above whenever the card fits there; fall below only when it
    // does not. If neither side fits, keep the line-aware fallback: first
    // and middle lines above, last line below.
    const root = anchor.closest("[data-sentence]");
    const tops = root ? sentenceLineTops(root) : [];
    const index = locateLineIndex(tops, (r.top + r.bottom) / 2);
    const linePreference =
      tops.length === 0 ? false : index === 0 || index < tops.length - 1;
    const fitsAbove = r.top - 8 - height > 8;
    const fitsBelow = r.bottom + 8 + height < window.innerHeight;
    const above = fitsAbove ? true : fitsBelow ? false : linePreference;
    // Origin-aware entrance, after the wallet menu: the card scales from
    // the chip, not from its own center — the vertical edge faces the
    // trigger, and the horizontal point tracks the chip's center, clamped
    // into the card when the viewport pushes it aside.
    const chipCenter = r.left + r.width / 2;
    const originX = Math.min(Math.max(((chipCenter - x) / w) * 100, 0), 100);
    const origin = `${originX.toFixed(1)}% ${above ? "100%" : "0%"}`;
    setBox(
      above
        ? { x, bottom: window.innerHeight - r.top + 8, origin }
        : { x, top: r.bottom + 8, origin },
    );
  }, [anchor, height]);

  useEffect(() => {
    if (!anchor) return;
    const startX = anchor.getBoundingClientRect().left;
    const startY = anchor.getBoundingClientRect().top;
    const onScroll = () => {
      const current = anchor.getBoundingClientRect();
      if (
        Math.abs(current.left - startX) > 2 ||
        Math.abs(current.top - startY) > 2
      ) {
        onClose();
      }
    };
    const onResize = () => onClose();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  if (!box) return null;
  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={label}
      data-instant={instant ? "" : undefined}
      className="token-hover-card rounded-card bg-surface p-3 shadow-card"
      style={{
        position: "fixed",
        left: box.x,
        width: 248,
        zIndex: 50,
        ...(box.bottom != null ? { bottom: box.bottom } : { top: box.top }),
        transformOrigin: box.origin,
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/* Identity marker: the green pill with a matching user glyph. */
export function YouPill() {
  return (
    <StatusPill tone="green">
      <span className="inline-flex items-center gap-1">
        <IconUserCircle size={13} stroke={2} aria-hidden="true" />
        You
      </span>
    </StatusPill>
  );
}

export function AddressPopup({
  address,
  isSelf,
  name,
  icon,
}: {
  address: string;
  isSelf: boolean;
  name?: string;
  icon?: string;
}) {
  return (
    <div>
      <div className="flex justify-center pb-2">
        {isSelf ? (
          <YouPill />
        ) : (
          <StatusPill tone="accent">External Address</StatusPill>
        )}
      </div>
      {isSelf ? (
        <p className="text-center text-xs text-ink-2">Connected wallet</p>
      ) : null}
      <div className="my-2 border-t border-line" aria-hidden="true" />
      {isSelf && name ? (
        <PopupRow label="Wallet">
          {icon ? (
            <BrandMark src={icon} size={16} />
          ) : (
            <IconWallet size={14} stroke={2} className="text-ink-2" />
          )}
          <span>{name}</span>
        </PopupRow>
      ) : null}
      <PopupRow label="Address">
        <span className="inline-flex min-w-0 items-center">
          <span className="truncate">{shortAddr(address)}</span>
          <CopyButton value={address} />
        </span>
      </PopupRow>
    </div>
  );
}

export function VenuePopup({ address }: { address?: string }) {
  return (
    <div>
      <div className="flex justify-center pb-2">
        <YouPill />
      </div>
      <p className="text-center text-xs text-ink-2">Near Account</p>
      <div className="my-2 border-t border-line" aria-hidden="true" />
      <PopupRow label="Type">Near Intents</PopupRow>
      <PopupRow label="Contract">intents.near</PopupRow>
      {address ? (
        <PopupRow label="Address">
          <span className="inline-flex min-w-0 items-center">
            <span className="truncate">{shortAddr(address)}</span>
            <CopyButton value={address} />
          </span>
        </PopupRow>
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-ink-3">{label}</span>
      <span className="min-w-0 text-right text-xs tabular-nums text-ink">
        {children}
      </span>
    </div>
  );
}

/** Whole units out per unit in, from the formatted figures. */
function rateOf(amountIn: string, amountOut: string): string | null {
  const rate = Number(amountOut) / Number(amountIn);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return String(Number(rate.toPrecision(4)));
}

function CopyAddressButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy deposit address"}
      title={copied ? "Copied" : "Copy deposit address"}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard unavailable; the address stays visible to copy by hand.
          }
        })();
      }}
      className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-xs text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink"
    >
      {copied ? (
        <IconCheck size={13} stroke={2.2} className="shrink-0 text-green" />
      ) : (
        <IconCopy size={13} stroke={1.8} className="shrink-0" />
      )}
      <span className={copied ? "text-green" : undefined}>
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  /* Same crossfade as the wallet menu: the copy mark blurs and shrinks
   * out while the green check blurs and grows in. */
  const swap =
    "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), filter 240ms cubic-bezier(0.16, 1, 0.3, 1), transform 240ms cubic-bezier(0.16, 1, 0.3, 1)";
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy address"}
      title={copied ? "Copied" : "Copy address"}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard unavailable; the address stays visible to copy by hand.
          }
        })();
      }}
      className="relative ml-1 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
    >
      <span
        aria-hidden={copied}
        className="absolute inset-0 flex items-center justify-center"
        style={{
          opacity: copied ? 0 : 1,
          filter: copied ? "blur(2.5px)" : "blur(0px)",
          transform: copied ? "scale(0.85)" : "scale(1)",
          pointerEvents: copied ? "none" : "auto",
          transition: swap,
          willChange: "transform, opacity, filter",
        }}
      >
        <IconCopy size={13} stroke={1.8} strokeWidth={1.8} />
      </span>
      <span
        aria-hidden={!copied}
        className="absolute inset-0 flex items-center justify-center text-green"
        style={{
          opacity: copied ? 1 : 0,
          filter: copied ? "blur(0px)" : "blur(2.5px)",
          transform: copied ? "scale(1)" : "scale(0.85)",
          pointerEvents: copied ? "auto" : "none",
          transition: swap,
          willChange: "transform, opacity, filter",
        }}
      >
        <IconCheck size={13} stroke={2.6} strokeWidth={2.6} />
      </span>
    </button>
  );
}
