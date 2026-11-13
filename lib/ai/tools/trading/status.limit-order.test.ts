import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTransactionStatusTool, transactionStatusInputSchema } from "./status";

const {
  findStatusRecordsMock,
  getAssetsMock,
  getStatusMock,
  getLimitOrderMock,
} = vi.hoisted(() => ({
  findStatusRecordsMock: vi.fn(),
  getAssetsMock: vi.fn(),
  getStatusMock: vi.fn(),
  getLimitOrderMock: vi.fn(),
}));

vi.mock("@/lib/db/transactions", () => ({
  findStatusRecords: findStatusRecordsMock,
}));

vi.mock("@/lib/intents/service", () => ({
  getAssets: getAssetsMock,
  getStatus: getStatusMock,
  oneClickHeaders: () => ({ "Content-Type": "application/json" }),
}));

vi.mock("@/lib/intents/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intents/orders")>();
  return { ...actual, getLimitOrder: getLimitOrderMock };
});

const BASE =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const QUOTE =
  "nep141:eth-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.omft.near";
const DEPOSIT = "0x2527d02599ba641c19fea793cd0f167589a0f10d";
const ORDER_ID = "order-abc123";

const record = {
  id: "tx-1",
  state: "submitted",
  depositAddress: DEPOSIT,
  depositMemo: null,
  expiresAt: null,
  originAsset: BASE,
  destinationAsset: QUOTE,
  amountIn: "1",
  expectedOut: "0.5",
  amountOut: null,
  explorerUrls: [],
  createdAt: "2026-11-13T11:00:00.000Z",
  kind: "limit_order",
  orderId: ORDER_ID,
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
  fillStatus: "PARTIALLY_FILLED",
  payoutStatus: "IN_PROGRESS",
  isPayoutStatusFinal: false,
  partialFills: [
    {
      id: "fill-1",
      amountIn: "500000",
      amountOut: "250000000000000000",
      createdAt: "2026-11-13T12:00:00.000Z",
      updatedAt: "2026-11-13T12:00:05.000Z",
    },
  ],
  recipient: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  recipientType: "DESTINATION_CHAIN",
  refundTo: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  refundType: "ORIGIN_CHAIN",
  confidentiality: "basic",
};

const options = { toolCallId: "call-1", messages: [], context: {} };

async function run() {
  const tool = createTransactionStatusTool({ userId: "user-1" });
  return (await tool.execute!(
    transactionStatusInputSchema.parse({ transactionId: "tx-1" }),
    options,
  )) as {
    state: string;
    transactions: Array<Record<string, unknown>>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findStatusRecordsMock.mockResolvedValue([record]);
  getAssetsMock.mockResolvedValue([
    { assetId: BASE, symbol: "USDC" },
    { assetId: QUOTE, symbol: "WETH" },
  ]);
  getLimitOrderMock.mockResolvedValue(order);
});

describe("get_transaction_status for a limit order", () => {
  it("reads the order endpoint and never calls the swap status", async () => {
    const result = await run();

    expect(getLimitOrderMock).toHaveBeenCalledWith(ORDER_ID);
    expect(getStatusMock).not.toHaveBeenCalled();
    expect(result.state).toBe("processing");
    expect(result.transactions[0]).toMatchObject({
      id: "tx-1",
      state: "processing",
      recordState: "submitted",
      orderId: ORDER_ID,
      side: "SELL",
      quantity: "1000000",
      price: "0.5",
      fillStatus: "PARTIALLY_FILLED",
      payoutStatus: "IN_PROGRESS",
      isPayoutStatusFinal: false,
      partialFillCount: 1,
      filledAmountIn: "500000",
      filledAmountOut: "250000000000000000",
      originSymbol: "USDC",
      destinationSymbol: "WETH",
    });
  });

  it("falls back to the stored record when the order read fails", async () => {
    getLimitOrderMock.mockRejectedValue(new Error("1Click is down"));

    const result = await run();

    expect(getStatusMock).not.toHaveBeenCalled();
    expect(result.state).toBe("submitted");
    expect(result.transactions[0]).toMatchObject({
      state: "submitted",
      statusError:
        "The live order check is unavailable; this is the stored record.",
    });
  });
});
