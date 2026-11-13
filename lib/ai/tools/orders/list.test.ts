import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../context";
import { createGetLimitOrdersTool } from "./list";

const { listMock, getAssetsMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getAssetsMock: vi.fn(),
}));

vi.mock("@/lib/db/transactions", () => ({
  listLimitOrderTransactions: listMock,
}));

vi.mock("@/lib/intents/service", () => ({
  getAssets: getAssetsMock,
}));

const USDC_BASE =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const WETH_ETH =
  "nep141:eth-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.omft.near";

const CATALOGUE = [
  {
    assetId: USDC_BASE,
    symbol: "USDC",
    decimals: 6,
    chain: "base",
    price: 1,
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  {
    assetId: WETH_ETH,
    symbol: "WETH",
    decimals: 18,
    chain: "eth",
    price: 3000,
    contractAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  },
];

function sellRow() {
  return {
    id: "tx-sell",
    state: "processing",
    refs: {
      kind: "limit_order",
      orderId: "order-sell",
      side: "SELL",
      baseAsset: USDC_BASE,
      quoteAsset: WETH_ETH,
      quantity: "1000000",
      price: "0.5",
      swapView: {
        swapType: "EXACT_INPUT",
        originAsset: USDC_BASE,
        destinationAsset: WETH_ETH,
        amountIn: "1000000",
        minAmountOut: "500000000000000000",
      },
      fillStatus: "PARTIALLY_FILLED",
      payoutStatus: "IN_PROGRESS",
      deadline: "2026-11-20T11:28:18.215Z",
    },
    outcome: {
      filledAmountIn: "500000",
      filledAmountOut: "250000000000000000",
    },
    created_at: "2026-11-13T11:00:00.000Z",
    updated_at: "2026-11-13T11:00:00.000Z",
  };
}

function buyRow() {
  return {
    id: "tx-buy",
    state: "pending",
    refs: {
      kind: "limit_order",
      orderId: "order-buy",
      side: "BUY",
      baseAsset: WETH_ETH,
      quoteAsset: USDC_BASE,
      quantity: "1000000000000000000",
      price: "3000",
      swapView: {
        swapType: "EXACT_OUTPUT",
        originAsset: USDC_BASE,
        destinationAsset: WETH_ETH,
        maxAmountIn: "3000000000",
        amountOut: "1000000000000000000",
      },
      fillStatus: "OPEN",
      payoutStatus: "NOT_STARTED",
      deadline: "2026-11-20T11:28:18.215Z",
    },
    outcome: {},
    created_at: "2026-11-13T10:00:00.000Z",
    updated_at: "2026-11-13T10:00:00.000Z",
  };
}

const options = { toolCallId: "call-1", messages: [], context: {} };

async function run(context: ToolContext = { userId: "user-1" }) {
  const listTool = createGetLimitOrdersTool(context);
  return (await listTool.execute!({}, options)) as {
    orders: Array<Record<string, unknown>>;
    note?: string;
  };
}

beforeEach(() => {
  listMock.mockReset();
  getAssetsMock.mockReset();
  listMock.mockResolvedValue([sellRow(), buyRow()]);
  getAssetsMock.mockResolvedValue(CATALOGUE);
});

describe("get_limit_orders", () => {
  it("returns the latest ten with symbols and formatted figures", async () => {
    const result = await run();

    expect(listMock).toHaveBeenCalledWith("user-1", 10);
    expect(getAssetsMock).toHaveBeenCalledTimes(1);
    expect(result.orders[0]).toMatchObject({
      id: "tx-sell",
      state: "processing",
      side: "SELL",
      baseSymbol: "USDC",
      quoteSymbol: "WETH",
      quantity: "1",
      price: "0.5",
      output: "0.5",
      orderId: "order-sell",
      fillStatus: "PARTIALLY_FILLED",
      payoutStatus: "IN_PROGRESS",
      filled: "0.5",
      deadline: "2026-11-20T11:28:18.215Z",
      createdAt: "2026-11-13T11:00:00.000Z",
    });
    expect(result.orders[1]).toMatchObject({
      id: "tx-buy",
      side: "BUY",
      quantity: "1",
      price: "3000",
      output: "1",
      filled: null,
    });
  });

  it("refuses to read another account's orders without a session", async () => {
    const result = await run({});

    expect(result.orders).toEqual([]);
    expect(result.note).toContain("no order record");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("reports a record-read failure as a sentence", async () => {
    listMock.mockRejectedValue(new Error("database down"));

    const result = await run();

    expect(result.orders).toEqual([]);
    expect(result.note).toContain("could not be read");
  });
});
