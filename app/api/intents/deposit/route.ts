import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { z } from "zod";
import { swapLifecycle } from "@/workflows/swap-lifecycle";
import { requireSession } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import {
  createExecutionQuote,
  getAssets,
  type Asset,
} from "@/lib/intents/service";
import { evmChainForSlug } from "@/lib/wallet/evm-chains";
import { conversationIdForUser } from "@/lib/db/conversations";
import { getToolApproval, recordToolApproval } from "@/lib/db/tool-approvals";
import {
  createApproval,
  createQuote,
  createTransaction,
  setTransactionRunId,
  setTransactionState,
} from "@/lib/db/transactions";

/**
 * An external deposit into the account.
 *
 * There is no stored dry quote to rebuild here: the user asks to fund the
 * account with one asset and one amount, and the card shows the exact
 * one-time address the wet quote returns. The asset is checked against the
 * live catalogue and the amount must be a positive integer in the smallest
 * unit, so a malformed body cannot ask 1Click to price an arbitrary string.
 *
 * The recipient and refund are the session's Intents account, never the
 * browser body. There is no signed intent and no passkey prompt: the sender
 * is an exchange or another wallet, and the settlement reader starts
 * immediately so the status poll is already waiting when the funds arrive.
 */

const DEPOSIT_ERROR = "An error occurred.";
const DEPOSIT_UNAVAILABLE = "The deposit could not be prepared. Please try again.";
const DEPOSIT_REJECTED = "This proposal was rejected. Please ask for a new one.";

const depositBodySchema = z.strictObject({
  assetId: z.string().min(1).max(300),
  /** Smallest unit, positive integer, no decimals or sign. */
  amount: z.string().regex(/^[1-9]\d{0,77}$/),
  /** A chat slug or uuid; the route resolves and authorizes it. */
  conversationId: z.string().max(200).nullish(),
  /** Tool approval id (aitxt-…), so the card can rejoin the record. */
  approvalId: z.string().max(200).nullish(),
});

export async function POST(req: Request) {
  const { limited } = checkRateLimit(
    `intents-deposit:${clientIp(req)}`,
    10,
    60_000,
  );
  if (limited) {
    return NextResponse.json({ error: DEPOSIT_ERROR }, { status: 429 });
  }

  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: z.infer<typeof depositBodySchema>;
  try {
    body = depositBodySchema.parse(await req.json());
  } catch {
    console.error("[intents/deposit] invalid body");
    return NextResponse.json({ error: DEPOSIT_ERROR }, { status: 400 });
  }

  // The chat link, the refusal record, and the asset catalogue are three
  // independent reads. Starting them together keeps the mint waiting on the
  // slowest rather than on their sum; the quote below still accounts for most
  // of the wall clock, and that is 1Click's own address generation.
  const startedAt = Date.now();
  const [conversationId, decided, catalogue] = await Promise.all([
    body.conversationId
      ? conversationIdForUser(session.userId, body.conversationId).catch(
          () => null,
        )
      : Promise.resolve(null),
    body.approvalId
      ? getToolApproval(session.userId, body.approvalId).catch(() => null)
      : Promise.resolve(null),
    getAssets()
      .then((assets) => ({ assets }))
      .catch(() => null),
  ]);

  // A proposal refused in another tab, or on another device, stays refused.
  // Answered before an address is minted.
  if (decided?.decision === "denied") {
    return NextResponse.json(
      {
        error: "denied",
        message: DEPOSIT_REJECTED,
      },
      { status: 409 },
    );
  }

  // The catalogue is the authority on which assets can be priced. An id that
  // is not in it is a malformed request, not a quote to attempt.
  if (!catalogue) {
    console.error("[intents/deposit] asset catalogue unavailable");
    return NextResponse.json({ error: DEPOSIT_UNAVAILABLE }, { status: 502 });
  }
  const asset: Asset | undefined = catalogue.assets.find(
    (entry) => entry.assetId === body.assetId,
  );
  if (!asset) {
    console.error("[intents/deposit] unknown asset");
    return NextResponse.json({ error: DEPOSIT_ERROR }, { status: 400 });
  }

  const quoteStartedAt = Date.now();
  let execution: Awaited<ReturnType<typeof createExecutionQuote>>;
  try {
    execution = await createExecutionQuote({
      fromAssetId: body.assetId,
      toAssetId: body.assetId,
      amount: body.amount,
      recipient: session.intentsAccountId,
      refundTo: session.intentsAccountId,
      mode: "confidential-external",
      confidentiality: "basic",
      // P0.6 describes an external deposit as a passive funding route, where
      // the sender chooses the amount. The exact-input default is for swaps.
      swapType: "FLEX_INPUT",
    });
  } catch {
    console.error("[intents/deposit] execution quote failed");
    return NextResponse.json({ error: DEPOSIT_UNAVAILABLE }, { status: 502 });
  }
  const quoteMs = Date.now() - quoteStartedAt;

  let wetQuoteId: string;
  let approvalId: string;
  let transactionId: string;
  let expectedOut: string;
  // What the address needs in order to be funded again after a reload: the
  // exact token, chain, raw amount, and deadline the quote priced. It is
  // stored with the record so the card never has to re-quote to draw the QR.
  const originChain = evmChainForSlug(asset.chain);
  const deposit = {
    depositAddress: execution.depositAddress,
    depositMemo: execution.depositMemo ?? null,
    expiresAt: execution.expiresAt,
    amountInRaw: execution.amountIn || body.amount,
    tokenContract: asset.contractAddress || null,
    chainId: originChain?.id ?? null,
    chainName: originChain?.name ?? null,
    chainSlug: asset.chain || null,
    decimals: asset.decimals ?? null,
    symbol: asset.symbol || null,
  };

  try {
    wetQuoteId = await createQuote({
      userId: session.userId,
      conversationId,
      request: {
        assetId: body.assetId,
        amount: body.amount,
        mode: "confidential-external",
        swapType: "FLEX_INPUT",
        accountKind: session.accountKind,
        intentsAccountId: session.intentsAccountId,
        recipient: session.intentsAccountId,
        refundTo: session.intentsAccountId,
        confidentiality: "basic",
        toolApprovalId: body.approvalId ?? null,
      },
      response: { ...execution },
      expiresAt: execution.expiresAt,
    });

    approvalId = await createApproval({
      quoteId: wetQuoteId,
      userId: session.userId,
      parameters: {
        action: "deposit",
        mode: "confidential-external",
        assetId: body.assetId,
        amount: body.amount,
        recipient: session.intentsAccountId,
        refundTo: session.intentsAccountId,
        amountIn: execution.amountIn,
        amountOut: execution.amountOut,
        accountKind: session.accountKind,
        intentsAccountId: session.intentsAccountId,
        toolApprovalId: body.approvalId ?? null,
        ...deposit,
      },
    });

    const tx = await createTransaction({
      userId: session.userId,
      approvalId,
      conversationId,
      recipient: session.intentsAccountId,
      refundTo: session.intentsAccountId,
      originAsset: body.assetId,
      destinationAsset: body.assetId,
      amountIn: execution.amountInFormatted,
      expectedOut: execution.amountOutFormatted,
      depositAddress: execution.depositAddress,
      toolApprovalId: body.approvalId ?? null,
      refs: {
        mode: "confidential-external",
        assetId: body.assetId,
        amount: body.amount,
        approvalId: body.approvalId ?? null,
        conversationId,
        // The settlement reader joins on this key, exactly as the signed
        // path does, so a reloaded conversation can still find the deposit.
        toolApprovalId: body.approvalId ?? null,
        ...deposit,
      },
      state: "submitted",
    });

    // The address was minted and recorded, so the approval is real now. The
    // returned row is the verdict, not the write: a denial that won the race
    // between the pre-check and this insert refuses the deposit even though
    // the address exists, so no settlement reader starts for it. A write that
    // throws or returns null is not a denial: the transaction is the stronger
    // fact, and the deny route guards it from here.
    let refused = false;
    if (body.approvalId) {
      try {
        const recorded = await recordToolApproval({
          userId: session.userId,
          toolApprovalId: body.approvalId,
          toolName: "prepare_deposit",
          decision: "approved",
          conversationId,
          quoteId: wetQuoteId,
        });
        refused = recorded?.decision === "denied";
      } catch {
        console.error("[intents/deposit] decision record failed", {
          transactionId: tx.id,
        });
      }
    }

    if (refused) {
      // The row exists but must never look fundable: it is closed as failed
      // and left without a workflow. A failed state write is logged, because
      // the refusal is still the answer the caller needs.
      try {
        await setTransactionState(tx.id, "failed", {
          error: "denied-after-mint",
        });
      } catch {
        console.error("[intents/deposit] refusal state write failed", {
          transactionId: tx.id,
        });
      }
      return NextResponse.json(
        { error: "denied", message: DEPOSIT_REJECTED },
        { status: 409 },
      );
    }

    transactionId = tx.id;
    expectedOut = tx.expected_out ?? execution.amountOutFormatted;
  } catch {
    console.error("[intents/deposit] record failed");
    return NextResponse.json({ error: DEPOSIT_ERROR }, { status: 500 });
  }

  try {
    const run = await start(swapLifecycle, [
      {
        transactionId,
        depositAddress: execution.depositAddress,
        expectedOut,
      },
    ]);
    await setTransactionRunId(transactionId, run.runId);

    // The address is minted by 1Click; everything after it is our record.
    // Log only a genuinely slow mint, with the split that explains it, so a
    // later report of "slow" names the stage instead of guessing.
    const totalMs = Date.now() - startedAt;
    if (totalMs > 4_000) {
      console.warn(
        `[intents/deposit] slow mint (${totalMs}ms total, ${quoteMs}ms quote)`,
      );
    }

    return NextResponse.json({
      transactionId,
      ...deposit,
      amountIn: execution.amountIn,
      runId: run.runId,
    });
  } catch {
    console.error("[intents/deposit] workflow start failed", { transactionId });
    return NextResponse.json({ error: DEPOSIT_ERROR }, { status: 500 });
  }
}
