import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAssetsMock, quoteMock, createQuoteMock, resolveNameMock } = vi.hoisted(() => ({
  getAssetsMock: vi.fn(),
  quoteMock: vi.fn(),
  createQuoteMock: vi.fn(),
  resolveNameMock: vi.fn(),
}));

vi.mock("@/lib/intents/service", () => ({
  getAssets: getAssetsMock,
  quote: quoteMock,
}));

vi.mock("@/lib/adapters/registry", () => ({
  getNameResolverPort: () => ({ resolveName: resolveNameMock }),
}));

vi.mock("@/lib/db/transactions", () => ({
  createQuote: createQuoteMock,
}));

import {
  createGetWithdrawalQuoteTool,
  GET_WITHDRAWAL_QUOTE_CAPABILITY,
  getWithdrawalQuoteInputSchema,
} from "./withdraw-quote";

const ASSET =
  "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";
const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
const ACCOUNT = "0xb0b14cd82e1f0e6ee391ae3a31a0173aff8373b1";
const EXPIRES_AT = "2026-11-05T11:28:18.215Z";

function catalogue(chain = "arb") {
  return [
    {
      assetId: ASSET,
      symbol: "USDC",
      decimals: 6,
      chain,
      price: 1,
      contractAddress: "0xaf88",
    },
  ];
}

function priced() {
  return {
    engine: "intents" as const,
    fromAssetId: ASSET,
    toAssetId: ASSET,
    amountIn: "500000",
    amountInFormatted: "0.5",
    amountOut: "489400",
    amountOutFormatted: "0.4894",
    minAmountOut: "0.484506",
    minAmountOutRaw: "484506",
    amountOutUsd: "0.49",
    feeBps: 0,
    rate: 0.9788,
    withdrawFee: "10600",
    withdrawFeeFormatted: "0.0106",
    expiresAt: EXPIRES_AT,
    warnings: [],
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    accountKind: "passkey" as const,
    intentsAccountId: ACCOUNT,
    ...overrides,
  };
}

async function run(
  input: Record<string, unknown> = {},
  toolContext = context(),
) {
  const tool = createGetWithdrawalQuoteTool(toolContext);
  return tool.execute!(
    {
      fromAssetId: ASSET,
      amount: "500000",
      destinationAddress: DESTINATION,
      ...input,
    },
    { toolCallId: "call-withdraw-quote", messages: [], context: {} },
  );
}

describe("get_withdrawal_quote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssetsMock.mockResolvedValue(catalogue());
    quoteMock.mockResolvedValue(priced());
    createQuoteMock.mockResolvedValue("quote-1");
  });

  it("is a read-public capability with no approval", () => {
    expect(GET_WITHDRAWAL_QUOTE_CAPABILITY).toMatchObject({
      tool: "get_withdrawal_quote",
      tier: "read-public",
      subject: "none",
      approval: "none",
      attribution: "none",
    });
  });

  it("prices the measured withdrawal shape and stores the server topology", async () => {
    const result = await run();

    expect(quoteMock).toHaveBeenCalledWith({
      fromAssetId: ASSET,
      toAssetId: ASSET,
      amount: "500000",
      recipient: DESTINATION,
      refundTo: ACCOUNT,
      slippageBps: 100,
      confidentiality: "basic",
      mode: "confidential-withdrawal",
    });

    expect(createQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        expiresAt: EXPIRES_AT,
        request: expect.objectContaining({
          fromAssetId: ASSET,
          toAssetId: ASSET,
          amount: "500000",
          recipient: DESTINATION,
          refundTo: ACCOUNT,
          mode: "confidential-withdrawal",
          recipientType: "DESTINATION_CHAIN",
          refundType: "CONFIDENTIAL_INTENTS",
          destination: DESTINATION,
          destinationChain: "arb",
          accountKind: "passkey",
          intentsAccountId: ACCOUNT,
        }),
      }),
    );

    expect(result).toMatchObject({
      quoteId: "quote-1",
      amountIn: "0.5",
      amountOut: "0.4894",
      minAmountOut: "0.484506",
      withdrawFee: "10600",
      withdrawFeeFormatted: "0.0106",
      destination: DESTINATION,
      destinationChain: "arb",
      expiresAt: EXPIRES_AT,
    });
    expect(result).not.toHaveProperty("balances");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("confidential");
  });

  it("normalises a lowercase destination to EIP-55 before pricing", async () => {
    await run({ destinationAddress: DESTINATION.toLowerCase() });

    expect(quoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: DESTINATION }),
    );
    expect(createQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ destination: DESTINATION }),
      }),
    );
  });

  it("defaults the destination asset to the asset leaving the account", async () => {
    await run();

    expect(quoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ toAssetId: ASSET }),
    );
  });

  it("refuses a non-EVM destination chain without pricing it", async () => {
    getAssetsMock.mockResolvedValue(catalogue("sol"));

    await expect(run()).rejects.toThrow(
      "Withdrawals to sol are not available yet. Use an EVM destination.",
    );
    expect(quoteMock).not.toHaveBeenCalled();
    expect(createQuoteMock).not.toHaveBeenCalled();
  });

  it("refuses an asset the catalogue does not know", async () => {
    getAssetsMock.mockResolvedValue([]);

    await expect(run()).rejects.toThrow(
      "That asset is not in the catalogue.",
    );
    expect(quoteMock).not.toHaveBeenCalled();
  });

  it("refuses an invalid address on a supported chain", async () => {
    await expect(run({ destinationAddress: "0xnot-an-address" })).rejects.toThrow(
      "The destination is not a valid address on arb.",
    );
    expect(quoteMock).not.toHaveBeenCalled();
  });

  it("resolves a destination name and binds the address", async () => {
    resolveNameMock.mockResolvedValue({
      address: DESTINATION,
      name: "vitalik.eth",
      resolvedAt: EXPIRES_AT,
    });

    const result = await run({ destinationAddress: "vitalik.eth" });

    expect(resolveNameMock).toHaveBeenCalledWith("evm", "vitalik.eth");
    expect(quoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: DESTINATION }),
    );
    expect(createQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          destination: DESTINATION,
          destinationName: "vitalik.eth",
          destinationResolvedAt: EXPIRES_AT,
        }),
      }),
    );
    expect(result).toMatchObject({
      destination: DESTINATION,
      destinationName: "vitalik.eth",
    });
  });

  it("asks for the destination when the name is not registered", async () => {
    resolveNameMock.mockResolvedValue(null);

    await expect(run({ destinationAddress: "nobody.eth" })).rejects.toThrow(
      "That name is not registered. Ask the user for the full destination address.",
    );
    expect(quoteMock).not.toHaveBeenCalled();
    expect(createQuoteMock).not.toHaveBeenCalled();
  });

  it("requires the session's Intents account", async () => {
    await expect(run({}, context({ intentsAccountId: null }))).rejects.toThrow(
      "The account is not available.",
    );
    expect(quoteMock).not.toHaveBeenCalled();
  });

  it("still prices a logged-out preview and stores no quote", async () => {
    const result = await run({}, context({ userId: null }));

    expect(quoteMock).toHaveBeenCalledTimes(1);
    expect(createQuoteMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ quoteId: null });
  });

  it("requires a positive whole amount and a destination", () => {
    for (const amount of ["0", "-1", "1.5", "", "01", "1e6"]) {
      expect(
        getWithdrawalQuoteInputSchema.safeParse({
          fromAssetId: ASSET,
          amount,
          destinationAddress: DESTINATION,
        }).success,
        amount,
      ).toBe(false);
    }
    expect(
      getWithdrawalQuoteInputSchema.safeParse({
        fromAssetId: ASSET,
        amount: "1",
        destinationAddress: "",
      }).success,
    ).toBe(false);
    expect(
      getWithdrawalQuoteInputSchema.safeParse({
        fromAssetId: ASSET,
        amount: "1",
        destinationAddress: DESTINATION,
      }).success,
    ).toBe(true);
  });
});
