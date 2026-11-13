import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTransactionStatusTool,
  GET_TRANSACTION_STATUS_CAPABILITY,
  transactionStatusInputSchema,
} from "./status";
import { createTools } from "../registry";

const state = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  selectors: [] as Array<Record<string, unknown>>,
  live: new Map<string, Record<string, unknown>>(),
  failures: new Set<string>(),
  assets: [] as Array<{ assetId: string; symbol: string }>,
  calls: [] as Array<{
    depositAddress: string;
    depositMemo: string | null;
    originAssetId: string | null;
    destinationAssetId: string | null;
  }>,
  readError: false,
}));

vi.mock("@/lib/db/transactions", () => ({
  findStatusRecords: async (
    _userId: string,
    selector: Record<string, unknown>,
  ) => {
    state.selectors.push(selector);
    if (state.readError) throw new Error("read failed");
    return state.records;
  },
}));

vi.mock("@/lib/intents/service", () => ({
  getAssets: async () => state.assets,
  getStatus: async (
    depositAddress: string,
    depositMemo: string | null,
    assets?: {
      originAssetId?: string | null;
      destinationAssetId?: string | null;
    },
  ) => {
    state.calls.push({
      depositAddress,
      depositMemo,
      originAssetId: assets?.originAssetId ?? null,
      destinationAssetId: assets?.destinationAssetId ?? null,
    });
    if (state.failures.has(depositAddress)) {
      throw new Error("status unavailable");
    }
    return state.live.get(depositAddress);
  },
}));

const ORIGIN =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DESTINATION =
  "nep141:eth-0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9.omft.near";

const record = {
  id: "tx-1",
  state: "failed",
  depositAddress: "deposit-1",
  depositMemo: "memo-1",
  originAsset: ORIGIN,
  destinationAsset: DESTINATION,
  amountIn: "5.0",
  expectedOut: "0.044957",
  amountOut: null,
  explorerUrls: [],
  createdAt: "2026-11-13T10:45:12.402Z",
};

const live = {
  state: "failed",
  status: "FAILED",
  depositedAmount: "5.0",
  refundedAmount: "0",
  updatedAt: "2026-11-13T10:45:51.000Z",
  depositAddress: "deposit-1",
  explorerUrls: [],
};

const options = { toolCallId: "call-1", messages: [], context: {} };

type StatusResult = {
  state?: string;
  note?: string;
  transactions: Array<{
    id: string;
    state: string;
    recordState: string;
    settlementStatus?: string;
    depositedAmount?: string;
    refundedAmount?: string;
    expectedOut?: string | null;
    amountIn?: string;
    originSymbol?: string;
    destinationSymbol?: string;
    statusError?: string;
  }>;
};

/** Mirrors the SDK: parse the input before execute receives its defaults. */
async function run(
  tool: ReturnType<typeof createTransactionStatusTool>,
  input: Record<string, unknown>,
): Promise<StatusResult> {
  return (await tool.execute!(
    transactionStatusInputSchema.parse(input),
    options,
  )) as StatusResult;
}

beforeEach(() => {
  state.records = [record];
  state.selectors = [];
  state.calls = [];
  state.failures.clear();
  state.readError = false;
  state.assets = [
    { assetId: ORIGIN, symbol: "USDC" },
    { assetId: DESTINATION, symbol: "AAVE" },
  ];
  state.live = new Map([["deposit-1", live]]);
});

describe("get_transaction_status", () => {
  it("is a private read registered in both the portfolio and trading domains", () => {
    expect(GET_TRANSACTION_STATUS_CAPABILITY).toMatchObject({
      tool: "get_transaction_status",
      tier: "read-private",
      subject: "session",
      approval: "none",
    });

    const context = {
      userId: "user-1",
      activeAddress: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
      activeChain: "evm",
    };
    expect(
      createTools(context, { domains: ["portfolio"] }).get_transaction_status,
    ).toBeDefined();
    expect(
      createTools(context, { domains: ["trading"] }).get_transaction_status,
    ).toBeDefined();
    expect(
      createTools(context, { domains: ["news"] }).get_transaction_status,
    ).toBeUndefined();
  });

  it("checks the account's newest trades when the user named none", async () => {
    const tool = createTransactionStatusTool({ userId: "user-1" });
    const result = await run(tool, { limit: 3 });

    expect(state.selectors).toEqual([{ limit: 3 }]);
    expect(state.calls).toEqual([
      {
        depositAddress: "deposit-1",
        depositMemo: "memo-1",
        originAssetId: ORIGIN,
        destinationAssetId: DESTINATION,
      },
    ]);
    expect(result).toMatchObject({
      state: "failed",
      transactions: [
        {
          id: "tx-1",
          state: "failed",
          recordState: "failed",
          settlementStatus: "FAILED",
          depositedAmount: "5.0",
          refundedAmount: "0",
          expectedOut: "0.044957",
          originSymbol: "USDC",
          destinationSymbol: "AAVE",
        },
      ],
    });
  });

  it("scopes a named transaction by id, and a named address by address", async () => {
    const tool = createTransactionStatusTool({ userId: "user-1" });

    await run(tool, { transactionId: "tx-1" });
    await run(tool, { depositAddress: "deposit-1" });
    await run(tool, {});

    expect(state.selectors).toEqual([
      { id: "tx-1", limit: 3 },
      { depositAddress: "deposit-1", limit: 3 },
      { limit: 3 },
    ]);
  });

  it("does not call 1Click for a trade the user has not submitted", async () => {
    state.records = [{ ...record, state: "awaiting_approval" }];
    const tool = createTransactionStatusTool({ userId: "user-1" });

    const result = await run(tool, {});

    expect(state.calls).toEqual([]);
    expect(result).toMatchObject({
      state: "awaiting_approval",
      transactions: [
        {
          state: "awaiting_approval",
          recordState: "awaiting_approval",
          note: "This trade has not been submitted yet; it is waiting for the user's approval or signature.",
        },
      ],
    });
  });

  it("keeps a closed funding window closed when 1Click still says pending", async () => {
    state.records = [{ ...record, state: "expired" }];
    state.live = new Map([
      [
        "deposit-1",
        { ...live, state: "pending", status: "PENDING_DEPOSIT" },
      ],
    ]);
    const tool = createTransactionStatusTool({ userId: "user-1" });

    const result = await run(tool, {});

    expect(result).toMatchObject({
      state: "expired",
      transactions: [
        {
          state: "expired",
          recordState: "expired",
          settlementStatus: "PENDING_DEPOSIT",
        },
      ],
    });
  });

  it("falls back to the stored record when the live check is unavailable", async () => {
    state.failures.add("deposit-1");
    const tool = createTransactionStatusTool({ userId: "user-1" });

    const result = await run(tool, {});

    expect(result).toMatchObject({
      state: "failed",
      transactions: [
        {
          id: "tx-1",
          state: "failed",
          recordState: "failed",
          amountIn: "5.0",
          statusError:
            "The live settlement check is unavailable; this is the stored record.",
        },
      ],
    });
    expect(result.transactions[0]).not.toHaveProperty("settlementStatus");
  });

  it("refuses to read a record with no signed-in account", async () => {
    const tool = createTransactionStatusTool();

    await expect(run(tool, {})).resolves.toEqual({
      transactions: [],
      note: "No signed-in account is attached to this conversation, so there is no transaction record to check.",
    });
    expect(state.selectors).toEqual([]);
  });

  it("reports a missing record instead of inventing a status", async () => {
    state.records = [];
    const tool = createTransactionStatusTool({ userId: "user-1" });

    await expect(
      run(tool, { transactionId: "tx-missing" }),
    ).resolves.toEqual({
      transactions: [],
      note: "No trade in this account's record matches that reference.",
    });
  });

  it("reports a record-read failure as a sentence, not a crash", async () => {
    state.readError = true;
    const tool = createTransactionStatusTool({ userId: "user-1" });

    await expect(run(tool, {})).resolves.toEqual({
      transactions: [],
      note: "The transaction record could not be read just now.",
    });
  });

  it("caps the default check at the documented limit", () => {
    expect(
      transactionStatusInputSchema.safeParse({ limit: 6 }).success,
    ).toBe(false);
    expect(
      transactionStatusInputSchema.safeParse({ limit: 0 }).success,
    ).toBe(false);
    expect(transactionStatusInputSchema.parse({}).limit).toBe(3);
  });
});
