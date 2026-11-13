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
      /** The 1Click order id, present only for a limit order. */
      orderId?: string;
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
 * An account-funded swap: approve the stored quote, sign the returned
 * payload with the session signer, submit the assertion.
 *
 * The card keeps the quoted figures it was rendered with; the result carries
 * only the record to poll, because the server has not repriced anything the
 * reader is deciding on. An empty quote id is a missing quote, not a request.
 */
export function swapApproval(input: {
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

/**
 * Creates a resting limit order and funds it with the session's signer.
 *
 * The server rebuilds every priced field from the stored quote and returns
 * either a one-time address for a wallet-funded order or the exact intent the
 * account must sign. The card does not post figures; it names the quote and
 * the decision.
 */
export function limitOrderApproval(input: {
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

    let created: Response;
    try {
      created = await fetch("/api/orders", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteId: input.quoteId,
          approvalId: input.approvalId ?? null,
          conversationId: input.conversationId ?? null,
        }),
      });
    } catch {
      return {
        ok: false,
        message: "The order could not be prepared. Nothing was moved.",
      };
    }

    const body = (await created.json().catch(() => null)) as {
      transactionId?: unknown;
      depositAddress?: unknown;
      deposit?: unknown;
      order?: { orderId?: unknown };
      intent?: { standard?: unknown; payload?: unknown };
      error?: unknown;
      message?: unknown;
    } | null;

    if (!created.ok) {
      const message =
        typeof body?.message === "string"
          ? body.message
          : created.status === 401
            ? "Sign in to place an order."
            : "The order could not be prepared. Nothing was moved.";
      return { ok: false, message };
    }

    const transactionId =
      typeof body?.transactionId === "string" ? body.transactionId : "";
    const depositAddress =
      typeof body?.depositAddress === "string" ? body.depositAddress : "";
    if (!transactionId) {
      return {
        ok: false,
        message: "The order could not be prepared. Please try again.",
      };
    }

    const deposit = isDepositMetadata(body?.deposit) ? body.deposit : undefined;

    // A wallet-funded order is funded from the wallet, exactly like a swap's
    // deposit. The card opens the funding panel and waits for the transfer.
    if (!body?.intent) {
      if (!depositAddress) {
        return {
          ok: false,
          message: "The order could not be prepared. Please try again.",
        };
      }
      return {
        ok: true,
        transactionId,
        depositAddress,
        depositMemo: deposit?.memo ?? null,
        ...(deposit ? { deposit } : {}),
        ...(typeof body?.order?.orderId === "string"
          ? { orderId: body.order.orderId }
          : {}),
      };
    }

    const standard = body.intent.standard;
    const payload = body.intent.payload;
    if (
      standard !== "webauthn" &&
      standard !== "erc191" &&
      standard !== "raw_ed25519" &&
      standard !== "nep413"
    ) {
      return {
        ok: false,
        message: "The order could not be signed. Nothing was moved.",
      };
    }
    if (
      typeof payload !== "string" &&
      (typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload))
    ) {
      return {
        ok: false,
        message: "The order could not be signed. Nothing was moved.",
      };
    }

    const signablePayload: string | Record<string, unknown> =
      typeof payload === "string"
        ? payload
        : (payload as Record<string, unknown>);

    onPhase("signing");
    let signedData: Record<string, unknown>;
    try {
      signedData = await input.sign({ standard, payload: signablePayload });
    } catch {
      return {
        ok: false,
        message: "Nothing was moved. The signature was not accepted.",
      };
    }

    onPhase("submitting");
    let submitted: Response;
    try {
      submitted = await fetch("/api/intents/submit", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId, signedData }),
      });
    } catch {
      return {
        ok: false,
        message: "The order could not be submitted. Please try again.",
      };
    }

    if (!submitted.ok) {
      return {
        ok: false,
        message:
          submitted.status === 409
            ? "This order was already submitted."
            : "The order could not be submitted. Nothing was moved.",
      };
    }

    return {
      ok: true,
      transactionId,
      depositAddress,
      ...(typeof body.order?.orderId === "string"
        ? { orderId: body.order.orderId }
        : {}),
    };
  };
}

function isDepositMetadata(value: unknown): value is DepositMetadata {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.address === "string" &&
    typeof record.amountInRaw === "string" &&
    typeof record.symbol === "string"
  );
}
