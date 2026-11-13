import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../context";
import { createLimitOrderQuoteTool } from "./quote";

const { getAssetsMock, createQuoteMock } = vi.hoisted(() => ({
  getAssetsMock: vi.fn(),
  createQuoteMock: vi.fn(),
}));

vi.mock("@/lib/intents/service", () => ({
  getAssets: getAssetsMock,
}));

vi.mock("@/lib/db/transactions", () => ({
  createQuote: createQuoteMock,
}));

const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const WETH_ETH = "nep141:eth-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.omft.near";
const WNEAR_NEAR = "nep141:wrap.near";
const SOL_SOL = "nep141:sol.omft.near";

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
  {
    assetId: WNEAR_NEAR,
    symbol: "wNEAR",
    decimals: 24,
    chain: "near",
    price: 3,
    contractAddress: "wrap.near",
  },
  {
    assetId: SOL_SOL,
    symbol: "SOL",
    decimals: 9,
    chain: "sol",
    price: 150,
    contractAddress: "So11111111111111111111111111111111111111112",
  },
];

const passkeyContext: ToolContext = {
  userId: "user-passkey",
  accountKind: "passkey",
  accountId: "0x4f3a000000000000000000000000000000000001",
  intentsAccountId: "0x4f3a000000000000000000000000000000000001",
  activeAddress: "0x4f3a000000000000000000000000000000000001",
  activeChain: "near",
};

const walletContext: ToolContext = {
  userId: "user-wallet",
  accountKind: "wallet",
  intentsAccountId: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  activeAddress: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  activeChain: "evm",
};

type QuoteOutput = {
  quoteId: string | null;
  side: string;
  baseSymbol: string;
  quoteSymbol: string;
  inputAssetId: string;
  outputAssetId: string;
  inputAmount: string;
  outputAmount: string;
  quantityFormatted: string;
  totalFormatted: string;
  price: string;
  funding: string;
  route: string;
  expiresAt: string;
  note?: string;
};

async function run(
  context: ToolContext,
  input: {
    baseAssetId: string;
    quoteAssetId: string;
    side: "BUY" | "SELL";
    quantity: string;
    price: string;
    funding?: "account" | "wallet";
  },
): Promise<QuoteOutput> {
  const quoteTool = createLimitOrderQuoteTool(context);
  return (await quoteTool.execute!(input, {
    toolCallId: "call-limit-order",
    messages: [],
    context: {},
  })) as QuoteOutput;
}

beforeEach(() => {
  getAssetsMock.mockReset();
  getAssetsMock.mockResolvedValue(CATALOGUE);
  createQuoteMock.mockReset();
  createQuoteMock.mockResolvedValue("quote-1");
});

describe("get_limit_order_quote", () => {
  it("refuses the same asset on both sides", async () => {
    await expect(
      run(walletContext, {
        baseAssetId: USDC_BASE,
        quoteAssetId: USDC_BASE,
        side: "SELL",
        quantity: "1000000",
        price: "1",
      }),
    ).rejects.toThrow("The two assets are the same.");
    expect(createQuoteMock).not.toHaveBeenCalled();
  });

  it("refuses wallet funding for a passkey account", async () => {
    await expect(
      run(passkeyContext, {
        baseAssetId: USDC_BASE,
        quoteAssetId: WNEAR_NEAR,
        side: "SELL",
        quantity: "1000000",
        price: "5",
        funding: "wallet",
      }),
    ).rejects.toThrow("This account has no wallet.");
    expect(createQuoteMock).not.toHaveBeenCalled();
  });

  it("prices a SELL from the account and stores the exact quote shape", async () => {
    const result = await run(walletContext, {
      baseAssetId: USDC_BASE,
      quoteAssetId: WNEAR_NEAR,
      side: "SELL",
      quantity: "1000000",
      price: "5",
    });

    expect(result).toMatchObject({
      quoteId: "quote-1",
      side: "SELL",
      baseSymbol: "USDC",
      quoteSymbol: "wNEAR",
      inputAssetId: USDC_BASE,
      outputAssetId: WNEAR_NEAR,
      inputAmount: "1000000",
      outputAmount: "5000000000000000000000000",
      quantityFormatted: "1",
      totalFormatted: "5",
      price: "5",
      funding: "account",
      route: "account",
    });
    // Fifteen minutes, never the order deadline.
    const ttl = Date.parse(result.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);

    expect(createQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-wallet",
        request: {
          kind: "limit_order",
          baseAssetId: USDC_BASE,
          quoteAssetId: WNEAR_NEAR,
          side: "SELL",
          quantity: "1000000",
          price: "5",
          funding: "account",
          accountKind: "wallet",
          intentsAccountId: walletContext.intentsAccountId,
        },
        response: {
          kind: "limit_order",
          inputAssetId: USDC_BASE,
          outputAssetId: WNEAR_NEAR,
          inputAmount: "1000000",
          outputAmount: "5000000000000000000000000",
          baseSymbol: "USDC",
          quoteSymbol: "wNEAR",
          quantityFormatted: "1",
          totalFormatted: "5",
          price: "5",
          deadline: result.expiresAt,
        },
        expiresAt: result.expiresAt,
      }),
    );
  });

  it("prices a BUY from the wallet when both sides are on its chain family", async () => {
    const result = await run(walletContext, {
      baseAssetId: WETH_ETH,
      quoteAssetId: USDC_BASE,
      side: "BUY",
      quantity: "1000000000000000000",
      price: "3000",
      funding: "wallet",
    });

    expect(result).toMatchObject({
      side: "BUY",
      inputAssetId: USDC_BASE,
      outputAssetId: WETH_ETH,
      inputAmount: "3000000000",
      outputAmount: "1000000000000000000",
      quantityFormatted: "1",
      totalFormatted: "3000",
      funding: "wallet",
      route: "wallet",
    });
    expect(result.note).toContain("connected wallet");
  });

  it("refuses a wallet route whose output cannot be delivered there", async () => {
    await expect(
      run(walletContext, {
        baseAssetId: USDC_BASE,
        quoteAssetId: SOL_SOL,
        side: "SELL",
        quantity: "1000000",
        price: "150",
        funding: "wallet",
      }),
    ).rejects.toThrow("Place the order from the Near Account instead.");
    expect(createQuoteMock).not.toHaveBeenCalled();
  });

  it("refuses a wallet route whose input chain is elsewhere", async () => {
    await expect(
      run(walletContext, {
        baseAssetId: SOL_SOL,
        quoteAssetId: USDC_BASE,
        side: "SELL",
        quantity: "1000000000",
        price: "150",
        funding: "wallet",
      }),
    ).rejects.toThrow("cannot be funded from this EVM wallet");
  });

  it("still prices without a stored row when no user is signed in", async () => {
    const result = await run(
      {
        accountKind: "wallet",
        intentsAccountId: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
        activeAddress: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
        activeChain: "evm",
      },
      {
        baseAssetId: USDC_BASE,
        quoteAssetId: WNEAR_NEAR,
        side: "SELL",
        quantity: "1000000",
        price: "5",
      },
    );

    expect(result.quoteId).toBeNull();
    expect(createQuoteMock).not.toHaveBeenCalled();
  });
});
