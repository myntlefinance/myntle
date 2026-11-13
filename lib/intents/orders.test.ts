import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelLimitOrder,
  computeLimitOrderAmounts,
  createLimitOrder,
  getLimitOrder,
  limitOrderTransactionState,
  listLimitOrders,
  parseLimitPrice,
  quoteSideTotalRaw,
} from "./orders";

/**
 * The order wire contract only. Every fixture is synthetic, the partner key is
 * a placeholder, and no request leaves the process.
 */

const PARTNER_KEY = "test-partner-key";
const BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const QUOTE = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";
const RECIPIENT = "0x7edf07ede58238026db3f90fc8032633b69b8de5";
const DEPOSIT = "0x2527d02599ba641c19fea793cd0f167589a0f10d";
const ORDER_ID = "order-abc123";
const DEADLINE = "2026-11-20T11:28:18.215Z";

type CapturedRequest = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function installFetch(
  respond: (url: string, init?: RequestInit) => unknown | Promise<unknown>,
) {
  const requests: CapturedRequest[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    return respond(url, init);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, requests };
}

function attributes(overrides: Record<string, unknown> = {}) {
  return {
    orderType: "LIMIT",
    depositAddress: DEPOSIT,
    depositMemo: null,
    depositMode: "SIMPLE",
    depositType: "ORIGIN_CHAIN",
    fillStatus: "OPEN",
    payoutStatus: "NOT_STARTED",
    isPayoutStatusFinal: false,
    payouts: { withdrawal: null, allWithdrawals: [], refund: null },
    depositedAmount: "1000000",
    depositedAmountFormatted: "1",
    baseAsset: BASE,
    quoteAsset: QUOTE,
    quantity: "1000000",
    swapView: {
      swapType: "EXACT_INPUT",
      originAsset: BASE,
      destinationAsset: QUOTE,
      amountIn: "1000000",
      minAmountOut: "5000000",
    },
    side: "SELL",
    price: "5",
    appFees: [],
    recipient: RECIPIENT,
    recipientType: "DESTINATION_CHAIN",
    refundTo: RECIPIENT,
    refundType: "ORIGIN_CHAIN",
    estimatedWithdrawFee: "0",
    estimatedWithdrawFeeFormatted: "0",
    estimatedRefundFee: "0",
    estimatedRefundFeeFormatted: "0",
    confidentiality: "basic",
    timeInForce: "GTC",
    deadline: DEADLINE,
    createdAt: "2026-11-13T11:28:18.215Z",
    partialFills: [],
    ...overrides,
  };
}

function createInput() {
  return {
    baseAsset: BASE,
    quoteAsset: QUOTE,
    side: "SELL" as const,
    quantity: "1000000",
    price: "5",
    depositType: "ORIGIN_CHAIN" as const,
    recipient: RECIPIENT,
    recipientType: "DESTINATION_CHAIN" as const,
    refundTo: RECIPIENT,
    refundType: "ORIGIN_CHAIN" as const,
    confidentiality: "basic" as const,
  };
}

function bodyOf(requests: CapturedRequest[]): Record<string, unknown> {
  const call = requests[0];
  if (!call) throw new Error("No request was made");
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv("ONE_CLICK_API_KEY", PARTNER_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createLimitOrder", () => {
  it("sends the JSON:API envelope and parses the created order", async () => {
    const { requests } = installFetch(() =>
      jsonResponse(
        {
          data: { type: "orders", id: ORDER_ID, attributes: attributes() },
          meta: { correlationId: "corr-1", timestamp: DEADLINE },
        },
        201,
      ),
    );

    const order = await createLimitOrder(createInput());

    const body = bodyOf(requests) as {
      data: { type: string; attributes: Record<string, unknown> };
    };
    expect(requests[0]?.url).toContain("/v0/orders");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(
      (requests[0]?.init?.headers as Record<string, string> | undefined)?.[
        "X-API-Key"
      ],
    ).toBe(PARTNER_KEY);
    expect(body.data.type).toBe("orders");
    expect(body.data.attributes).toMatchObject({
      orderType: "LIMIT",
      baseAsset: BASE,
      quoteAsset: QUOTE,
      quantity: "1000000",
      side: "SELL",
      price: "5",
      depositType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
      confidentiality: "basic",
    });
    // No deadline is sent, so the order keeps the API's seven-day default.
    expect(body.data.attributes).not.toHaveProperty("deadline");

    expect(order).toMatchObject({
      orderId: ORDER_ID,
      side: "SELL",
      baseAsset: BASE,
      quoteAsset: QUOTE,
      depositAddress: DEPOSIT,
      depositType: "ORIGIN_CHAIN",
      fillStatus: "OPEN",
      payoutStatus: "NOT_STARTED",
      isPayoutStatusFinal: false,
      quantity: "1000000",
      price: "5",
      recipient: RECIPIENT,
      refundTo: RECIPIENT,
      confidentiality: "basic",
      deadline: DEADLINE,
      depositedAmount: "1000000",
    });
    expect(order.swapView).toEqual({
      swapType: "EXACT_INPUT",
      originAsset: BASE,
      destinationAsset: QUOTE,
      amountIn: "1000000",
      minAmountOut: "5000000",
    });
    expect(order.partialFills).toEqual([]);
  });

  it("refuses invalid figures before any request", async () => {
    const { mock } = installFetch(() => jsonResponse({}));

    await expect(
      createLimitOrder({ ...createInput(), quantity: "0" }),
    ).rejects.toThrow("The limit order parameters are not valid.");
    await expect(
      createLimitOrder({ ...createInput(), price: "0" }),
    ).rejects.toThrow("The limit order parameters are not valid.");
    await expect(
      createLimitOrder({ ...createInput(), baseAsset: QUOTE }),
    ).rejects.toThrow("The limit order parameters are not valid.");
    await expect(
      createLimitOrder({
        ...createInput(),
        confidentiality: "public" as never,
      }),
    ).rejects.toThrow("The limit order parameters are not valid.");
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("getLimitOrder", () => {
  it("parses an exact-output BUY with its partial fills", async () => {
    const { requests } = installFetch(() =>
      jsonResponse({
        data: {
          type: "orders",
          id: ORDER_ID,
          attributes: attributes({
            side: "BUY",
            depositType: "CONFIDENTIAL_INTENTS",
            recipientType: "CONFIDENTIAL_INTENTS",
            refundType: "CONFIDENTIAL_INTENTS",
            fillStatus: "PARTIALLY_FILLED",
            payoutStatus: "IN_PROGRESS",
            swapView: {
              swapType: "EXACT_OUTPUT",
              originAsset: QUOTE,
              destinationAsset: BASE,
              maxAmountIn: "5000000",
              amountOut: "1000000",
            },
            partialFills: [
              {
                id: "fill-1",
                amountIn: "1000000",
                amountOut: "200000",
                createdAt: "2026-11-13T12:00:00.000Z",
                updatedAt: "2026-11-13T12:00:05.000Z",
              },
            ],
          }),
        },
        meta: { correlationId: "corr-2", timestamp: DEADLINE },
      }),
    );

    const order = await getLimitOrder(ORDER_ID);

    expect(requests[0]?.url).toContain(`/v0/orders/${ORDER_ID}`);
    expect(requests[0]?.init?.method).toBe("GET");
    expect(order.side).toBe("BUY");
    expect(order.fillStatus).toBe("PARTIALLY_FILLED");
    expect(order.partialFills).toEqual([
      {
        id: "fill-1",
        amountIn: "1000000",
        amountOut: "200000",
        createdAt: "2026-11-13T12:00:00.000Z",
        updatedAt: "2026-11-13T12:00:05.000Z",
      },
    ]);
    expect(order.swapView).toEqual({
      swapType: "EXACT_OUTPUT",
      originAsset: QUOTE,
      destinationAsset: BASE,
      maxAmountIn: "5000000",
      amountOut: "1000000",
    });
  });

  it("rejects a response with a missing field instead of inventing it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    installFetch(() =>
      jsonResponse({
        data: {
          type: "orders",
          id: ORDER_ID,
          attributes: attributes({ depositAddress: undefined }),
        },
      }),
    );

    await expect(getLimitOrder(ORDER_ID)).rejects.toThrow(
      "The limit order could not be read. Please try again.",
    );
  });
});

describe("cancelLimitOrder and listLimitOrders", () => {
  it("posts the cancel and parses the returned snapshot", async () => {
    const { requests } = installFetch(() =>
      jsonResponse(
        {
          data: {
            type: "orders",
            id: ORDER_ID,
            attributes: attributes({ fillStatus: "PENDING_CANCEL" }),
          },
        },
        201,
      ),
    );

    const order = await cancelLimitOrder(ORDER_ID);

    expect(requests[0]?.url).toContain(`/v0/orders/${ORDER_ID}/cancel`);
    expect(requests[0]?.init?.method).toBe("POST");
    expect(order.fillStatus).toBe("PENDING_CANCEL");
  });

  it("reads a page and its next cursor", async () => {
    const { requests } = installFetch(() =>
      jsonResponse({
        data: [
          {
            type: "orders",
            id: ORDER_ID,
            attributes: attributes({ fillStatus: "FILLED" }),
          },
        ],
        links: { next: "cursor-2" },
        meta: { correlationId: "corr-3", timestamp: DEADLINE },
      }),
    );

    const page = await listLimitOrders({
      fillStatus: ["OPEN"],
      isPayoutStatusFinal: false,
      pageSize: 10,
    });

    expect(requests[0]?.url).toContain("filter%5BfillStatus%5D=OPEN");
    expect(requests[0]?.url).toContain("filter%5BisPayoutStatusFinal%5D=false");
    expect(requests[0]?.url).toContain("page%5Bsize%5D=10");
    expect(page.orders).toHaveLength(1);
    expect(page.next).toBe("cursor-2");
  });

  it("logs only the status and a short code, never the key or the body", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installFetch(() =>
      jsonResponse(
        {
          errors: [
            {
              status: "400",
              code: "order-rejected",
              title: "Order rejected",
              detail: `The figure was rejected for ${PARTNER_KEY}`,
            },
          ],
          meta: { correlationId: "corr-4", timestamp: DEADLINE },
        },
        400,
      ),
    );

    await expect(createLimitOrder(createInput())).rejects.toThrow(
      "The limit order could not be created. Please try again.",
    );

    const logged = errorSpy.mock.calls
      .map((call) =>
        call
          .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" "),
      )
      .join("\n");
    expect(logged).toContain("400");
    expect(logged).toContain("order-rejected");
    expect(logged).not.toContain(PARTNER_KEY);
    expect(logged).not.toContain(RECIPIENT);
  });
});

describe("the quote-side amount", () => {
  it("prices a SELL with six-decimal base and eighteen-decimal quote", () => {
    const amounts = computeLimitOrderAmounts({
      side: "SELL",
      quantity: "1000000",
      price: "2.5",
      baseAssetId: BASE,
      quoteAssetId: QUOTE,
      baseDecimals: 6,
      quoteDecimals: 18,
    });

    expect(amounts).toEqual({
      inputAssetId: BASE,
      outputAssetId: QUOTE,
      inputAmount: "1000000",
      outputAmount: "2500000000000000000",
    });
  });

  it("prices a BUY with twenty-four-decimal base and six-decimal quote", () => {
    const amounts = computeLimitOrderAmounts({
      side: "BUY",
      quantity: "1000000000000000000000000",
      price: "5",
      baseAssetId: BASE,
      quoteAssetId: QUOTE,
      baseDecimals: 24,
      quoteDecimals: 6,
    });

    expect(amounts).toEqual({
      inputAssetId: QUOTE,
      outputAssetId: BASE,
      inputAmount: "5000000",
      outputAmount: "1000000000000000000000000",
    });
  });

  it("rounds up to one whole smallest unit", () => {
    // Six of each decimal, a quantity of one raw unit, and a price below one
    // raw quote unit: the mathematical total is a fraction, so a SELL keeps
    // its one input unit and asks for one output unit.
    expect(
      computeLimitOrderAmounts({
        side: "SELL",
        quantity: "1",
        price: "0.0000001",
        baseAssetId: BASE,
        quoteAssetId: QUOTE,
        baseDecimals: 6,
        quoteDecimals: 6,
      }).outputAmount,
    ).toBe("1");

    expect(
      quoteSideTotalRaw({
        quantity: "1",
        price: "0.000000000000000001",
        baseDecimals: 18,
        quoteDecimals: 18,
      }),
    ).toBe("1");
  });

  it("parses up to eighteen price decimals and refuses more", () => {
    expect(parseLimitPrice("5.000")).toEqual({
      text: "5.000",
      numerator: 5n,
      scale: 0,
    });
    expect(parseLimitPrice("0.5")).toEqual({
      text: "0.5",
      numerator: 5n,
      scale: 1,
    });
    expect(parseLimitPrice("1.123456789012345678")?.scale).toBe(18);
    expect(parseLimitPrice("1.1234567890123456789")).toBeNull();
    expect(parseLimitPrice("0")).toBeNull();
    expect(parseLimitPrice("1e-2")).toBeNull();
    expect(parseLimitPrice("-1")).toBeNull();
  });
});

describe("the order-to-transaction state table", () => {
  const map = (
    fillStatus: string,
    payoutStatus: string,
    isPayoutStatusFinal: boolean,
  ) =>
    limitOrderTransactionState({
      fillStatus,
      payoutStatus,
      isPayoutStatusFinal,
    });

  it("maps every documented fill state", () => {
    expect(map("AWAITING_DEPOSIT", "NOT_STARTED", false)).toEqual({
      state: "submitted",
      terminal: false,
    });
    expect(map("OPEN", "NOT_STARTED", false)).toEqual({
      state: "pending",
      terminal: false,
    });
    expect(map("PARTIALLY_FILLED", "IN_PROGRESS", false)).toEqual({
      state: "processing",
      terminal: false,
    });
    expect(map("FILLED", "COMPLETED", true)).toEqual({
      state: "settled",
      terminal: true,
    });
    expect(map("CANCELED", "COMPLETED", true)).toEqual({
      state: "refunded",
      terminal: true,
    });
    expect(map("EXPIRED", "COMPLETED", true)).toEqual({
      state: "refunded",
      terminal: true,
    });
  });

  it("waits for the payout leg before calling a fill terminal", () => {
    expect(map("FILLED", "IN_PROGRESS", false)).toEqual({
      state: "processing",
      terminal: false,
    });
    expect(map("CANCELED", "IN_PROGRESS", false)).toEqual({
      state: "processing",
      terminal: false,
    });
  });

  it("treats a payout failure as terminal and a new fill status as pending", () => {
    expect(map("FILLED", "FAILED", true)).toEqual({
      state: "failed",
      terminal: true,
    });
    expect(map("SOMETHING_NEW", "NOT_STARTED", false)).toEqual({
      state: "pending",
      terminal: false,
    });
  });
});
