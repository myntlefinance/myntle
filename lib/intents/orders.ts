/**
 * The limit-order desk.
 *
 * A 1Click limit order is a JSON:API resource: the create body is a
 * `data.type = "orders"` envelope, and every response is
 * `{ data: { id, attributes } }`. Everything here is server-only. The partner
 * key travels through the same header helper the quote path uses, and neither
 * a request body nor a response body is ever logged.
 *
 * The pure helpers at the bottom are the single source of truth shared by the
 * quote tool, the routes, and the durable workflow: the quote-side amount, the
 * order-to-transaction state table, and the outcome a reader sees.
 */

import { oneClickHeaders } from "./service";
import type { TxState } from "@/lib/db/transactions";

const BASE =
  process.env.NEXT_PUBLIC_ONE_CLICK_BASE_URL ?? "https://1click.chaindefuser.com";

export type LimitOrderSide = "BUY" | "SELL";
export type LimitOrderDepositType =
  | "ORIGIN_CHAIN"
  | "INTENTS"
  | "CONFIDENTIAL_INTENTS";

export type LimitOrderSwapView =
  | {
      swapType: "EXACT_INPUT";
      originAsset: string;
      destinationAsset: string;
      amountIn: string;
      minAmountOut: string;
    }
  | {
      swapType: "EXACT_OUTPUT";
      originAsset: string;
      destinationAsset: string;
      maxAmountIn: string;
      amountOut: string;
    };

export type LimitOrderView = {
  orderId: string;
  side: LimitOrderSide;
  baseAsset: string;
  quoteAsset: string;
  quantity: string;
  price: string;
  depositAddress: string;
  depositMemo?: string | null;
  depositType: LimitOrderDepositType;
  swapView: LimitOrderSwapView;
  fillStatus: string;
  payoutStatus: string;
  isPayoutStatusFinal: boolean;
  depositedAmount?: string;
  depositedAmountFormatted?: string;
  partialFills: Array<{
    id: string;
    amountIn: string;
    amountOut: string;
    createdAt: string;
    updatedAt: string;
  }>;
  payouts?: Record<string, unknown>;
  recipient: string;
  recipientType: string;
  refundTo: string;
  refundType: string;
  confidentiality: string;
  deadline?: string;
  createdAt?: string;
  estimatedWithdrawFee?: string;
  estimatedWithdrawFeeFormatted?: string;
  estimatedRefundFee?: string;
  estimatedRefundFeeFormatted?: string;
};

export type CreateLimitOrderInput = {
  baseAsset: string;
  quoteAsset: string;
  side: LimitOrderSide;
  quantity: string;
  price: string;
  depositType: LimitOrderDepositType;
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
  confidentiality: "basic" | "advanced";
  deadline?: string;
};

/* ------------------------------------------------------------------ */
/* error handling                                                      */
/* ------------------------------------------------------------------ */

const CREATE_ERROR = "The limit order could not be created. Please try again.";
const GET_ERROR = "The limit order could not be read. Please try again.";
const CANCEL_ERROR = "The limit order could not be cancelled. Please try again.";
const LIST_ERROR = "The limit orders could not be read. Please try again.";

/**
 * Reads only a short error code from a failed 1Click response.
 *
 * The status and a stable JSON:API code such as `order-rejected` are enough to
 * diagnose the call. The response body, the request, and the partner key are
 * never logged: a validation detail can echo a field, and an order body is
 * money-moving material.
 */
async function logOrderFailure(operation: string, res: Response): Promise<void> {
  let code = "http";
  try {
    const body = (await res.json()) as {
      errors?: Array<{ code?: unknown }>;
      code?: unknown;
      error?: unknown;
    };
    const first = Array.isArray(body.errors) ? body.errors[0] : undefined;
    const candidate =
      typeof first?.code === "string"
        ? first.code
        : typeof body.code === "string"
          ? body.code
          : typeof body.error === "string"
            ? body.error
            : "";
    if (candidate) code = candidate.slice(0, 40);
  } catch {
    // Not JSON; the status is enough.
  }
  console.error(
    `[intents/orders] ${operation} failed (HTTP ${res.status}, ${code})`,
  );
}

async function requestOrder(
  operation: "create" | "get" | "cancel" | "list",
  url: string,
  init: RequestInit,
  message: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    // A transport failure is not an upstream verdict. The message stays the
    // same shape the route returns, and nothing about the request is logged.
    console.error(`[intents/orders] ${operation} failed (network)`);
    throw new Error(message);
  }
  if (!res.ok) {
    await logOrderFailure(operation, res);
    throw new Error(message);
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isSide(value: unknown): value is LimitOrderSide {
  return value === "BUY" || value === "SELL";
}

function isDepositType(value: unknown): value is LimitOrderDepositType {
  return (
    value === "ORIGIN_CHAIN" ||
    value === "INTENTS" ||
    value === "CONFIDENTIAL_INTENTS"
  );
}

function parseSwapView(value: unknown): LimitOrderSwapView | null {
  const swap = asRecord(value);
  if (!swap) return null;
  const originAsset = text(swap.originAsset);
  const destinationAsset = text(swap.destinationAsset);
  if (!originAsset || !destinationAsset) return null;

  if (swap.swapType === "EXACT_INPUT") {
    const amountIn = text(swap.amountIn);
    const minAmountOut = text(swap.minAmountOut);
    if (!amountIn || !minAmountOut) return null;
    return {
      swapType: "EXACT_INPUT",
      originAsset,
      destinationAsset,
      amountIn,
      minAmountOut,
    };
  }

  if (swap.swapType === "EXACT_OUTPUT") {
    const maxAmountIn = text(swap.maxAmountIn);
    const amountOut = text(swap.amountOut);
    if (!maxAmountIn || !amountOut) return null;
    return {
      swapType: "EXACT_OUTPUT",
      originAsset,
      destinationAsset,
      maxAmountIn,
      amountOut,
    };
  }

  return null;
}

function parsePartialFills(
  value: unknown,
): LimitOrderView["partialFills"] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const fills: LimitOrderView["partialFills"] = [];
  for (const entry of value) {
    const fill = asRecord(entry);
    if (!fill) return null;
    const id = text(fill.id);
    const amountIn = text(fill.amountIn);
    const amountOut = text(fill.amountOut);
    const createdAt = text(fill.createdAt);
    const updatedAt = text(fill.updatedAt);
    if (!id || !amountIn || !amountOut || !createdAt || !updatedAt) {
      return null;
    }
    fills.push({ id, amountIn, amountOut, createdAt, updatedAt });
  }
  return fills;
}

/**
 * Turns one JSON:API resource into a view, or refuses it.
 *
 * Missing fields are an upstream error, never a zero. A caller that filled a
 * gap would be pricing money from a guess, which is the one thing this layer
 * must not do.
 */
function parseLimitOrderResource(
  data: unknown,
  message: string,
): LimitOrderView {
  const resource = asRecord(data);
  const attributes = asRecord(resource?.attributes);
  const orderId = text(resource?.id);
  if (!resource || !attributes || !orderId) throw new Error(message);

  const side = attributes.side;
  const depositType = attributes.depositType;
  const swapView = parseSwapView(attributes.swapView);
  const baseAsset = text(attributes.baseAsset);
  const quoteAsset = text(attributes.quoteAsset);
  const quantity = text(attributes.quantity);
  const price = text(attributes.price);
  const depositAddress = text(attributes.depositAddress);
  const fillStatus = text(attributes.fillStatus);
  const payoutStatus = text(attributes.payoutStatus);
  const isPayoutStatusFinal = attributes.isPayoutStatusFinal;
  const recipient = text(attributes.recipient);
  const recipientType = text(attributes.recipientType);
  const refundTo = text(attributes.refundTo);
  const refundType = text(attributes.refundType);
  const confidentiality = text(attributes.confidentiality);
  const partialFills = parsePartialFills(attributes.partialFills);

  if (
    !isSide(side) ||
    !isDepositType(depositType) ||
    !swapView ||
    !baseAsset ||
    !quoteAsset ||
    !quantity ||
    !price ||
    !depositAddress ||
    !fillStatus ||
    !payoutStatus ||
    typeof isPayoutStatusFinal !== "boolean" ||
    !recipient ||
    !recipientType ||
    !refundTo ||
    !refundType ||
    !confidentiality ||
    partialFills === null
  ) {
    throw new Error(message);
  }

  const payouts = attributes.payouts;
  if (payouts !== undefined && payouts !== null && !asRecord(payouts)) {
    throw new Error(message);
  }

  const deadline = optionalText(attributes.deadline, message);
  const createdAt = optionalText(attributes.createdAt, message);
  const depositedAmount = optionalText(attributes.depositedAmount, message);
  const depositedAmountFormatted = optionalText(
    attributes.depositedAmountFormatted,
    message,
  );
  const estimatedWithdrawFee = optionalText(
    attributes.estimatedWithdrawFee,
    message,
  );
  const estimatedWithdrawFeeFormatted = optionalText(
    attributes.estimatedWithdrawFeeFormatted,
    message,
  );
  const estimatedRefundFee = optionalText(
    attributes.estimatedRefundFee,
    message,
  );
  const estimatedRefundFeeFormatted = optionalText(
    attributes.estimatedRefundFeeFormatted,
    message,
  );

  return {
    orderId,
    side,
    baseAsset,
    quoteAsset,
    quantity,
    price,
    depositAddress,
    depositMemo: text(attributes.depositMemo),
    depositType,
    swapView,
    fillStatus,
    payoutStatus,
    isPayoutStatusFinal,
    ...(depositedAmount ? { depositedAmount } : {}),
    ...(depositedAmountFormatted ? { depositedAmountFormatted } : {}),
    partialFills,
    ...(payouts ? { payouts: payouts as Record<string, unknown> } : {}),
    recipient,
    recipientType,
    refundTo,
    refundType,
    confidentiality,
    ...(deadline ? { deadline } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(estimatedWithdrawFee ? { estimatedWithdrawFee } : {}),
    ...(estimatedWithdrawFeeFormatted ? { estimatedWithdrawFeeFormatted } : {}),
    ...(estimatedRefundFee ? { estimatedRefundFee } : {}),
    ...(estimatedRefundFeeFormatted ? { estimatedRefundFeeFormatted } : {}),
  };
}

function optionalText(value: unknown, message: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(message);
  return value.length > 0 ? value : undefined;
}

async function readJson(res: Response, message: string): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new Error(message);
  }
}

/* ------------------------------------------------------------------ */
/* the client                                                          */
/* ------------------------------------------------------------------ */

export async function createLimitOrder(
  input: CreateLimitOrderInput,
): Promise<LimitOrderView> {
  validateCreateInput(input);

  const res = await requestOrder(
    "create",
    `${BASE}/v0/orders`,
    {
      method: "POST",
      headers: oneClickHeaders(),
      body: JSON.stringify({
        data: {
          type: "orders",
          attributes: {
            orderType: "LIMIT",
            baseAsset: input.baseAsset,
            quoteAsset: input.quoteAsset,
            quantity: input.quantity,
            side: input.side,
            price: input.price,
            depositType: input.depositType,
            refundTo: input.refundTo,
            refundType: input.refundType,
            recipient: input.recipient,
            recipientType: input.recipientType,
            confidentiality: input.confidentiality,
            ...(input.deadline ? { deadline: input.deadline } : {}),
          },
        },
      }),
    },
    CREATE_ERROR,
  );

  const body = await readJson(res, CREATE_ERROR);
  const resource = asRecord(body)?.data;
  return parseLimitOrderResource(resource, CREATE_ERROR);
}

export async function getLimitOrder(orderId: string): Promise<LimitOrderView> {
  if (!orderId || orderId.length > 200) throw new Error(GET_ERROR);

  const res = await requestOrder(
    "get",
    `${BASE}/v0/orders/${encodeURIComponent(orderId)}`,
    { method: "GET", headers: oneClickHeaders() },
    GET_ERROR,
  );

  const body = await readJson(res, GET_ERROR);
  const resource = asRecord(body)?.data;
  return parseLimitOrderResource(resource, GET_ERROR);
}

/**
 * Requests cancellation. The order does not stop immediately: matching stops,
 * a last slice can still fill, and the unfilled input is refunded
 * asynchronously by 1Click. The returned view is a snapshot, not a verdict.
 */
export async function cancelLimitOrder(
  orderId: string,
): Promise<LimitOrderView> {
  if (!orderId || orderId.length > 200) throw new Error(CANCEL_ERROR);

  const res = await requestOrder(
    "cancel",
    `${BASE}/v0/orders/${encodeURIComponent(orderId)}/cancel`,
    { method: "POST", headers: oneClickHeaders() },
    CANCEL_ERROR,
  );

  const body = await readJson(res, CANCEL_ERROR);
  const resource = asRecord(body)?.data;
  return parseLimitOrderResource(resource, CANCEL_ERROR);
}

export async function listLimitOrders(
  input: {
    fillStatus?: string[];
    isPayoutStatusFinal?: boolean;
    pageSize?: number;
    after?: string;
  } = {},
): Promise<{ orders: LimitOrderView[]; next?: string | null }> {
  const query = new URLSearchParams();
  for (const status of input.fillStatus ?? []) {
    query.append("filter[fillStatus]", status);
  }
  if (typeof input.isPayoutStatusFinal === "boolean") {
    query.set("filter[isPayoutStatusFinal]", String(input.isPayoutStatusFinal));
  }
  if (typeof input.pageSize === "number" && Number.isFinite(input.pageSize)) {
    const size = Math.min(Math.max(Math.trunc(input.pageSize), 1), 50);
    query.set("page[size]", String(size));
  }
  if (input.after) query.set("page[after]", input.after);

  const suffix = query.toString();
  const res = await requestOrder(
    "list",
    `${BASE}/v0/orders${suffix ? `?${suffix}` : ""}`,
    { method: "GET", headers: oneClickHeaders() },
    LIST_ERROR,
  );

  const body = asRecord(await readJson(res, LIST_ERROR));
  const data = body?.data;
  if (!Array.isArray(data)) throw new Error(LIST_ERROR);

  const orders = data.map((entry) =>
    parseLimitOrderResource(entry, LIST_ERROR),
  );
  const links = asRecord(body?.links);
  const next = links ? text(links.next) : null;

  return { orders, next };
}

function validateCreateInput(input: CreateLimitOrderInput): void {
  const invalid = (): never => {
    throw new Error("The limit order parameters are not valid.");
  };

  if (!input.baseAsset || !input.quoteAsset) invalid();
  if (input.baseAsset === input.quoteAsset) invalid();
  if (!isSide(input.side)) invalid();
  if (!/^[1-9]\d*$/.test(input.quantity)) invalid();
  if (!parseLimitPrice(input.price)) invalid();
  if (!isDepositType(input.depositType)) invalid();
  if (!input.recipient || !input.refundTo) invalid();
  if (
    input.recipientType !== "DESTINATION_CHAIN" &&
    input.recipientType !== "INTENTS" &&
    input.recipientType !== "CONFIDENTIAL_INTENTS"
  ) {
    invalid();
  }
  if (
    input.refundType !== "ORIGIN_CHAIN" &&
    input.refundType !== "INTENTS" &&
    input.refundType !== "CONFIDENTIAL_INTENTS"
  ) {
    invalid();
  }
  // The product has no public order. A caller cannot relabel one.
  if (input.confidentiality !== "basic" && input.confidentiality !== "advanced") {
    invalid();
  }
  if (input.deadline && !Number.isFinite(Date.parse(input.deadline))) invalid();
}

/* ------------------------------------------------------------------ */
/* the quote-side amount                                               */
/* ------------------------------------------------------------------ */

export type ParsedLimitPrice = {
  /** The validated human-unit string, trimmed and otherwise unchanged. */
  text: string;
  /** The price scaled by its own decimals, as an integer. */
  numerator: bigint;
  /** How many decimal places the price carried, 0 to 18. */
  scale: number;
};

/**
 * Parses a positive human-unit price with at most 18 decimal places.
 *
 * Scientific notation, a sign, a bare decimal point, and more than 18 places
 * are refused. `5.000` is the same price as `5`, so trailing zeros are
 * dropped before scaling rather than carried into the arithmetic.
 */
export function parseLimitPrice(value: string): ParsedLimitPrice | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;

  const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(trimmed);
  if (!match) return null;

  const whole = match[1];
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  const numerator = BigInt(digits);
  if (numerator <= 0n) return null;

  return { text: trimmed, numerator, scale: fraction.length };
}

/**
 * The quote-side amount for a limit order.
 *
 * `quantity × price × 10^quoteDecimals / 10^baseDecimals`, rounded up to a
 * whole smallest unit. The division happens once in BigInt space, so a long
 * price never touches a floating-point number.
 */
export function quoteSideTotalRaw(input: {
  quantity: string;
  price: string;
  baseDecimals: number;
  quoteDecimals: number;
}): string {
  if (!/^[1-9]\d*$/.test(input.quantity)) {
    throw new Error("The limit order quantity is not valid.");
  }
  const price = parseLimitPrice(input.price);
  if (!price) throw new Error("The limit order price is not valid.");
  for (const decimals of [input.baseDecimals, input.quoteDecimals]) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new Error("The limit order decimals are not valid.");
    }
  }

  const numerator =
    BigInt(input.quantity) *
    price.numerator *
    10n ** BigInt(input.quoteDecimals);
  const denominator =
    10n ** BigInt(input.baseDecimals) * 10n ** BigInt(price.scale);
  return ((numerator + denominator - 1n) / denominator).toString();
}

export type LimitOrderAmounts = {
  inputAssetId: string;
  outputAssetId: string;
  inputAmount: string;
  outputAmount: string;
};

/**
 * Which side the user deposits and which side they receive.
 *
 * A SELL deposits the base and receives the quote; a BUY deposits the quote
 * and receives the base. The quote-side total is the same figure either way.
 */
export function computeLimitOrderAmounts(input: {
  side: LimitOrderSide;
  quantity: string;
  price: string;
  baseAssetId: string;
  quoteAssetId: string;
  baseDecimals: number;
  quoteDecimals: number;
}): LimitOrderAmounts {
  const total = quoteSideTotalRaw({
    quantity: input.quantity,
    price: input.price,
    baseDecimals: input.baseDecimals,
    quoteDecimals: input.quoteDecimals,
  });

  return input.side === "SELL"
    ? {
        inputAssetId: input.baseAssetId,
        outputAssetId: input.quoteAssetId,
        inputAmount: input.quantity,
        outputAmount: total,
      }
    : {
        inputAssetId: input.quoteAssetId,
        outputAssetId: input.baseAssetId,
        inputAmount: total,
        outputAmount: input.quantity,
      };
}

/* ------------------------------------------------------------------ */
/* order state                                                         */
/* ------------------------------------------------------------------ */

export type LimitOrderStateMapping = {
  state: TxState;
  /** True when no later poll can change the money outcome. */
  terminal: boolean;
};

/**
 * The one order-to-transaction state table.
 *
 * `FILLED` and `CANCELED`/`EXPIRED` are not terminal until the payout leg is
 * final: the withdrawal or the refund can still fail, and the record must not
 * claim a settlement 1Click has not finished. A payout failure outranks every
 * fill status, because the money did not arrive.
 */
export function limitOrderTransactionState(
  order: Pick<
    LimitOrderView,
    "fillStatus" | "payoutStatus" | "isPayoutStatusFinal"
  >,
): LimitOrderStateMapping {
  const fill = order.fillStatus.trim().toUpperCase();
  const payout = order.payoutStatus.trim().toUpperCase();
  const final = order.isPayoutStatusFinal;

  if (payout === "FAILED") return { state: "failed", terminal: true };

  switch (fill) {
    case "AWAITING_DEPOSIT":
      return { state: "submitted", terminal: false };
    case "OPEN":
    case "UNTRIGGERED":
      return { state: "pending", terminal: false };
    case "PARTIALLY_FILLED":
    case "PENDING_CANCEL":
      return { state: "processing", terminal: false };
    case "FILLED":
      return final
        ? { state: "settled", terminal: true }
        : { state: "processing", terminal: false };
    case "CANCELED":
    case "EXPIRED":
      return final
        ? { state: "refunded", terminal: true }
        : { state: "processing", terminal: false };
    default:
      // A new fill status is not a failure. It stays pending so the next poll
      // can report it rather than freezing the record on a guess.
      return { state: "pending", terminal: false };
  }
}

/**
 * Whether the record has not reached submission yet.
 *
 * An account-funded order exists as soon as 1Click creates it, but its
 * transaction is still `awaiting_approval` until the signed intent is
 * submitted. A refresh must not map the order's AWAITING_DEPOSIT state over
 * that record, because the submit route would then have nothing to accept.
 */
const PRE_SUBMISSION_STATES = new Set([
  "draft",
  "quoted",
  "awaiting_approval",
  "authorized",
]);

export function isLimitOrderPreSubmission(state: string): boolean {
  return PRE_SUBMISSION_STATES.has(state);
}

/** The filled totals across every reported partial fill, in raw units. */
export function limitOrderFilledAmounts(
  order: Pick<LimitOrderView, "partialFills">,
): { amountIn: string | null; amountOut: string | null } {
  let amountIn = 0n;
  let amountOut = 0n;
  for (const fill of order.partialFills) {
    if (!/^\d+$/.test(fill.amountIn) || !/^\d+$/.test(fill.amountOut)) {
      return { amountIn: null, amountOut: null };
    }
    amountIn += BigInt(fill.amountIn);
    amountOut += BigInt(fill.amountOut);
  }
  return { amountIn: amountIn.toString(), amountOut: amountOut.toString() };
}

/**
 * The part of a live order a reader needs after a reload.
 *
 * It carries no signed material. The intent payload and the intent hash stay
 * out of every response and every tool output.
 */
export function limitOrderOutcome(
  order: LimitOrderView,
): Record<string, unknown> {
  const filled = limitOrderFilledAmounts(order);
  return {
    orderId: order.orderId,
    fillStatus: order.fillStatus,
    payoutStatus: order.payoutStatus,
    isPayoutStatusFinal: order.isPayoutStatusFinal,
    partialFills: order.partialFills,
    ...(filled.amountIn !== null && filled.amountOut !== null
      ? {
          filledAmountIn: filled.amountIn,
          filledAmountOut: filled.amountOut,
        }
      : {}),
    ...(order.depositedAmount
      ? { depositedAmount: order.depositedAmount }
      : {}),
    ...(order.depositedAmountFormatted
      ? { depositedAmountFormatted: order.depositedAmountFormatted }
      : {}),
    ...(order.payouts ? { payouts: order.payouts } : {}),
  };
}

/** The stored refs a browser may read. Never the payload or the hash. */
export function limitOrderRefsView(
  refs: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!refs) return {};
  const allowed = [
    "kind",
    "orderId",
    "mode",
    "standard",
    "side",
    "baseAsset",
    "quoteAsset",
    "quantity",
    "price",
    "depositType",
    "swapView",
    "fillStatus",
    "payoutStatus",
    "isPayoutStatusFinal",
    "deadline",
    "orderDeadline",
    "amountInRaw",
    "assetId",
    "toolApprovalId",
    "conversationId",
  ];
  const view: Record<string, unknown> = {};
  for (const key of allowed) {
    if (refs[key] !== undefined) view[key] = refs[key];
  }
  return view;
}

/* ------------------------------------------------------------------ */
/* stored quote                                                        */
/* ------------------------------------------------------------------ */

export type LimitOrderFunding = "account" | "wallet";

export type StoredLimitOrderQuote = {
  baseAssetId: string;
  quoteAssetId: string;
  side: LimitOrderSide;
  quantity: string;
  price: string;
  funding: LimitOrderFunding;
  accountKind: "wallet" | "passkey";
  intentsAccountId: string;
  inputAssetId: string;
  outputAssetId: string;
  inputAmount: string;
  outputAmount: string;
  baseSymbol: string;
  quoteSymbol: string;
  quantityFormatted: string;
  totalFormatted: string;
  deadline: string;
};

export type StoredLimitOrderQuoteResult =
  | { ok: true; quote: StoredLimitOrderQuote }
  | {
      ok: false;
      reason: "quote-malformed" | "mode-mismatch" | "account-mismatch";
    };

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * Reads the dry limit-order preview the quote tool saved.
 *
 * The browser body only names the quote. Every priced value comes from this
 * row, and the row must still describe a limit order for this session: a
 * quote priced for another account, or for the swap route, is refused rather
 * than re-purposed. The two sides are also checked against the order side, so
 * a stored row whose input and output disagree with its own quote cannot
 * reach a create call.
 */
export function readStoredLimitOrderQuote(
  stored: { request: unknown; response: unknown },
  expected: {
    accountKind: "wallet" | "passkey";
    intentsAccountId: string;
  },
): StoredLimitOrderQuoteResult {
  const request = asRecord(stored.request);
  const response = asRecord(stored.response);
  if (!request || !response) return { ok: false, reason: "quote-malformed" };

  if (request.kind !== "limit_order" || response.kind !== "limit_order") {
    return { ok: false, reason: "mode-mismatch" };
  }

  const baseAssetId = text(request.baseAssetId);
  const quoteAssetId = text(request.quoteAssetId);
  const side = request.side;
  const quantity = text(request.quantity);
  const price = text(request.price);
  const funding = request.funding;
  const accountKind = request.accountKind;
  const intentsAccountId = text(request.intentsAccountId);

  if (
    !baseAssetId ||
    !quoteAssetId ||
    baseAssetId === quoteAssetId ||
    !isSide(side) ||
    !quantity ||
    !/^[1-9]\d*$/.test(quantity) ||
    !price ||
    !parseLimitPrice(price) ||
    (funding !== "account" && funding !== "wallet") ||
    (accountKind !== "wallet" && accountKind !== "passkey") ||
    !intentsAccountId
  ) {
    return { ok: false, reason: "quote-malformed" };
  }

  if (
    accountKind !== expected.accountKind ||
    intentsAccountId !== expected.intentsAccountId
  ) {
    return { ok: false, reason: "account-mismatch" };
  }

  const inputAssetId = text(response.inputAssetId);
  const outputAssetId = text(response.outputAssetId);
  const inputAmount = text(response.inputAmount);
  const outputAmount = text(response.outputAmount);
  const baseSymbol = text(response.baseSymbol);
  const quoteSymbol = text(response.quoteSymbol);
  const quantityFormatted = text(response.quantityFormatted);
  const totalFormatted = text(response.totalFormatted);
  const deadline = text(response.deadline);

  if (
    !inputAssetId ||
    !outputAssetId ||
    !inputAmount ||
    !/^[1-9]\d*$/.test(inputAmount) ||
    !outputAmount ||
    !/^[1-9]\d*$/.test(outputAmount) ||
    !baseSymbol ||
    !quoteSymbol ||
    !quantityFormatted ||
    !totalFormatted ||
    !deadline ||
    !Number.isFinite(Date.parse(deadline))
  ) {
    return { ok: false, reason: "quote-malformed" };
  }

  // The side decides which asset is deposited. A stored row that disagrees
  // with its own side would create an order funding the wrong balance.
  const expectedInput = side === "SELL" ? baseAssetId : quoteAssetId;
  const expectedOutput = side === "SELL" ? quoteAssetId : baseAssetId;
  if (inputAssetId !== expectedInput || outputAssetId !== expectedOutput) {
    return { ok: false, reason: "quote-malformed" };
  }

  // The deposit amount is the base quantity on a SELL and the quote total on
  // a BUY. The stored response must already agree with that shape.
  const storedQuantity = side === "SELL" ? inputAmount : outputAmount;
  if (storedQuantity !== quantity) {
    return { ok: false, reason: "quote-malformed" };
  }

  return {
    ok: true,
    quote: {
      baseAssetId,
      quoteAssetId,
      side,
      quantity,
      price,
      funding,
      accountKind,
      intentsAccountId,
      inputAssetId,
      outputAssetId,
      inputAmount,
      outputAmount,
      baseSymbol,
      quoteSymbol,
      quantityFormatted,
      totalFormatted,
      deadline,
    },
  };
}

/**
 * The deadline the generated intent actually carries.
 *
 * `generate-intent` mints the payload and its deadline together. The stored
 * refs must name the same instant or the verifier refuses the assertion, so
 * the payload's own value replaces the order deadline when it has one. The
 * payload is server-minted and stored, never browser-supplied.
 */
export function deadlineFromIntentPayload(payload: unknown): string | null {
  const envelope =
    typeof payload === "string" ? parseJsonRecord(payload) : asRecord(payload);
  if (!envelope) return null;

  const message =
    typeof envelope.message === "string"
      ? parseJsonRecord(envelope.message)
      : envelope;
  if (!message) return null;

  const deadline = message.deadline;
  if (typeof deadline === "string") {
    return Number.isFinite(Date.parse(deadline)) ? deadline : null;
  }
  const timestamp = asRecord(deadline)?.timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return new Date(timestamp * 1000).toISOString();
  }
  return null;
}
