import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { z } from "zod";
import { limitOrderLifecycle } from "@/workflows/limit-order-lifecycle";
import { requireSession } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import { generateIntent, getAssets, type Asset } from "@/lib/intents/service";
import { standardForSession } from "@/lib/intents/route-policy";
import {
  createLimitOrder,
  deadlineFromIntentPayload,
  limitOrderRefsView,
  readStoredLimitOrderQuote,
  type LimitOrderView,
} from "@/lib/intents/orders";
import type { DepositMetadata } from "@/lib/intents/deposit-metadata";
import { normalizeEvmAddress } from "@/lib/intents/destination";
import { formatUnits } from "@/lib/intents/balances";
import { evmChainForSlug } from "@/lib/wallet/evm-chains";
import { conversationIdForUser } from "@/lib/db/conversations";
import {
  getToolApproval,
  recordToolApproval,
} from "@/lib/db/tool-approvals";
import {
  addEvent,
  createApproval,
  createTransaction,
  getQuote,
  listLimitOrderTransactions,
  setTransactionRunId,
  setTransactionState,
  updateTransactionRefs,
} from "@/lib/db/transactions";

/**
 * The limit-order route.
 *
 * The browser names a quote and, optionally, the card it answers. Every priced
 * value is rebuilt from the stored quote row: the pair, the side, the
 * quantity, the price, the funding account, and the recipient. A modified
 * client cannot move a figure between pricing and approval.
 *
 * Account funding creates the order, asks 1Click for the exact intent payload,
 * and stops at `awaiting_approval`; the signed intent is submitted through
 * `/api/intents/submit`, which then starts the order workflow. Wallet funding
 * creates the order and starts the workflow at once, because the user funds
 * the returned address directly.
 */

const ORDER_ERROR = "An error occurred.";
const ORDER_REJECTED = "This proposal was rejected. Please ask for a new one.";
const ORDER_UNAVAILABLE =
  "The limit order could not be created. Please try again.";

const orderBodySchema = z.strictObject({
  quoteId: z.string().uuid(),
  /** Tool approval id (aitxt-…), so a reload can rejoin the record. */
  approvalId: z.string().max(200).nullish(),
  /** A chat slug or uuid; the route resolves and authorizes it. */
  conversationId: z.string().max(200).nullish(),
});

const MAX_LIMIT_ORDERS = 10;

/** The QR and transfer facts the card needs after an order is created. */
function depositMetadataFor(
  order: LimitOrderView,
  asset: Asset | undefined,
  amountInRaw: string,
  expiresAt: string,
): DepositMetadata {
  const chain = asset ? evmChainForSlug(asset.chain) : null;
  return {
    address: order.depositAddress,
    memo: order.depositMemo ?? null,
    expiresAt,
    amountInRaw,
    tokenContract: asset?.contractAddress || null,
    chainId: chain?.id ?? null,
    chainName: chain?.name ?? null,
    chainSlug: asset?.chain || null,
    decimals: asset?.decimals ?? null,
    symbol: asset?.symbol || null,
  };
}

/** Whether an asset lives on the chain family the session signed in with. */
function onSessionChain(chain: string, sessionChain: string): boolean {
  if (sessionChain === "evm") return evmChainForSlug(chain) !== null;
  if (sessionChain === "solana") return chain === "sol";
  if (sessionChain === "near") return chain === "near";
  return false;
}

export async function POST(req: Request) {
  const { limited } = checkRateLimit(
    `orders-create:${clientIp(req)}`,
    10,
    60_000,
  );
  if (limited) {
    return NextResponse.json({ error: ORDER_ERROR }, { status: 429 });
  }

  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: z.infer<typeof orderBodySchema>;
  try {
    body = orderBodySchema.parse(await req.json());
  } catch {
    console.error("[orders] invalid body");
    return NextResponse.json({ error: ORDER_ERROR }, { status: 400 });
  }

  const toolApprovalId = body.approvalId ?? null;

  // The chat link, the refusal record, the stored quote, and the catalogue
  // are four independent reads. Starting them together keeps the create call
  // waiting on the slowest rather than on their sum.
  const [conversationId, decided, stored, catalogue] = await Promise.all([
    body.conversationId
      ? conversationIdForUser(session.userId, body.conversationId).catch(
          () => null,
        )
      : Promise.resolve(null),
    toolApprovalId
      ? getToolApproval(session.userId, toolApprovalId).catch(() => null)
      : Promise.resolve(null),
    getQuote(session.userId, body.quoteId),
    getAssets()
      .then((assets) => assets)
      .catch((): Asset[] => []),
  ]);

  // A proposal refused in another tab, or on another device, stays refused.
  // Answered before the order is created.
  if (decided?.decision === "denied") {
    return NextResponse.json(
      { error: "denied", message: ORDER_REJECTED },
      { status: 409 },
    );
  }

  if (!stored) {
    console.error("[orders] unknown quote", { quoteId: body.quoteId });
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
      { error: "expired", message: "The quote expired. Ask for a new one." },
      { status: 409 },
    );
  }

  const parsed = readStoredLimitOrderQuote(stored, {
    accountKind: session.accountKind,
    intentsAccountId: session.intentsAccountId,
  });
  if (!parsed.ok) {
    console.error("[orders] stored quote rejected", {
      quoteId: stored.id,
      reason: parsed.reason,
    });
    return NextResponse.json(
      {
        error: "stale",
        message:
          "The quote was priced for a different account. Please ask for a fresh quote.",
      },
      { status: 400 },
    );
  }
  const quote = parsed.quote;

  if (quote.funding === "wallet") {
    if (session.accountKind === "passkey") {
      return NextResponse.json(
        {
          error: "funding",
          message:
            "This account has no wallet. Place the order from the Near Account.",
        },
        { status: 400 },
      );
    }
    // The quote tool checked this when it priced the order. Re-checking at
    // creation keeps a stored row from outliving a catalogue change.
    const inputAsset = catalogue.find(
      (asset) => asset.assetId === quote.inputAssetId,
    );
    const outputAsset = catalogue.find(
      (asset) => asset.assetId === quote.outputAssetId,
    );
    if (
      (inputAsset && !onSessionChain(inputAsset.chain, session.chain)) ||
      (outputAsset && !onSessionChain(outputAsset.chain, session.chain))
    ) {
      return NextResponse.json(
        {
          error: "funding",
          message:
            "This order cannot be funded from the connected wallet's chain. Place the order from the Near Account instead.",
        },
        { status: 400 },
      );
    }
  } else if (!session.intentsAccountId) {
    return NextResponse.json(
      {
        error: "funding",
        message: "The account is not available. Sign in again before placing an order.",
      },
      { status: 400 },
    );
  }

  const funding = quote.funding;
  const depositType =
    funding === "account" ? "CONFIDENTIAL_INTENTS" : "ORIGIN_CHAIN";
  const recipientType =
    funding === "account" ? "CONFIDENTIAL_INTENTS" : "DESTINATION_CHAIN";
  const refundType =
    funding === "account" ? "CONFIDENTIAL_INTENTS" : "ORIGIN_CHAIN";
  const recipient =
    funding === "account"
      ? session.intentsAccountId
      : (normalizeEvmAddress(session.address) ?? session.address);
  const refundTo = recipient;
  const standard = standardForSession(session);

  let order: LimitOrderView;
  try {
    order = await createLimitOrder({
      baseAsset: quote.baseAssetId,
      quoteAsset: quote.quoteAssetId,
      side: quote.side,
      quantity: quote.quantity,
      price: quote.price,
      depositType,
      recipient,
      recipientType,
      refundTo,
      refundType,
      confidentiality: "basic",
    });
  } catch {
    return NextResponse.json(
      { error: ORDER_UNAVAILABLE },
      { status: 502 },
    );
  }

  // The order's own deadline is the funding and expiry clock. A quote
  // deadline is fifteen minutes and must never become the order's deadline.
  const deadline = order.deadline ?? quote.deadline;

  // The created order's own swap view is the authority on what to send: the
  // intent is generated against the order, not against our preview. A view
  // that names a different pair is refused before a transfer can be signed;
  // an unfunded order expires on its own.
  if (
    order.swapView.originAsset !== quote.inputAssetId ||
    order.swapView.destinationAsset !== quote.outputAssetId
  ) {
    console.error("[orders] created order does not match the quote");
    return NextResponse.json({ error: ORDER_UNAVAILABLE }, { status: 502 });
  }
  const orderInputRaw =
    order.swapView.swapType === "EXACT_INPUT"
      ? order.swapView.amountIn
      : order.swapView.maxAmountIn;
  const orderOutputRaw =
    order.swapView.swapType === "EXACT_INPUT"
      ? order.swapView.minAmountOut
      : order.swapView.amountOut;
  const inputAsset = catalogue.find(
    (asset) => asset.assetId === order.swapView.originAsset,
  );
  const outputAsset = catalogue.find(
    (asset) => asset.assetId === order.swapView.destinationAsset,
  );

  // The record's display figures come from the order's own smallest-unit
  // amounts. The quote's formatted strings remain the fallback when the
  // catalogue is cold, so the record is never blank.
  const amountIn = inputAsset
    ? formatUnits(orderInputRaw, inputAsset.decimals)
    : quote.side === "SELL"
      ? quote.quantityFormatted
      : quote.totalFormatted;
  const expectedOut = outputAsset
    ? formatUnits(orderOutputRaw, outputAsset.decimals)
    : quote.side === "SELL"
      ? quote.totalFormatted
      : quote.quantityFormatted;

  const state = funding === "wallet" ? "submitted" : "awaiting_approval";
  let transactionId: string;

  try {
    const approvalId = await createApproval({
      quoteId: stored.id,
      userId: session.userId,
      parameters: {
        kind: "limit_order",
        action: "limit_order",
        side: quote.side,
        baseAsset: quote.baseAssetId,
        quoteAsset: quote.quoteAssetId,
        quantity: quote.quantity,
        price: quote.price,
        funding,
        depositType,
        recipient,
        recipientType,
        refundTo,
        refundType,
        baseSymbol: quote.baseSymbol,
        quoteSymbol: quote.quoteSymbol,
        inputAssetId: quote.inputAssetId,
        outputAssetId: quote.outputAssetId,
        inputAmount: orderInputRaw,
        outputAmount: orderOutputRaw,
        orderId: order.orderId,
        depositAddress: order.depositAddress,
        depositMemo: order.depositMemo ?? null,
        deadline,
        // The funding/settlement display clock, kept apart from the signed
        // payload's deadline below. The order can rest for days; the intent
        // only needs to be signed inside its own window.
        orderDeadline: order.deadline ?? deadline,
        accountKind: session.accountKind,
        intentsAccountId: session.intentsAccountId,
        standard,
        toolApprovalId,
      },
    });

    const tx = await createTransaction({
      userId: session.userId,
      approvalId,
      conversationId,
      recipient,
      refundTo,
      originAsset: quote.inputAssetId,
      destinationAsset: quote.outputAssetId,
      amountIn,
      expectedOut,
      depositAddress: order.depositAddress,
      toolApprovalId,
      refs: {
        kind: "limit_order",
        orderId: order.orderId,
        // The submit route verifies a transfer to the order's deposit
        // address, in the input asset, for the input amount.
        mode: "confidential-intents",
        standard,
        signerId: session.intentsAccountId,
        intentDepositAddress: order.depositAddress,
        amountInRaw: orderInputRaw,
        assetId: order.swapView.originAsset,
        deadline,
        // The funding/settlement display clock, kept apart from the signed
        // payload's deadline: the order can rest for days while the intent
        // only needs to be signed inside its own window.
        orderDeadline: order.deadline ?? deadline,
        side: quote.side,
        baseAsset: quote.baseAssetId,
        quoteAsset: quote.quoteAssetId,
        quantity: quote.quantity,
        price: quote.price,
        depositType,
        swapView: order.swapView,
        fillStatus: order.fillStatus,
        payoutStatus: order.payoutStatus,
        isPayoutStatusFinal: order.isPayoutStatusFinal,
        toolApprovalId,
        toolName: "prepare_limit_order",
        dryQuoteId: stored.id,
        conversationId,
      },
      state,
    });

    transactionId = tx.id;
  } catch {
    console.error("[orders] record failed", { quoteId: stored.id });
    return NextResponse.json({ error: ORDER_ERROR }, { status: 500 });
  }

  // A wallet-funded order is funded directly, so the order's creation is the
  // decision. An account-funded order still needs its signed intent; the
  // submit route records that decision only after the assertion is verified,
  // so a cancelled prompt leaves the card retryable.
  if (toolApprovalId && funding === "wallet") {
    try {
      await recordToolApproval({
        userId: session.userId,
        toolApprovalId,
        toolName: "prepare_limit_order",
        decision: "approved",
        conversationId,
        quoteId: stored.id,
      });
    } catch {
      console.error("[orders] decision record failed", { transactionId });
    }
  }

  const deposit = depositMetadataFor(
    order,
    inputAsset,
    orderInputRaw,
    deadline,
  );

  if (funding === "account") {
    let generated: Awaited<ReturnType<typeof generateIntent>>;
    try {
      generated = await generateIntent({
        type: "swap_transfer",
        standard,
        signerId: session.intentsAccountId,
        depositAddress: order.depositAddress,
      });
    } catch {
      console.error("[orders] generate-intent failed", { transactionId });
      try {
        await setTransactionState(transactionId, "failed");
        await addEvent(
          transactionId,
          "failed",
          "The signed intent could not be prepared.",
        );
      } catch {
        // The primary failure is already logged.
      }
      return NextResponse.json({ error: ORDER_ERROR }, { status: 502 });
    }

    // The payload's deadline is the one the verifier will compare, because
    // `generate-intent` mints the payload and its deadline together. Storing
    // the payload's own instant keeps the assertion check exact.
    const payloadDeadline = deadlineFromIntentPayload(generated.payload);
    try {
      await updateTransactionRefs(transactionId, {
        intentPayload: generated.payload,
        ...(payloadDeadline ? { deadline: payloadDeadline } : {}),
      });
    } catch {
      console.error("[orders] refs update failed", { transactionId });
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
      return NextResponse.json({ error: ORDER_ERROR }, { status: 500 });
    }

    return NextResponse.json({
      transactionId,
      depositAddress: order.depositAddress,
      depositMemo: order.depositMemo ?? null,
      order,
      intent: { standard: generated.standard, payload: generated.payload },
      deposit,
    });
  }

  try {
    const run = await start(limitOrderLifecycle, [
      { transactionId, orderId: order.orderId },
    ]);
    await setTransactionRunId(transactionId, run.runId);
    return NextResponse.json({
      transactionId,
      depositAddress: order.depositAddress,
      depositMemo: order.depositMemo ?? null,
      order,
      deposit,
      runId: run.runId,
    });
  } catch {
    console.error("[orders] workflow start failed", { transactionId });
    return NextResponse.json({ error: ORDER_ERROR }, { status: 500 });
  }
}

/**
 * The account's limit orders, read from the record.
 *
 * The list never asks 1Click: a card refresh is bounded to one order and goes
 * through `/api/orders/[id]`, while this list is the stored timeline.
 */
export async function GET(req: Request) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const rows = await listLimitOrderTransactions(
      session.userId,
      MAX_LIMIT_ORDERS,
    );
    return NextResponse.json({
      orders: rows.map((row) => ({
        id: row.id,
        state: row.state,
        ...limitOrderRefsView(row.refs),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch {
    console.error("[orders] list failed");
    return NextResponse.json({ error: ORDER_ERROR }, { status: 500 });
  }
}
