import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeEvmAddress } from "@/lib/intents/destination";
import { intentsAccountId } from "@/lib/intents/balances";
import type { ToolContext } from "../context";
import { createQuoteTool } from "./quote";

const {
  quoteMock,
  createQuoteMock,
  findUserIdByWalletMock,
  resolveNameMock,
  getAssetsMock,
} = vi.hoisted(() => ({
  quoteMock: vi.fn(),
  createQuoteMock: vi.fn(),
  findUserIdByWalletMock: vi.fn(),
  resolveNameMock: vi.fn(),
  getAssetsMock: vi.fn(),
}));

vi.mock("@/lib/intents/service", () => ({
  quote: quoteMock,
  getAssets: getAssetsMock,
}));
vi.mock("@/lib/db/transactions", () => ({ createQuote: createQuoteMock }));
vi.mock("@/lib/adapters/registry", () => ({
  getNameResolverPort: () => ({ resolveName: resolveNameMock }),
}));
vi.mock("@/lib/db/wallets", () => ({
  findUserIdByWallet: findUserIdByWalletMock,
}));

const priced = {
  engine: "intents" as const,
  fromAssetId: "nep141:usdc",
  toAssetId: "nep141:usdc-base",
  amountIn: "25000000",
  amountInFormatted: "25",
  amountOut: "10000000000000000000000000",
  amountOutFormatted: "10",
  minAmountOut: "9.9",
  minAmountOutRaw: "9900000000000000000000000",
  amountOutUsd: "24.9",
  feeBps: 0,
  rate: 0.4,
  expiresAt: "2026-11-02T12:30:00.000Z",
  warnings: [],
};

async function run(
  context: ToolContext,
  input: {
    fromAssetId?: string;
    toAssetId?: string;
    amount?: string;
    funding?: "account" | "wallet";
    recipient?: string;
    refundTo?: string;
  } = {},
) {
  const quoteTool = createQuoteTool(context);
  const result = await quoteTool.execute!(
    {
      fromAssetId: "nep141:usdc",
      toAssetId: "nep141:usdc-base",
      amount: "25000000",
      slippageBps: 100,
      ...input,
    },
    { toolCallId: "call-quote", messages: [], context: {} },
  );
  return result as Record<string, unknown>;
}

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

const WALLET_ADDRESS = normalizeEvmAddress(walletContext.activeAddress) as string;

const CATALOGUE = [
  {
    assetId: "nep141:usdc",
    symbol: "USDC",
    decimals: 6,
    chain: "eth",
    price: 1,
    contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  {
    assetId: "nep141:usdc-base",
    symbol: "USDC",
    decimals: 6,
    chain: "base",
    price: 1,
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  {
    assetId: "nep141:wrap.near",
    symbol: "wNEAR",
    decimals: 24,
    chain: "near",
    price: 3,
    contractAddress: "wrap.near",
  },
  {
    assetId: "nep141:near-usdc",
    symbol: "USDC",
    decimals: 6,
    chain: "near",
    price: 1,
    contractAddress: "usdc.near",
  },
  {
    assetId: "nep141:bnb-near",
    symbol: "NEAR",
    decimals: 18,
    chain: "bsc",
    price: 3,
    contractAddress: "0x1fa4a73a3f0133f0025378af00236f3abdee5d63",
  },
];

beforeEach(() => {
  quoteMock.mockResolvedValue(priced);
  createQuoteMock.mockResolvedValue("quote-1");
  findUserIdByWalletMock.mockResolvedValue("wallet-user");
  getAssetsMock.mockResolvedValue(CATALOGUE);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("get_quote funding", () => {
  it("prices a passkey account from the Near Account for the account itself", async () => {
    const result = await run(passkeyContext, {
      recipient: "0xMODEL_SUPPLIED",
      refundTo: "0xMODEL_SUPPLIED",
    });

    expect(quoteMock).toHaveBeenCalledTimes(1);
    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      recipient: passkeyContext.intentsAccountId,
      refundTo: passkeyContext.intentsAccountId,
      confidentiality: "basic",
      mode: "confidential-intents",
    });
    expect(result.route).toBe("account");
    expect(result.quoteId).toBe("quote-1");
    expect(result.minAmountOut).toBe("9.9");
  });

  it("never hands the model the internal mode or the feature name", async () => {
    const result = await run(passkeyContext);

    expect(result).not.toHaveProperty("mode");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("confidential");
  });

  it("stores a passkey dry quote by the session user, not by a wallet", async () => {
    await run(passkeyContext);

    expect(findUserIdByWalletMock).not.toHaveBeenCalled();
    expect(createQuoteMock).toHaveBeenCalledTimes(1);

    const saved = createQuoteMock.mock.calls[0][0] as {
      userId: string;
      request: Record<string, unknown>;
    };
    expect(saved.userId).toBe("user-passkey");
    expect(saved.request).toEqual({
      fromAssetId: "nep141:usdc",
      toAssetId: "nep141:usdc-base",
      amount: "25000000",
      recipient: passkeyContext.intentsAccountId,
      refundTo: passkeyContext.intentsAccountId,
      slippageBps: 100,
      confidentiality: "basic",
      mode: "confidential-intents",
      accountKind: "passkey",
      intentsAccountId: passkeyContext.intentsAccountId,
    });
  });

  it("defaults a wallet session to the Near Account", async () => {
    const result = await run(walletContext);

    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      recipient: walletContext.intentsAccountId,
      refundTo: walletContext.intentsAccountId,
      confidentiality: "basic",
      mode: "confidential-intents",
    });
    expect(result.route).toBe("account");

    const saved = createQuoteMock.mock.calls[0][0] as {
      userId: string;
      request: Record<string, unknown>;
    };
    expect(saved.userId).toBe("user-wallet");
    expect(saved.request).toMatchObject({
      confidentiality: "basic",
      mode: "confidential-intents",
      accountKind: "wallet",
      intentsAccountId: walletContext.intentsAccountId,
    });
  });

  it("keeps an explicit wallet request on the chain route", async () => {
    const result = await run(walletContext, { funding: "wallet" });

    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      recipient: WALLET_ADDRESS,
      refundTo: WALLET_ADDRESS,
      confidentiality: "basic",
      mode: "chain",
    });
    expect(result.route).toBe("wallet");
    expect(findUserIdByWalletMock).not.toHaveBeenCalled();

    const saved = createQuoteMock.mock.calls[0][0] as {
      userId: string;
      request: Record<string, unknown>;
    };
    expect(saved.userId).toBe("user-wallet");
    expect(saved.request).toMatchObject({
      confidentiality: "basic",
      mode: "chain",
      accountKind: "wallet",
      recipient: WALLET_ADDRESS,
      refundTo: WALLET_ADDRESS,
    });
  });

  it("prices an account trade from a wallet session and stores its mode", async () => {
    const result = await run(walletContext, { funding: "account" });

    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      recipient: walletContext.intentsAccountId,
      refundTo: walletContext.intentsAccountId,
      confidentiality: "basic",
      mode: "confidential-intents",
    });
    expect(result.route).toBe("account");

    const saved = createQuoteMock.mock.calls[0][0] as {
      request: Record<string, unknown>;
    };
    expect(saved.request).toMatchObject({
      confidentiality: "basic",
      mode: "confidential-intents",
      accountKind: "wallet",
      intentsAccountId: walletContext.intentsAccountId,
    });
  });

  it("refuses wallet funding for a passkey account", async () => {
    await expect(run(passkeyContext, { funding: "wallet" })).rejects.toThrow(
      "This account has no wallet.",
    );
    expect(quoteMock).not.toHaveBeenCalled();
    expect(createQuoteMock).not.toHaveBeenCalled();
  });

  it("prices a logged-out preview without storing it", async () => {
    const result = await run({
      accountKind: "wallet",
      activeAddress: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
      activeChain: "evm",
    });

    expect(result.quoteId).toBeNull();
    expect(createQuoteMock).not.toHaveBeenCalled();
    expect(findUserIdByWalletMock).not.toHaveBeenCalled();
  });

  it("prices a logged-out cross-chain preview from the derived account", async () => {
    const solanaAddress = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    const result = await run({
      accountKind: "wallet",
      activeAddress: solanaAddress,
      activeChain: "solana",
    }, {
      fromAssetId: "nep141:near-usdc",
      toAssetId: "nep141:wrap.near",
    });

    // A Solana wallet cannot fund a NEAR deposit or receive a NEAR output,
    // so the preview prices the same account route a sign-in would use.
    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      recipient: intentsAccountId("solana", solanaAddress),
      refundTo: intentsAccountId("solana", solanaAddress),
      mode: "confidential-intents",
      confidentiality: "basic",
    });
    expect(result.route).toBe("account");
    expect(result.quoteId).toBeNull();
    expect(createQuoteMock).not.toHaveBeenCalled();
  });

  it("canonicalises an EVM wallet recipient and refund to EIP-55", async () => {
    const lower = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const canonical = normalizeEvmAddress(lower) as string;
    expect(canonical).not.toBe(lower);

    const context = { ...walletContext, activeAddress: lower };
    await run(context, { funding: "wallet", recipient: lower, refundTo: lower });

    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      recipient: canonical,
      refundTo: canonical,
      mode: "chain",
    });
    const saved = createQuoteMock.mock.calls[0][0] as {
      request: Record<string, unknown>;
    };
    expect(saved.request).toMatchObject({
      recipient: canonical,
      refundTo: canonical,
      mode: "chain",
    });
  });

  it("refuses a wallet-funded quote whose origin is not on the wallet's chain", async () => {
    await expect(
      run(walletContext, {
        fromAssetId: "nep141:near-usdc",
        toAssetId: "nep141:bnb-near",
        funding: "wallet",
      }),
    ).rejects.toThrow("cannot be funded from this EVM wallet");
    expect(quoteMock).not.toHaveBeenCalled();
  });

  it("steers a cross-chain wallet quote to the account route", async () => {
    await expect(
      run(walletContext, {
        fromAssetId: "nep141:usdc-base",
        toAssetId: "nep141:wrap.near",
        funding: "wallet",
      }),
    ).rejects.toThrow("cannot receive it there");
    expect(quoteMock).not.toHaveBeenCalled();
  });

  it("prices a cross-chain pair from the Near Account", async () => {
    const result = await run(walletContext, {
      fromAssetId: "nep141:usdc-base",
      toAssetId: "nep141:wrap.near",
      funding: "account",
    });

    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      mode: "confidential-intents",
      recipient: walletContext.intentsAccountId,
      refundTo: walletContext.intentsAccountId,
    });
    expect(result.route).toBe("account");
  });

  it("leaves a refund unchecksummed when the origin chain is not EVM", async () => {
    const nearWallet: ToolContext = {
      userId: "user-near",
      accountKind: "wallet",
      intentsAccountId: "alice.near",
      activeAddress: "alice.near",
      activeChain: "near",
    };

    await run(nearWallet, {
      fromAssetId: "nep141:near-usdc",
      toAssetId: "nep141:bnb-near",
      funding: "wallet",
      recipient: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
      refundTo: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
    });

    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      // The destination is EVM, so the recipient keeps the checksummed form.
      recipient: WALLET_ADDRESS,
      // The origin is NEAR, where 1Click rejects the mixed-case form.
      refundTo: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
    });
  });

  it("always requests basic confidentiality for both funding routes", async () => {
    await run(walletContext, { funding: "wallet" });
    await run(passkeyContext);

    expect(quoteMock).toHaveBeenCalledTimes(2);
    for (const [params] of quoteMock.mock.calls) {
      expect(params).toMatchObject({ confidentiality: "basic" });
    }
    for (const [saved] of createQuoteMock.mock.calls) {
      expect(
        (saved as { request: Record<string, unknown> }).request,
      ).toMatchObject({ confidentiality: "basic" });
    }
  });

  it("ignores a caller-supplied confidentiality", async () => {
    const quoteTool = createQuoteTool(walletContext);
    await quoteTool.execute!(
      {
        fromAssetId: "nep141:usdc",
        toAssetId: "nep141:usdc-base",
        amount: "25000000",
        funding: "wallet",
        slippageBps: 100,
        confidentiality: "public",
      } as never,
      { toolCallId: "call-quote", messages: [], context: {} },
    );

    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      confidentiality: "basic",
    });
    const saved = createQuoteMock.mock.calls[0][0] as {
      request: Record<string, unknown>;
    };
    expect(saved.request).toMatchObject({ confidentiality: "basic" });
  });

  it("resolves a recipient name and stores the binding", async () => {
    const recipient = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    resolveNameMock.mockResolvedValue({
      address: recipient,
      name: "vitalik.eth",
      resolvedAt: "2026-11-08T00:00:00.000Z",
    });

    await run(walletContext, { funding: "wallet", recipient: "vitalik.eth" });

    expect(resolveNameMock).toHaveBeenCalledWith("evm", "vitalik.eth");
    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      recipient,
      // No refund was named, so the resolved recipient takes the default.
      refundTo: recipient,
    });
    const saved = createQuoteMock.mock.calls[0][0] as {
      request: Record<string, unknown>;
    };
    expect(saved.request).toMatchObject({
      recipient,
      recipientName: "vitalik.eth",
      recipientResolvedAt: "2026-11-08T00:00:00.000Z",
    });
  });

  it("resolves a refund name without touching the recipient", async () => {
    const refund = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
    resolveNameMock.mockImplementation(async (chain: string) =>
      chain === "solana"
        ? {
            address: refund,
            name: "bonfida.sns",
            resolvedAt: "2026-11-08T00:00:00.000Z",
          }
        : null,
    );

    await run(walletContext, {
      funding: "wallet",
      recipient: walletContext.activeAddress as string,
      refundTo: "bonfida.sns",
    });

    expect(resolveNameMock).toHaveBeenCalledWith("solana", "bonfida.sns");
    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      recipient: WALLET_ADDRESS,
      refundTo: refund,
    });
    const saved = createQuoteMock.mock.calls[0][0] as {
      request: Record<string, unknown>;
    };
    expect(saved.request).toMatchObject({
      refundTo: refund,
      refundToName: "bonfida.sns",
    });
    expect(saved.request).not.toHaveProperty("recipientName");
  });

  it("asks for the address when a recipient name is not registered", async () => {
    resolveNameMock.mockResolvedValue(null);

    await expect(
      run(walletContext, { funding: "wallet", recipient: "nobody.eth" }),
    ).rejects.toThrow(
      "That name is not registered. Ask the user for the full address.",
    );
    expect(quoteMock).not.toHaveBeenCalled();
    expect(createQuoteMock).not.toHaveBeenCalled();
  });
});
