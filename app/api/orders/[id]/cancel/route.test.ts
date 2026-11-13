import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  getTransactionMock,
  setTransactionStatusMock,
  setTransactionOutcomeMock,
  updateTransactionRefsMock,
  addEventMock,
  cancelLimitOrderMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  getTransactionMock: vi.fn(),
  setTransactionStatusMock: vi.fn(),
  setTransactionOutcomeMock: vi.fn(),
  updateTransactionRefsMock: vi.fn(),
  addEventMock: vi.fn(),
  cancelLimitOrderMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: () => ({ limited: false, retryAfterMs: 0 }),
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/db/transactions", () => ({
  getTransaction: getTransactionMock,
  setTransactionStatus: setTransactionStatusMock,
  setTransactionOutcome: setTransactionOutcomeMock,
  updateTransactionRefs: updateTransactionRefsMock,
  addEvent: addEventMock,
}));

vi.mock("@/lib/intents/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intents/orders")>();
  return { ...actual, cancelLimitOrder: cancelLimitOrderMock };
});

import { POST } from "./route";

const TX = "33333333-3333-4333-8333-333333333333";
const USER = "user-1";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const BASE =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const QUOTE =
  "nep141:eth-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.omft.near";
const DEPOSIT = "0x2527d02599ba641c19fea793cd0f167589a0f10d";
const ORDER_ID = "order-abc123";
const DEADLINE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

const session = {
  userId: USER,
  accountKind: "passkey" as const,
  walletId: null,
  passkeyId: "passkey-1",
  intentsAccountId: ACCOUNT,
  chain: "near" as const,
  address: ACCOUNT,
  createdAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
};

function order(overrides: Record<string, unknown> = {}) {
  return {
    orderId: ORDER_ID,
    side: "SELL",
    baseAsset: BASE,
    quoteAsset: QUOTE,
    quantity: "1000000",
    price: "0.5",
    depositAddress: DEPOSIT,
    depositMemo: null,
    depositType: "ORIGIN_CHAIN",
    swapView: {
      swapType: "EXACT_INPUT",
      originAsset: BASE,
      destinationAsset: QUOTE,
      amountIn: "1000000",
      minAmountOut: "500000000000000000",
    },
    fillStatus: "OPEN",
    payoutStatus: "NOT_STARTED",
    isPayoutStatusFinal: false,
    partialFills: [],
    recipient: ACCOUNT,
    recipientType: "DESTINATION_CHAIN",
    refundTo: ACCOUNT,
    refundType: "ORIGIN_CHAIN",
    confidentiality: "basic",
    deadline: DEADLINE,
    ...overrides,
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    tx: {
      id: TX,
      user_id: USER,
      approval_id: "approval-1",
      conversation_id: null,
      state: "pending",
      deposit_address: DEPOSIT,
      workflow_run_id: "run-1",
      recipient: ACCOUNT,
      refund_to: ACCOUNT,
      origin_asset: BASE,
      destination_asset: QUOTE,
      amount_in: "1",
      expected_out: "0.5",
      refs: {
        kind: "limit_order",
        orderId: ORDER_ID,
        mode: "confidential-intents",
        fillStatus: "OPEN",
        payoutStatus: "NOT_STARTED",
        isPayoutStatusFinal: false,
      },
      outcome: {},
      created_at: "2026-11-13T11:00:00.000Z",
      updated_at: "2026-11-13T11:00:00.000Z",
      ...overrides,
    },
    events: [],
  };
}

function request(): Request {
  return new Request(`http://localhost/api/orders/${TX}/cancel`, {
    method: "POST",
  });
}

function params() {
  return { params: Promise.resolve({ id: TX }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue(session);
  getTransactionMock.mockResolvedValue(transaction());
  cancelLimitOrderMock.mockResolvedValue(
    order({ fillStatus: "PENDING_CANCEL" }),
  );
});

describe("POST /api/orders/[id]/cancel", () => {
  it("requests the cancel and records the returned snapshot", async () => {
    const res = await POST(request(), params());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(cancelLimitOrderMock).toHaveBeenCalledWith(ORDER_ID);
    expect(updateTransactionRefsMock).toHaveBeenCalledWith(TX, {
      fillStatus: "PENDING_CANCEL",
      payoutStatus: "NOT_STARTED",
      isPayoutStatusFinal: false,
    });
    expect(setTransactionStatusMock).toHaveBeenCalledWith(
      TX,
      "processing",
      expect.any(String),
      expect.any(Object),
    );
    expect(addEventMock).toHaveBeenCalledWith(
      TX,
      "processing",
      undefined,
      expect.objectContaining({ orderId: ORDER_ID, cancelRequested: true }),
    );
    expect(body).toMatchObject({ ok: true });
    expect(body.order).toMatchObject({
      orderId: ORDER_ID,
      fillStatus: "PENDING_CANCEL",
    });
  });

  it("refuses a record that is not a limit order", async () => {
    getTransactionMock.mockResolvedValue(
      transaction({ refs: { mode: "confidential-intents" } }),
    );

    const res = await POST(request(), params());

    expect(res.status).toBe(404);
    expect(cancelLimitOrderMock).not.toHaveBeenCalled();
  });

  it("returns a plain error when the cancel request fails", async () => {
    cancelLimitOrderMock.mockRejectedValue(new Error("1Click is down"));

    const res = await POST(request(), params());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "The order could not be cancelled. Please try again.",
    });
    expect(setTransactionStatusMock).not.toHaveBeenCalled();
  });
});
