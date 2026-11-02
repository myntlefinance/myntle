import { NextResponse } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { swapLifecycle } from "@/workflows/swap-lifecycle";
import { requireSession } from "@/lib/auth/session";
import { verifyWalletSignature } from "@/lib/auth/signatures";
import {
  buildTradeApprovalMessage,
  isApprovalWindowValid,
} from "@/lib/trade/approval-message";
import { createExecutionQuote } from "@/lib/intents/service";
import {
  createApproval,
  createQuote,
  createTransaction,
  setTransactionRunId,
} from "@/lib/db/transactions";

const Body = z.object({
  fromAssetId: z.string().min(1),
  toAssetId: z.string().min(1),
  amount: z.string().min(1),
  recipient: z.string().min(1),
  slippageBps: z.number().int().min(1).max(300).default(100),
  /** Minimum accepted output, raw smallest-unit, as shown on the card. */
  minAmountOut: z.string().min(1),
  expiresAt: z.string().min(1),
  /** Card birth. Approvals older than the window are rejected. */
  requestedAt: z.string().min(1),
  /** The exact canonical message the wallet signed. */
  message: z.string().min(1).max(2000),
  signature: z.string().min(1).max(2000),
  publicKey: z.string().max(200).optional(),
  recipientField: z.string().max(200).optional(),
  nonce: z.string().max(128).optional(),
  txHash: z.string().optional(),
  conversationId: z.string().uuid().optional(),
});

/**
 * Signed approval → execution.
 *
 * Nothing starts until the connected wallet signs the exact parameters.
 * The server rebuilds the canonical message from validated fields and
 * requires byte equality, checks the quote is still live, verifies the
 * signature against the session account, then re-quotes and requires the
 * fresh minimum to cover the signed one. A modified client can neither
 * move the parameters nor fabricate another account's approval.
 */
export async function POST(req: Request) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }

  // The message must be the canonical binding of these exact parameters,
  // so a signature lifted from another trade or another app is rejected.
  const expected = buildTradeApprovalMessage({
    fromAssetId: body.fromAssetId,
    toAssetId: body.toAssetId,
    amount: body.amount,
    recipient: body.recipient,
    slippageBps: body.slippageBps,
    minAmountOut: body.minAmountOut,
    expiresAt: body.expiresAt,
    requestedAt: body.requestedAt,
  });
  if (body.message !== expected) {
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }

  // The approval window is bound by the signature: a stale card cannot be
  // approved late, even by its own owner replaying the request.
  if (!isApprovalWindowValid(body.requestedAt)) {
    return NextResponse.json(
      {
        error: "expired",
        message: "That approval expired. Ask for a fresh quote.",
      },
      { status: 409 },
    );
  }

  // A signature on an expired quote authorises nothing.
  if (Number.isNaN(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now()) {
    return NextResponse.json(
      { error: "price-moved", message: "That price expired. Ask for a fresh quote." },
      { status: 409 },
    );
  }

  try {
    await verifyWalletSignature({
      chain: session.chain,
      address: session.address,
      message: body.message,
      signature: body.signature,
      publicKey: body.publicKey,
      recipient: body.recipientField,
      nonce: body.nonce,
    });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 401 });
  }

  let execution: Awaited<ReturnType<typeof createExecutionQuote>>;
  try {
    execution = await createExecutionQuote({
      fromAssetId: body.fromAssetId,
      toAssetId: body.toAssetId,
      amount: body.amount,
      recipient: body.recipient,
      slippageBps: body.slippageBps,
    });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 502 });
  }

  // The fresh quote must cover what the wallet signed. Otherwise the card
  // shows the new figures and the user decides again — never auto-accepted.
  try {
    if (BigInt(execution.minAmountOutRaw) < BigInt(body.minAmountOut)) {
      return NextResponse.json(
        {
          error: "price-moved",
          message: "The price moved. Review the new figures.",
          fresh: {
            amountOut: execution.amountOutFormatted,
            minAmountOut: execution.minAmountOut,
            minAmountOutRaw: execution.minAmountOutRaw,
            expiresAt: execution.expiresAt,
          },
        },
        { status: 409 },
      );
    }
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 502 });
  }

  const parameters = {
    fromAssetId: body.fromAssetId,
    toAssetId: body.toAssetId,
    amount: body.amount,
    recipient: body.recipient,
    refundTo: body.recipient,
    slippageBps: body.slippageBps,
    depositAddress: execution.depositAddress,
    minAmountOut: execution.minAmountOut,
    expiresAt: execution.expiresAt,
  };

  try {
    const quoteId = await createQuote({
      userId: session.userId,
      conversationId: body.conversationId ?? null,
      request: {
        fromAssetId: body.fromAssetId,
        toAssetId: body.toAssetId,
        amount: body.amount,
        recipient: body.recipient,
        slippageBps: body.slippageBps,
      },
      response: { ...execution },
      expiresAt: execution.expiresAt,
    });
    const approvalId = await createApproval({
      quoteId,
      userId: session.userId,
      parameters,
    });
    const tx = await createTransaction({
      userId: session.userId,
      approvalId,
      conversationId: body.conversationId ?? null,
      recipient: body.recipient,
      refundTo: body.recipient,
      originAsset: body.fromAssetId,
      destinationAsset: body.toAssetId,
      amountIn: execution.amountInFormatted,
      expectedOut: execution.amountOutFormatted,
      depositAddress: execution.depositAddress,
      refs: { txHash: body.txHash ?? null },
    });

    const run = await start(swapLifecycle, [
      {
        transactionId: tx.id,
        depositAddress: execution.depositAddress,
        txHash: body.txHash,
        expectedOut: execution.amountOutFormatted,
      },
    ]);
    await setTransactionRunId(tx.id, run.runId);

    return NextResponse.json({
      transactionId: tx.id,
      depositAddress: execution.depositAddress,
      runId: run.runId,
    });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
