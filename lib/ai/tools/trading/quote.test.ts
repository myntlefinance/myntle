import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../context";
import { createQuoteTool } from "./quote";

const { quoteMock, createQuoteMock, findUserIdByWalletMock } = vi.hoisted(
  () => ({
    quoteMock: vi.fn(),
    createQuoteMock: vi.fn(),
    findUserIdByWalletMock: vi.fn(),
  }),
);

vi.mock("@/lib/intents/service", () => ({ quote: quoteMock }));
vi.mock("@/lib/db/transactions", () => ({ createQuote: createQuoteMock }));
vi.mock("@/lib/db/wallets", () => ({
  findUserIdByWallet: findUserIdByWalletMock,
}));

const priced = {
  engine: "intents" as const,
  fromAssetId: "nep141:usdc",
  toAssetId: "nep141:wrap.near",
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
    funding?: "confidential" | "wallet";
    recipient?: string;
    refundTo?: string;
    confidentiality?: "public" | "basic" | "advanced";
  } = {},
) {
  const quoteTool = createQuoteTool(context);
  const result = await quoteTool.execute!(
    {
      fromAssetId: "nep141:usdc",
      toAssetId: "nep141:wrap.near",
      amount: "25000000",
      slippageBps: 100,
      confidentiality: "basic" as const,
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

beforeEach(() => {
  quoteMock.mockResolvedValue(priced);
  createQuoteMock.mockResolvedValue("quote-1");
  findUserIdByWalletMock.mockResolvedValue("wallet-user");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("get_quote funding", () => {
  it("prices a passkey account confidentially for the account itself", async () => {
    const result = await run(passkeyContext, {
      recipient: "0xMODEL_SUPPLIED",
      refundTo: "0xMODEL_SUPPLIED",
    });

    expect(quoteMock).toHaveBeenCalledTimes(1);
    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      recipient: passkeyContext.intentsAccountId,
      refundTo: passkeyContext.intentsAccountId,
      mode: "confidential-intents",
    });
    expect(result.mode).toBe("confidential-intents");
    expect(result.quoteId).toBe("quote-1");
    expect(result.minAmountOut).toBe("9.9");
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
      toAssetId: "nep141:wrap.near",
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

  it("keeps a wallet account on the chain route and its own address", async () => {
    const result = await run(walletContext);

    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      recipient: walletContext.activeAddress,
      refundTo: walletContext.activeAddress,
      mode: "chain",
    });
    expect(result.mode).toBe("chain");
    expect(findUserIdByWalletMock).not.toHaveBeenCalled();

    const saved = createQuoteMock.mock.calls[0][0] as {
      userId: string;
      request: Record<string, unknown>;
    };
    expect(saved.userId).toBe("user-wallet");
    expect(saved.request).toMatchObject({
      mode: "chain",
      accountKind: "wallet",
      recipient: walletContext.activeAddress,
      refundTo: walletContext.activeAddress,
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

  it("never forwards a public confidentiality on a confidential quote", async () => {
    const result = await run(passkeyContext, { confidentiality: "public" });

    expect(result.mode).toBe("confidential-intents");
    expect(quoteMock.mock.calls[0][0]).toMatchObject({
      confidentiality: "basic",
    });
  });
});
