"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { ValuePill } from "@/components/atoms/ValuePill";
import { StatusPill } from "@/components/atoms/StatusPill";
import { SpinnerRing } from "@/components/primitives/TaskRows";
import { useWallet } from "@/lib/wallet/registry";
import { toHex } from "@/lib/wallet/types";
import { buildTradeApprovalMessage } from "@/lib/trade/approval-message";

export type TradeCardState =
  | "awaiting"
  | "signing"
  | "submitting"
  | "submitted"
  | "settled"
  | "refunded"
  | "failed";

const TONE: Record<TradeCardState, "neutral" | "accent" | "green" | "red" | "orange"> = {
  awaiting: "neutral",
  signing: "accent",
  submitting: "accent",
  submitted: "accent",
  settled: "green",
  refunded: "orange",
  failed: "red",
};

const LABEL: Record<TradeCardState, string> = {
  awaiting: "Waiting for approval",
  signing: "Sign in wallet",
  submitting: "Submitting",
  submitted: "Settling",
  settled: "Settled",
  refunded: "Refunded",
  failed: "Failed",
};

/**
 * The trade card.
 *
 * Adapts the RecommendationCard shell (card, pad, footer) to the swap:
 * the body names the amounts the user decides on, the footer holds the
 * two-word decision. Once submitted, the footer becomes the settlement
 * status polled from /api/tx/[id].
 */
export default function TradeCard({
  fromSymbol,
  toSymbol,
  amountIn,
  amountOut,
  minAmountOut,
  minAmountOutRaw,
  recipient,
  expiresAt,
  state = "awaiting",
  depositAddress,
  transactionId,
  swapInput,
  conversationId,
  disabled = false,
  onApprove,
  onDeny,
}: {
  fromSymbol: string;
  toSymbol: string;
  amountIn: string;
  amountOut: string;
  minAmountOut?: string;
  /** Raw smallest-unit minimum, bound by the wallet signature. */
  minAmountOutRaw?: string;
  recipient: string;
  expiresAt?: string;
  state?: TradeCardState;
  depositAddress?: string;
  transactionId?: string;
  swapInput?: {
    fromAssetId: string;
    toAssetId: string;
    amount: string;
    recipient: string;
    slippageBps?: number;
  };
  conversationId?: string | null;
  disabled?: boolean;
  onApprove?: (tx?: { transactionId: string; depositAddress: string }) => void;
  onDeny?: () => void;
}) {
  const { account, signMessage, signNEP413 } = useWallet();
  const [txState, setTxState] = useState<TradeCardState>(state);
  const [txId, setTxId] = useState<string | undefined>(transactionId);
  const [deposit, setDeposit] = useState<string | undefined>(depositAddress);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Quoted figures are local so a moved price can refresh the card in
  // place; props win whenever the turn produces a new quote.
  const [figures, setFigures] = useState({
    amountOut,
    minAmountOut,
    minAmountOutRaw,
    expiresAt,
  });
  useEffect(() => setTxState(state), [state]);
  useEffect(() => setTxId(transactionId), [transactionId]);
  useEffect(() => setDeposit(depositAddress), [depositAddress]);
  useEffect(() => {
    setFigures({ amountOut, minAmountOut, minAmountOutRaw, expiresAt });
  }, [amountOut, minAmountOut, minAmountOutRaw, expiresAt]);

  // After submission the card polls its own record, so a refresh keeps
  // showing the settlement rather than a stale approval.
  useEffect(() => {
    if (!txId) return;
    if (txState !== "submitted" && txState !== "submitting") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tx/${encodeURIComponent(txId)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { state?: string };
        if (cancelled || !body.state) return;
        if (body.state === "settled") setTxState("settled");
        else if (body.state === "refunded") setTxState("refunded");
        else if (body.state === "failed") setTxState("failed");
        else setTxState("submitted");
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
  }, [txId, txState]);

  const handleApprove = async () => {
    if (!swapInput) {
      onApprove?.();
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
    // the signature exists, and the server rechecks every field it covers.
    const slippageBps = swapInput.slippageBps ?? 100;
    const message = buildTradeApprovalMessage({
      fromAssetId: swapInput.fromAssetId,
      toAssetId: swapInput.toAssetId,
      amount: swapInput.amount,
      recipient: swapInput.recipient,
      slippageBps,
      minAmountOut: figures.minAmountOutRaw,
      expiresAt: figures.expiresAt,
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
          minAmountOut: figures.minAmountOutRaw,
          expiresAt: figures.expiresAt,
          message,
          ...auth,
          conversationId,
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
        setSubmitError(moved?.message ?? "The price moved. Review the new figures.");
        return;
      }
      if (res.status === 401) {
        setTxState("awaiting");
        setSubmitError("The signature was rejected. Nothing was submitted.");
        return;
      }
      if (!res.ok) throw new Error("submit failed");
      const body = (await res.json()) as {
        transactionId: string;
        depositAddress: string;
      };
      setTxId(body.transactionId);
      setDeposit(body.depositAddress);
      setTxState("submitted");
      onApprove?.({
        transactionId: body.transactionId,
        depositAddress: body.depositAddress,
      });
    } catch {
      setTxState("awaiting");
      setSubmitError("The trade could not start. Please try again.");
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
    setTxState("failed");
    onDeny?.();
  };

  const busy =
    txState === "signing" || txState === "submitting" || txState === "submitted";
  const decided = txState !== "awaiting" && txState !== "signing";

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-medium text-ink">
            {amountIn} {fromSymbol} → {figures.amountOut} {toSymbol}
          </span>
          <StatusPill tone={TONE[txState]}>{LABEL[txState]}</StatusPill>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          You receive <ValuePill tone="green">{figures.amountOut} {toSymbol}</ValuePill>
          {figures.minAmountOut ? (
            <> with at least <ValuePill>{figures.minAmountOut} {toSymbol}</ValuePill></>
          ) : null}
          {` to `}
          <span className="font-mono text-[12px]">{shortAddr(recipient)}</span>
        </p>
        {figures.expiresAt ? (
          <p className="mt-1 text-[12px] text-ink-3">
            Price held until {new Date(figures.expiresAt).toLocaleTimeString()}
          </p>
        ) : null}
        {decided && deposit ? (
          <p className="mt-1 truncate font-mono text-[11px] text-ink-3">
            {deposit}
          </p>
        ) : null}
        {submitError ? (
          <p className="mt-1 text-[12px] text-red">{submitError}</p>
        ) : null}
      </div>

      <div className="primitive-card-footer flex items-center justify-between gap-3 bg-surface">
        {busy ? (
          <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <SpinnerRing active size={18} />
            {txState === "signing" ? "Waiting for signature" : "Watching settlement"}
          </span>
        ) : decided ? (
          <span className="text-[12.5px] text-ink-2">
            {txState === "settled"
              ? "The record confirms the trade."
              : txState === "refunded"
                ? "The funds came back."
                : "Nothing moved."}
          </span>
        ) : (
          <>
            <span className="text-[12.5px] text-ink-3">Sign once in wallet</span>
            <span className="-mr-0.5 flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={handleDeny}
              >
                Reject
              </Button>
              <Button
                variant="accent"
                size="sm"
                disabled={disabled}
                onClick={handleApprove}
              >
                Approve
              </Button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function shortAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
