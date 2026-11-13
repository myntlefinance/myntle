import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  getTransactionMock,
  setTransactionStateMock,
  setTransactionStatusMock,
  setTransactionOutcomeMock,
  updateTransactionRefsMock,
  addEventMock,
  getStatusMock,
  getLimitOrderMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  getTransactionMock: vi.fn(),
  setTransactionStateMock: vi.fn(),
  setTransactionStatusMock: vi.fn(),
  setTransactionOutcomeMock: vi.fn(),
  updateTransactionRefsMock: vi.fn(),
  addEventMock: vi.fn(),
  getStatusMock: vi.fn(),
  getLimitOrderMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/db/transactions", () => ({
  getTransaction: getTransactionMock,
  setTransactionState: setTransactionStateMock,
  setTransactionStatus: setTransactionStatusMock,
  setTransactionOutcome: setTransactionOutcomeMock,
  updateTransactionRefs: updateTransactionRefsMock,
  addEvent: addEventMock,
}));

vi.mock("@/lib/intents/service", () => ({
  getStatus: getStatusMock,
}));

vi.mock("@/lib/intents/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intents/orders")>();
  return { ...actual, getLimitOrder: getLimitOrderMock };
});

import { GET } from "./route";

const TX = "33333333-3333-4333-8333-333333333333";
const USER = "user-1";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const WALLET = "0x32596df10ff2ac5acde8406e6adcc8d047921073";
const BASE =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const QUOTE =
  "nep141:eth-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.omft.near";
const DEPOSIT = "0x2527d02599ba641c19fea793cd0f167589a0f10d";
const ORDER_ID = "order-abc123";
const DEADLINE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

const session = {
  userId: USER,
  accountKind: "wallet" as const,
  walletId: "wallet-1",
  passkeyId: null,
  intentsAccountId: ACCOUNT,
  chain: "evm" as const,
  address: WALLET,
  createdAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
};

const order = {
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
  recipient: WALLET,
  recipientType: "DESTINATION_CHAIN",
  refundTo: WALLET,
  refundType: "ORIGIN_CHAIN",
  confidentiality: "basic",
  deadline: DEADLINE,
};

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: TX,
    user_id: USER,
    approval_id: "approval-1",
    conversation_id: null,
    state: "submitted",
    deposit_address: DEPOSIT,
    workflow_run_id: "run-1",
    recipient: WALLET,
    refund_to: WALLET,
    origin_asset: BASE,
    destination_asset: QUOTE,
    amount_in: "1",
    expected_out: "0.5",
    refs: {
      kind: "limit_order",
      orderId: ORDER_ID,
      mode: "confidential-intents",
      standard: "erc191",
      signerId: ACCOUNT,
      intentPayload: '{"signed":"material"}',
      intentDepositAddress: DEPOSIT,
      amountInRaw: "1000000",
      assetId: BASE,
      deadline: DEADLINE,
      side: "SELL",
      baseAsset: BASE,
      quoteAsset: QUOTE,
      quantity: "1000000",
      price: "0.5",
      depositType: "ORIGIN_CHAIN",
      swapView: order.swapView,
      fillStatus: "AWAITING_DEPOSIT",
      payoutStatus: "NOT_STARTED",
      isPayoutStatusFinal: false,
    },
    outcome: {},
    created_at: "2026-11-13T11:00:00.000Z",
    updated_at: "2026-11-13T11:00:00.000Z",
    ...overrides,
  };
}

function request(query = ""): Request {
  return new Request(`http://localhost/api/tx/${TX}${query}`);
}

function params() {
  return { params: Promise.resolve({ id: TX }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue(session);
  getTransactionMock.mockResolvedValue({ tx: transaction(), events: [] });
  getLimitOrderMock.mockResolvedValue(order);
});

describe("GET /api/tx/[id] for a limit order", () => {
  it("refreshes from the order endpoint and never calls the swap status", async () => {
    const res = await GET(request("?refresh=1"), params());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(getLimitOrderMock).toHaveBeenCalledWith(ORDER_ID);
    expect(getStatusMock).not.toHaveBeenCalled();
    expect(updateTransactionRefsMock).toHaveBeenCalledWith(TX, {
      fillStatus: "OPEN",
      payoutStatus: "NOT_STARTED",
      isPayoutStatusFinal: false,
    });
    // AWAITING_DEPOSIT -> OPEN is submitted -> pending.
    expect(setTransactionStatusMock).toHaveBeenCalledWith(
      TX,
      "pending",
      expect.any(String),
      expect.objectContaining({
        orderId: ORDER_ID,
        fillStatus: "OPEN",
        payoutStatus: "NOT_STARTED",
      }),
    );
    expect(addEventMock).toHaveBeenCalledWith(
      TX,
      "pending",
      undefined,
      expect.objectContaining({ orderId: ORDER_ID }),
    );
    expect(body).toMatchObject({
      id: TX,
      transactionId: TX,
      state: "pending",
      statusCheck: "ok",
      kind: "limit_order",
    });
    expect(body.order).toMatchObject({ orderId: ORDER_ID, fillStatus: "OPEN" });
    // Safe refs only. The signed payload never leaves the server.
    expect(body.refs).toMatchObject({ kind: "limit_order", orderId: ORDER_ID });
    expect(JSON.stringify(body)).not.toContain("signed");
  });

  it("does not call 1Click without the refresh flag", async () => {
    const body = (await (await GET(request(), params())).json()) as Record<
      string,
      unknown
    >;

    expect(getLimitOrderMock).not.toHaveBeenCalled();
    expect(getStatusMock).not.toHaveBeenCalled();
    expect(body.statusCheck).toBe("skipped");
    expect(body.state).toBe("submitted");
    expect(body.order).toBeNull();
  });

  it("does not refresh a record whose intent is not signed yet", async () => {
    getTransactionMock.mockResolvedValue({
      tx: transaction({ state: "awaiting_approval" }),
      events: [],
    });

    const body = (await (await GET(request("?refresh=1"), params())).json()) as Record<
      string,
      unknown
    >;

    expect(getLimitOrderMock).not.toHaveBeenCalled();
    expect(setTransactionStatusMock).not.toHaveBeenCalled();
    expect(body.statusCheck).toBe("skipped");
    expect(body.state).toBe("awaiting_approval");
  });

  it("keeps the stored record when the order read is unavailable", async () => {
    getLimitOrderMock.mockRejectedValue(new Error("1Click is down"));

    const body = (await (await GET(request("?refresh=1"), params())).json()) as Record<
      string,
      unknown
    >;

    expect(body.statusCheck).toBe("unavailable");
    expect(body.state).toBe("submitted");
    expect(setTransactionStatusMock).not.toHaveBeenCalled();
  });
});
