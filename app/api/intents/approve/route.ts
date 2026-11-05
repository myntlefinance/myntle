import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { swapLifecycle } from "@/workflows/swap-lifecycle";
import { requireSession } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import {
  createExecutionQuote,
  generateIntent,
} from "@/lib/intents/service";
import {
  actionMatchesMode,
  approveBodySchema,
  isSignedQuoteMode,
  readStoredQuoteRequest,
  standardForSession,
  type ApproveBody,
} from "@/lib/intents/route-policy";
import {
  addEvent,
  createApproval,
  createQuote,
  createTransaction,
  getQuote,
  setTransactionRunId,
  setTransactionState,
  updateTransactionRefs,
} from "@/lib/db/transactions";

/**
 * Turns a server-saved dry quote into the exact action the user will approve.
 *
 * The browser body only names the quote, the action and the mode. Every priced
 * value is rebuilt from the stored quote row, so a modified client cannot move
 * the asset, the amount, the recipient, the refund address, or the slippage.
 *
 * Three modes, two lifecycles:
 *
 * - `confidential-intents` spends a confidential balance and keeps the output
 *   there. `confidential-withdrawal` spends the same balance and pays an
 *   external destination chain. Both are signed modes: the server mints the
 *   wet quote, asks 1Click for the exact payload, stores it, and returns it for
 *   the signer. The transaction stays `awaiting_approval`, and no workflow
 *   starts until `/api/intents/submit` has verified the assertion and 1Click
 *   returned an `intentHash`.
 * - `confidential-external` funds a confidential balance from an external
 *   chain. There is no signed intent, so the transaction is submitted and the
 *   settlement workflow starts immediately; the user funds the returned
 *   deposit address.
 *
 * A `chain` quote is deliberately not accepted here. The wallet direct route
 * owns that flow.
 */
export async function POST(req: Request) {
  const { limited } = checkRateLimit(
    `intents-approve:${clientIp(req)}`,
    10,
    60_000,
  );
  if (limited) {
    return NextResponse.json({ error: "An error occurred." }, { status: 429 });
  }

  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: ApproveBody;
  try {
    body = approveBodySchema.parse(await req.json());
  } catch {
    console.error("[intents/approve] invalid body");
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }

  const stored = await getQuote(session.userId, body.quoteId);
  if (!stored) {
    console.error("[intents/approve] unknown quote", { quoteId: body.quoteId });
    return NextResponse.json(
      {
        error: "stale",
        message: "This quote is no longer on record. Please ask for a fresh quote.",
      },
      { status: 400 },
    );
  }

  const storedExpiry = Date.parse(stored.expires_at);
  if (!Number.isFinite(storedExpiry) || storedExpiry <= Date.now()) {
    return NextResponse.json(
      {
        error: "expired",
        message: "The quote expired. Ask for a new one.",
      },
      { status: 409 },
    );
  }

  const parsed = readStoredQuoteRequest(stored.request, {
    mode: body.mode,
    accountKind: session.accountKind,
    intentsAccountId: session.intentsAccountId,
  });
  if (!parsed.ok) {
    console.error("[intents/approve] stored quote rejected", {
      quoteId: stored.id,
      reason: parsed.reason,
    });
    return NextResponse.json(
      {
        error: "stale",
        message: "The quote was priced for a different account. Please ask for a fresh quote.",
      },
      { status: 400 },
    );
  }
  const params = parsed.params;

  // The stored mode is the record of truth when it was written. The body may
  // only name a mode that agrees with it, and the action must name the money
  // path: a withdrawal pays an external address, an external deposit funds
  // the account, and the private swap modes do neither.
  const mode = params.mode ?? body.mode;
  if (!actionMatchesMode(mode, body.action)) {
    console.error("[intents/approve] action does not match the quote mode", {
      quoteId: stored.id,
      mode,
      action: body.action,
    });
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }

  let execution: Awaited<ReturnType<typeof createExecutionQuote>>;
  try {
    execution = await createExecutionQuote({
      fromAssetId: params.fromAssetId,
      toAssetId: params.toAssetId,
      amount: params.amount,
      recipient: params.recipient,
      refundTo: params.refundTo,
      slippageBps: params.slippageBps,
      confidentiality: params.confidentiality,
      mode,
    });
  } catch {
    console.error("[intents/approve] execution quote failed", {
      quoteId: stored.id,
    });
    return NextResponse.json({ error: "An error occurred." }, { status: 502 });
  }

  // Captured from the session, never from the browser. A passkey account has
  // no wallet; a wallet account's standard follows its chain.
  const standard = standardForSession(session);

  let wetQuoteId: string;
  let approvalId: string;
  let transactionId: string;
  let expectedOut: string;

  try {
    wetQuoteId = await createQuote({
      userId: session.userId,
      conversationId: body.conversationId ?? null,
      request: {
        fromAssetId: params.fromAssetId,
        toAssetId: params.toAssetId,
        amount: params.amount,
        recipient: params.recipient,
        refundTo: params.refundTo,
        slippageBps: params.slippageBps,
        confidentiality: params.confidentiality,
        mode,
        dryQuoteId: stored.id,
        accountKind: session.accountKind,
        intentsAccountId: session.intentsAccountId,
      },
      response: { ...execution },
      expiresAt: execution.expiresAt,
    });

    approvalId = await createApproval({
      quoteId: wetQuoteId,
      userId: session.userId,
      parameters: {
        action: body.action,
        mode,
        fromAssetId: params.fromAssetId,
        toAssetId: params.toAssetId,
        amount: params.amount,
        recipient: params.recipient,
        refundTo: params.refundTo,
        slippageBps: params.slippageBps,
        confidentiality: params.confidentiality,
        depositAddress: execution.depositAddress,
        depositMemo: execution.depositMemo ?? null,
        minAmountOut: execution.minAmountOut,
        minAmountOutRaw: execution.minAmountOutRaw,
        amountOut: execution.amountOut,
        amountOutFormatted: execution.amountOutFormatted,
        withdrawFee: execution.withdrawFee ?? null,
        withdrawFeeFormatted: execution.withdrawFeeFormatted ?? null,
        expiresAt: execution.expiresAt,
        accountKind: session.accountKind,
        intentsAccountId: session.intentsAccountId,
        standard,
      },
    });

    const tx = await createTransaction({
      userId: session.userId,
      approvalId,
      conversationId: body.conversationId ?? null,
      recipient: params.recipient,
      refundTo: params.refundTo,
      originAsset: params.fromAssetId,
      destinationAsset: params.toAssetId,
      amountIn: execution.amountInFormatted,
      expectedOut: execution.amountOutFormatted,
      depositAddress: execution.depositAddress,
      // The exact values the submit route will verify against. The payload is
      // added below once 1Click has minted it. The withdrawal destination is
      // stored from the quote params; no request field can supply it.
      refs: {
        dryQuoteId: stored.id,
        wetQuoteId,
        mode,
        standard,
        signerId: session.intentsAccountId,
        intentDepositAddress: execution.depositAddress,
        amountInRaw: execution.amountIn,
        deadline: execution.expiresAt,
        assetId: params.fromAssetId,
        destination: mode === "confidential-withdrawal" ? params.recipient : null,
        toolApprovalId: body.approvalId || null,
        conversationId: body.conversationId ?? null,
      },
      state: isSignedQuoteMode(mode) ? "awaiting_approval" : "submitted",
    });

    transactionId = tx.id;
    expectedOut = tx.expected_out ?? execution.amountOutFormatted;
  } catch {
    console.error("[intents/approve] record failed", { quoteId: stored.id });
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }

  if (!isSignedQuoteMode(mode)) {
    // An external deposit has no signed intent. The one-time address is the
    // whole approval, so the settlement reader starts now.
    try {
      const run = await start(swapLifecycle, [
        {
          transactionId,
          depositAddress: execution.depositAddress,
          expectedOut,
          mode,
        },
      ]);
      await setTransactionRunId(transactionId, run.runId);

      return NextResponse.json({
        transactionId,
        depositAddress: execution.depositAddress,
        depositMemo: execution.depositMemo ?? null,
        amountIn: execution.amountIn,
        expiresAt: execution.expiresAt,
        runId: run.runId,
      });
    } catch {
      console.error("[intents/approve] workflow start failed", {
        transactionId,
      });
      return NextResponse.json({ error: "An error occurred." }, { status: 500 });
    }
  }

  // The confidential balance path. The payload is the exact string (or NEP-413
  // object) the signer must sign; it is stored before the browser sees it so a
  // submit can only ever match this call's payload.
  let generated: Awaited<ReturnType<typeof generateIntent>>;
  try {
    generated = await generateIntent({
      type: "swap_transfer",
      standard,
      signerId: session.intentsAccountId,
      depositAddress: execution.depositAddress,
    });
  } catch {
    console.error("[intents/approve] generate-intent failed", { transactionId });
    try {
      await setTransactionState(transactionId, "failed");
      await addEvent(
        transactionId,
        "failed",
        "The signed intent could not be prepared.",
      );
    } catch {
      // The primary failure is already logged; the row is still not money.
    }
    return NextResponse.json({ error: "An error occurred." }, { status: 502 });
  }

  try {
    await updateTransactionRefs(transactionId, {
      intentPayload: generated.payload,
    });
  } catch {
    console.error("[intents/approve] refs update failed", { transactionId });
    try {
      await setTransactionState(transactionId, "failed");
      await addEvent(
        transactionId,
        "failed",
        "The signed intent could not be recorded.",
      );
    } catch {
      // The primary failure is already logged.
    }
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }

  return NextResponse.json({
    transactionId,
    depositAddress: execution.depositAddress,
    intent: {
      standard: generated.standard,
      payload: generated.payload,
    },
    // The destination is the server-rebuilt quote recipient, never a body
    // field. The card renders this value and never the confidential
    // deposit address the signed payload actually transfers to.
    ...(mode === "confidential-withdrawal"
      ? { destination: params.recipient }
      : {}),
    figures: {
      amountIn: execution.amountIn,
      amountInFormatted: execution.amountInFormatted,
      amountOut: execution.amountOut,
      amountOutFormatted: execution.amountOutFormatted,
      minAmountOut: execution.minAmountOut,
      minAmountOutRaw: execution.minAmountOutRaw,
      amountOutUsd: execution.amountOutUsd,
      rate: execution.rate,
      feeBps: execution.feeBps,
      ...(mode === "confidential-withdrawal"
        ? {
            withdrawFee: execution.withdrawFee,
            withdrawFeeFormatted: execution.withdrawFeeFormatted,
          }
        : {}),
    },
    expiresAt: execution.expiresAt,
  });
}
