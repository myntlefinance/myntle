"use client";

import {
  approveIntentsTrade,
  approveIntentsWithdrawal,
  createIntentsDeposit,
} from "@/lib/intents/approval";
import type { DepositMetadata } from "@/lib/intents/deposit-metadata";
import type { IntentSigner } from "@/lib/intents/session-signer";

/**
 * What a sentence card may run in place of the wallet approval.
 *
 * The wallet swap card signs a trade message and posts it to `/api/approve`.
 * Every other money path runs through the Intents routes: a deposit mints a
 * one-time address with `/api/intents/deposit`, and a swap or withdrawal runs
 * approve → sign → submit through `/api/intents/*`. Those are different
 * journeys with the same card, so the card takes one function and leaves the
 * choice of route to the host that knows the session.
 *
 * A result says only what the server said. `ok` is a submission, never a
 * settlement: the card still reads `/api/tx/[id]` for the outcome.
 */

export type SentenceApprovalFigures = {
  amountIn?: string;
  amountOut?: string;
  minAmountOut?: string;
  fee?: string;
  expiresAt?: string;
};

export type SentenceApprovalResult =
  | ({
      ok: true;
      transactionId: string;
      /** The record to poll. For a deposit this is also the address to fund. */
      depositAddress: string;
      /** The server-rebuilt destination, for a withdrawal only. */
      destination?: string;
      depositMemo?: string | null;
      /** The exact token, chain, amount, and deadline of a deposit address. */
      deposit?: DepositMetadata;
    } & SentenceApprovalFigures)
  | { ok: false; message: string; expired?: boolean };

export type SentenceApproval = (input: {
  onPhase: (phase: "signing" | "submitting") => void;
}) => Promise<SentenceApprovalResult>;

/**
 * A deposit: ask the server for the one-time address.
 *
 * The body names the asset, the raw amount, the conversation, and the tool
 * approval. It never names a recipient or a chain; the server pins those to
 * the session's Intents account. There is no signature, so any session kind
 * can run this — the card omits its "from" clause because the funds arrive
 * from an exchange or another wallet.
 */
export function depositApproval(input: {
  assetId: string;
  amount: string;
  approvalId?: string;
  conversationId?: string | null;
}): SentenceApproval {
  return async () => {
    const result = await createIntentsDeposit({
      assetId: input.assetId,
      amount: input.amount,
      approvalId: input.approvalId,
      conversationId: input.conversationId,
    });
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      transactionId: result.transactionId,
      depositAddress: result.depositAddress,
      depositMemo: result.depositMemo,
      amountIn: result.amountIn,
      expiresAt: result.expiresAt || undefined,
      deposit: result.deposit,
    };
  };
}

/**
 * A confidential swap: approve the stored quote, sign the returned payload
 * with the session signer, submit the assertion.
 *
 * The card keeps the quoted figures it was rendered with; the result carries
 * only the record to poll, because the server has not repriced anything the
 * reader is deciding on. An empty quote id is a missing quote, not a request.
 */
export function swapApproval(input: {
  quoteId: string;
  approvalId?: string;
  conversationId?: string | null;
  sign: (payload: string) => Promise<Record<string, unknown>>;
}): SentenceApproval {
  return async ({ onPhase }) => {
    if (!input.quoteId) {
      return {
        ok: false,
        message: "The quote is no longer available. Ask for a fresh one.",
      };
    }
    const result = await approveIntentsTrade({
      quoteId: input.quoteId,
      approvalId: input.approvalId,
      conversationId: input.conversationId,
      sign: input.sign,
      onPhase,
    });
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        ...(result.reason === "expired" ? { expired: true } : {}),
      };
    }
    return {
      ok: true,
      transactionId: result.transactionId,
      depositAddress: result.depositAddress,
    };
  };
}

/**
 * A withdrawal: approve the stored quote, sign the returned payload, submit
 * the assertion.
 *
 * The destination in the result is the server's own rebuild of the stored
 * quote, which is the only address the card ever shows. The signer comes from
 * the session, so a passkey account signs with its credential and a wallet
 * account signs with the standard its chain uses.
 */
export function withdrawalApproval(input: {
  quoteId: string;
  approvalId?: string;
  conversationId?: string | null;
  sign: IntentSigner;
}): SentenceApproval {
  return async ({ onPhase }) => {
    if (!input.quoteId) {
      return {
        ok: false,
        message: "The quote is no longer available. Ask for a fresh one.",
      };
    }
    const result = await approveIntentsWithdrawal({
      quoteId: input.quoteId,
      approvalId: input.approvalId,
      conversationId: input.conversationId,
      sign: input.sign,
      onPhase,
    });
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        ...(result.reason === "expired" ? { expired: true } : {}),
      };
    }
    return {
      ok: true,
      transactionId: result.transactionId,
      depositAddress: result.depositAddress,
      destination: result.destination,
      amountIn: result.figures.amountIn,
      amountOut: result.figures.amountOut,
      minAmountOut: result.figures.minAmountOut,
      fee: result.figures.fee,
      expiresAt: result.figures.expiresAt,
    };
  };
}
