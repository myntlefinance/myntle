import { NextResponse } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { swapLifecycle } from "@/workflows/swap-lifecycle";
import { requireSession } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import { verifyWalletSignature } from "@/lib/auth/signatures";
import {
  buildTradeApprovalMessage,
  isApprovalWindowValid,
} from "@/lib/trade/approval-message";
import { createExecutionQuote, getAssets } from "@/lib/intents/service";
import {
  isConfidentialStoredMode,
  passkeyWalletRouteGuard,
} from "@/lib/intents/route-policy";
import { evmChainForSlug } from "@/lib/wallet/evm-chains";
import { conversationIdForUser } from "@/lib/db/conversations";
import { getToolApproval, recordToolApproval } from "@/lib/db/tool-approvals";
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
  refundTo: z.string().min(1).optional(),
  slippageBps: z.number().int().min(1).max(300).default(100),
  /** Minimum accepted output, raw smallest-unit, as shown on the card. */
  minAmountOut: z.string().min(1),
  expiresAt: z.string().min(1),
  /** Card birth. Approvals older than the window are rejected. */
  requestedAt: z.string().min(1),
  /** Server-saved dry preview this approval must match. */
  quoteId: z.string().uuid(),
  /** The exact canonical message the wallet signed. */
  message: z.string().min(1).max(2000),
  signature: z.string().min(1).max(2000),
  publicKey: z.string().max(200).optional(),
  recipientField: z.string().max(200).optional(),
  nonce: z.string().max(128).optional(),
  txHash: z.string().optional(),
  conversationId: z.string().max(200).optional(),
  /** Tool approval id (aitxt-…), so the card can rejoin its row on reload. */
  approvalId: z.string().max(200).optional(),
});

/**
 * Signed approval → execution.
 *
 * The browser POST is an untrusted claim. The server-saved dry quote is
 * truth: every priced field must match it exactly, and the wet quote is
 * minted from the stored parameters, never from the body. A modified client
 * can neither move the parameters nor fabricate another account's approval.
 * The signature binds the addresses and the window; the stored quote binds
 * the figures.
 */
export async function POST(req: Request) {
  const { limited } = checkRateLimit(`approve:${clientIp(req)}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ error: "An error occurred." }, { status: 429 });
  }
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // A passkey account has no wallet to sign the canonical approval message.
  // Answer before the body, the quote, or a signature is touched.
  const passkeyGuard = passkeyWalletRouteGuard(session);
  if (passkeyGuard) {
    return NextResponse.json(passkeyGuard, { status: 400 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    console.error("[approve] invalid body");
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }

  // The card names the chat it belongs to. Resolve it here so the record is
  // never linked to someone else's conversation, and so a slug and a uuid
  // both work. An unknown chat costs the link, never the trade.
  const conversationId = body.conversationId
    ? await conversationIdForUser(session.userId, body.conversationId).catch(
        () => null,
      )
    : null;

  // A proposal refused in another tab, or on another device, stays refused.
  // This is answered before the quote, the signature, or any chain work.
  if (body.approvalId) {
    const decided = await getToolApproval(
      session.userId,
      body.approvalId,
    ).catch(() => null);
    if (decided?.decision === "denied") {
      return NextResponse.json(
        {
          error: "denied",
          message: "This proposal was rejected. Please ask for a new one.",
        },
        { status: 409 },
      );
    }
  }

  // The browser POST is a claim. The stored dry preview is truth: load
  // it first, and reject anything it does not cover before touching money.
  const { getQuote } = await import("@/lib/db/transactions");
  const stored = await getQuote(session.userId, body.quoteId);
  if (!stored) {
    console.error("[approve] unknown quote");
    return NextResponse.json(
      {
        error: "stale",
        message: "This quote is no longer on record. Please ask for a fresh quote.",
      },
      { status: 400 },
    );
  }
  if (Number.isNaN(Date.parse(stored.expires_at)) || Date.parse(stored.expires_at) <= Date.now()) {
    return NextResponse.json(
      {
        error: "expired",
        message: "Your approval has expired. Please try a fresh quote.",
      },
      { status: 409 },
    );
  }

  // A confidential quote belongs to the Intents account and must be settled by
  // the signed-intent route. Re-pricing it here as a chain trade would move
  // the money publicly and could pay the wrong recipient, so refuse before any
  // signature, chain switch, or quote work.
  const storedRequest = stored.request as Record<string, unknown>;
  if (isConfidentialStoredMode(storedRequest.mode)) {
    console.error("[approve] confidential quote on the direct route");
    return NextResponse.json(
      {
        error: "confidential",
        message:
          "This quote belongs to the confidential account. Use the confidential route.",
      },
      { status: 400 },
    );
  }

  const q = stored.request as Record<string, unknown>;
  const qr = stored.response as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : NaN);
  const storedParams = {
    fromAssetId: str(q.fromAssetId),
    toAssetId: str(q.toAssetId),
    amount: str(q.amount),
    recipient: str(q.recipient),
    refundTo: str(q.refundTo),
    slippageBps: num(q.slippageBps),
  };
  const storedFigures = {
    minAmountOutRaw: str(qr.minAmountOutRaw),
    expiresAt: str(qr.expiresAt),
  };
  // Refunds must be valid on the origin chain. The card defaults to the
  // connected wallet, which is also the session the signature is checked
  // against, so a silent wallet is still an explicit address.
  const claimedRefundTo = body.refundTo ?? session.address;
  const { isApprovalClaimMatchingQuote } = await import(
    "@/lib/trade/approval-check"
  );
  const matchesStored = isApprovalClaimMatchingQuote(
    {
      fromAssetId: body.fromAssetId,
      toAssetId: body.toAssetId,
      amount: body.amount,
      recipient: body.recipient,
      refundTo: claimedRefundTo,
      slippageBps: body.slippageBps,
      minAmountOut: body.minAmountOut,
      expiresAt: body.expiresAt,
    },
    {
      fromAssetId: storedParams.fromAssetId,
      toAssetId: storedParams.toAssetId,
      amount: storedParams.amount,
      recipient: storedParams.recipient,
      refundTo: storedParams.refundTo,
      slippageBps: storedParams.slippageBps,
      minAmountOutRaw: storedFigures.minAmountOutRaw,
      expiresAt: storedFigures.expiresAt,
    },
  );
  if (!matchesStored) {
    console.error("[approve] browser params differ from stored quote");
    return NextResponse.json(
      {
        error: "stale",
        message: "The trade changed since it was priced. Please ask for a fresh quote.",
      },
      { status: 400 },
    );
  }

  // The message must be the canonical binding of the stored parameters,
  // so a signature lifted from another trade or another app is rejected.
  // The card birth stays a browser claim, window-checked below.
  const expected = buildTradeApprovalMessage({
    fromAssetId: storedParams.fromAssetId,
    toAssetId: storedParams.toAssetId,
    amount: storedParams.amount,
    recipient: storedParams.recipient,
    refundTo: storedParams.refundTo,
    slippageBps: storedParams.slippageBps,
    minAmountOut: storedFigures.minAmountOutRaw,
    expiresAt: storedFigures.expiresAt,
    requestedAt: body.requestedAt,
  });
  if (body.message !== expected) {
    console.error("[approve] approval message mismatch");
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }

  // The approval window is bound by the signature: a stale card cannot be
  // approved late, even by its own owner replaying the request.
  if (!isApprovalWindowValid(body.requestedAt)) {
    return NextResponse.json(
      {
        error: "expired",
        message: "Your approval has expired. Please try a fresh quote.",
      },
      { status: 409 },
    );
  }

  // A signature on an expired quote authorises nothing.
  if (Number.isNaN(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now()) {
    return NextResponse.json(
      { error: "price-moved", message: "Your approval has expired. Please try a fresh quote." },
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
  } catch (err) {
    // A signature from another account means the wallet changed since
    // sign-in (account switch, silent reconnect). Say so plainly: retrying
    // the same signature can never succeed, reconnecting can.
    if (err instanceof Error && err.message === "evm-mismatch") {
      console.error("[approve] wallet changed since sign-in", {
        chain: session.chain,
      });
      return NextResponse.json(
        {
          error: "wallet-changed",
          message:
            "Your connected wallet changed since signing in. Please reconnect, then approve again.",
        },
        { status: 401 },
      );
    }
    console.error("[approve] signature verification failed", {
      chain: session.chain,
    });
    return NextResponse.json({ error: "An error occurred." }, { status: 401 });
  }

  let execution: Awaited<ReturnType<typeof createExecutionQuote>>;
  try {
    // The wet quote is minted from the stored preview, never from the
    // browser body. The two were just proven equal, so this is the trade
    // the wallet signed and the server priced — nothing else.
    execution = await createExecutionQuote({
      fromAssetId: storedParams.fromAssetId,
      toAssetId: storedParams.toAssetId,
      amount: storedParams.amount,
      recipient: storedParams.recipient,
      refundTo: storedParams.refundTo,
      slippageBps: storedParams.slippageBps,
      confidentiality:
        q.confidentiality === "public" || q.confidentiality === "advanced"
          ? q.confidentiality
          : "basic",
    });
  } catch (err) {
    console.error(
      "[approve] execution quote failed",
      err instanceof Error ? err.message.slice(0, 200) : "unknown",
    );
    return NextResponse.json({ error: "An error occurred." }, { status: 502 });
  }

  // The fresh quote must cover what the server priced and the wallet
  // signed. Otherwise the card shows the new figures and the user decides
  // again — never auto-accepted.
  try {
    if (BigInt(execution.minAmountOutRaw) < BigInt(storedFigures.minAmountOutRaw)) {
      return NextResponse.json(
        {
          error: "price-moved",
          message: "The price has moved. Please review and resubmit.",
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
    console.error("[approve] invalid minimum comparison");
    return NextResponse.json({ error: "An error occurred." }, { status: 502 });
  }

  const parameters = {
    fromAssetId: storedParams.fromAssetId,
    toAssetId: storedParams.toAssetId,
    amount: storedParams.amount,
    recipient: storedParams.recipient,
    refundTo: storedParams.refundTo,
    slippageBps: storedParams.slippageBps,
    depositAddress: execution.depositAddress,
    minAmountOut: execution.minAmountOut,
    expiresAt: execution.expiresAt,
  };

  try {
    // The wet execution is recorded as its own quote row; the approval
    // links to it, while body.quoteId remains the dry preview it matched.
    const wetQuoteId = await createQuote({
      userId: session.userId,
      conversationId,
      request: {
        fromAssetId: storedParams.fromAssetId,
        toAssetId: storedParams.toAssetId,
        amount: storedParams.amount,
        recipient: storedParams.recipient,
        refundTo: storedParams.refundTo,
        slippageBps: storedParams.slippageBps,
        dryQuoteId: body.quoteId,
      },
      response: { ...execution },
      expiresAt: execution.expiresAt,
    });
    const approvalId = await createApproval({
      quoteId: wetQuoteId,
      userId: session.userId,
      parameters,
    });
    const tx = await createTransaction({
      userId: session.userId,
      approvalId,
      conversationId,
      recipient: storedParams.recipient,
      refundTo: storedParams.refundTo,
      originAsset: storedParams.fromAssetId,
      destinationAsset: storedParams.toAssetId,
      amountIn: execution.amountInFormatted,
      expectedOut: execution.amountOutFormatted,
      depositAddress: execution.depositAddress,
      toolApprovalId: body.approvalId ?? null,
      refs: { txHash: body.txHash ?? null, toolApprovalId: body.approvalId ?? null },
    });

    // The approval is only real once a record exists, so it is written here
    // rather than when the button was pressed. A failure costs the decision
    // row, never the trade: the card still rejoins through the transaction.
    if (body.approvalId) {
      try {
        await recordToolApproval({
          userId: session.userId,
          toolApprovalId: body.approvalId,
          toolName: "prepare_swap",
          decision: "approved",
          conversationId,
          quoteId: body.quoteId,
          requestedAt: body.requestedAt,
        });
      } catch {
        console.error("[approve] decision record failed", {
          transactionId: tx.id,
        });
      }
    }

    const run = await start(swapLifecycle, [
      {
        transactionId: tx.id,
        depositAddress: execution.depositAddress,
        txHash: body.txHash,
        expectedOut: execution.amountOutFormatted,
      },
    ]);
    await setTransactionRunId(tx.id, run.runId);

    const catalogue = await getAssets().catch(() => []);
    const originMeta = catalogue.find((a) => a.assetId === storedParams.fromAssetId);
    // The wallet funds the deposit on the quote's origin chain. The card
    // switches to it before sending, so a quote on Arbitrum never executes
    // on whatever network the wallet happens to be on.
    const originChain = evmChainForSlug(originMeta?.chain);
    return NextResponse.json({
      transactionId: tx.id,
      depositAddress: execution.depositAddress,
      depositMemo: execution.depositMemo ?? null,
      amountIn: execution.amountIn,
      tokenContract: originMeta?.contractAddress ?? null,
      originChain: originMeta?.chain ?? session.chain,
      originChainId: originChain?.id ?? null,
      originChainName: originChain?.name ?? null,
      runId: run.runId,
    });
  } catch (err) {
    console.error(
      "[approve] record or workflow start failed",
      err instanceof Error ? err.message.slice(0, 200) : "unknown",
    );
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
