import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../context";
import { createWalletBalancesTool } from "./balances";

const { walletBalancesMock, ledgerMock } = vi.hoisted(() => ({
  walletBalancesMock: vi.fn(),
  ledgerMock: vi.fn(),
}));

vi.mock("@/lib/wallet/balances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallet/balances")>();
  return { ...actual, getConnectedWalletBalances: walletBalancesMock };
});

vi.mock("@/lib/intents/balances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intents/balances")>();
  return { ...actual, getIntentsLedgerBalances: ledgerMock };
});

const passkeyContext: ToolContext = {
  userId: "user-passkey",
  accountKind: "passkey",
  accountId: "0x4f3a000000000000000000000000000000000001",
  intentsAccountId: "0x4f3a000000000000000000000000000000000001",
  // The route keeps the session address here; the passkey branch must not
  // treat it as a chain wallet.
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

/** One Arbitrum USDC holding, the shape the Alchemy adapter returns. */
const arbitrumUsdc = {
  chain: "arb",
  network: "arb",
  symbol: "USDC",
  name: "USD Coin",
  contractAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  decimals: 6,
  balance: "5.2",
  rawBalance: "5200000",
  priceUsd: 1,
  valueUsd: 5.2,
};

const ledger = {
  status: "settled" as const,
  balances: [
    {
      assetId: "nep141:usdc",
      symbol: "USDC",
      decimals: 6,
      balance: "25",
      rawBalance: "25000000",
      priceUsd: 1,
      valueUsd: 25,
    },
  ],
  totalValueUsd: 25,
};

async function run(
  context: ToolContext,
  input: Record<string, unknown> = {},
) {
  const balances = createWalletBalancesTool(context);
  return (await balances.execute!(
    { ...input },
    { toolCallId: "call-balances", messages: [], context: {} },
  )) as Record<string, unknown>;
}

beforeEach(() => {
  ledgerMock.mockResolvedValue(ledger);
  walletBalancesMock.mockResolvedValue({
    address: walletContext.activeAddress,
    chain: "evm",
    balances: [],
    totalValueUsd: 0,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("get_wallet_balances for a passkey account", () => {
  it("reads the Intents ledger and never the chain adapter", async () => {
    const result = await run(passkeyContext);

    expect(ledgerMock).toHaveBeenCalledWith(
      passkeyContext.intentsAccountId,
      "near",
    );
    expect(walletBalancesMock).not.toHaveBeenCalled();
    expect(result.source).toBe("session");
    expect(result.accountKind).toBe("passkey");
    expect(result.accountId).toBe(passkeyContext.intentsAccountId);
    // The account id is not a wallet address, so it never fills that field.
    expect(result.address).toBeUndefined();
    expect(result.totalValueUsd).toBe(25);
    expect(result.wallet).toEqual({ balances: [], totalValueUsd: 0 });

    const groups = result.groups as Array<{
      id: string;
      name: string;
      items: Array<{ symbol: string; amount: string }>;
    }>;
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Settlement Ledger");
    expect(groups[0].items[0]).toMatchObject({ symbol: "USDC", amount: "25" });
  });

  it("hides the table for a one-token check", async () => {
    const result = await run(passkeyContext, { symbol: "USDC" });

    expect(result.showCard).toBe(false);
    expect(result.groups).toHaveLength(1);
  });

  it("keeps the table for an inventory question", async () => {
    const result = await run(passkeyContext);

    expect(result.showCard).toBe(true);
  });

  it("ignores a model-supplied address and chain", async () => {
    await run(passkeyContext, {
      address: "0x9999999999999999999999999999999999999999",
      chain: "evm",
    });

    expect(ledgerMock).toHaveBeenCalledWith(
      passkeyContext.intentsAccountId,
      "near",
    );
    expect(walletBalancesMock).not.toHaveBeenCalled();
  });

  it("returns an empty result and a deposit hint when the ledger is empty", async () => {
    ledgerMock.mockResolvedValue({
      status: "empty",
      balances: [],
      totalValueUsd: 0,
    });

    const result = await run(passkeyContext);

    expect(walletBalancesMock).not.toHaveBeenCalled();
    expect(result.groups).toEqual([]);
    expect(result.totalValueUsd).toBe(0);
    expect(result.message).toBe(
      "No public balances. The private balance is separate.",
    );
    expect(result.privateBalance).toBe("separate");
    expect(result.privateBalanceNote).toContain("get_super_balances");
  });

  it("does not read anything when no session account is known", async () => {
    const result = await run({ accountKind: "passkey" });

    expect(ledgerMock).not.toHaveBeenCalled();
    expect(walletBalancesMock).not.toHaveBeenCalled();
    expect(result.source).toBe("none");
  });
});

describe("get_wallet_balances for a wallet account", () => {
  it("keeps the chain adapter and the wallet fields", async () => {
    const result = await run(walletContext);

    expect(walletBalancesMock).toHaveBeenCalledTimes(1);
    expect(walletBalancesMock.mock.calls[0][0]).toBe("evm");
    expect(walletBalancesMock.mock.calls[0][1]).toBe(walletContext.activeAddress);
    expect(ledgerMock).toHaveBeenCalledWith(
      walletContext.activeAddress,
      "evm",
    );
    expect(result.source).toBe("session");
    expect(result.address).toBe(walletContext.activeAddress);
    expect(result.chain).toBe("evm");
    expect(result.accountKind).toBeUndefined();
  });

  it("hides the table for a one-token check on one network", async () => {
    walletBalancesMock.mockResolvedValue({
      address: walletContext.activeAddress,
      chain: "evm",
      balances: [arbitrumUsdc],
      totalValueUsd: 5.2,
    });

    const result = await run(walletContext, {
      networks: ["arbitrum"],
      symbol: "USDC",
    });

    expect(result.showCard).toBe(false);
    expect(result.groups).toHaveLength(1);
  });

  it("hides the table when a token check does not name a network", async () => {
    walletBalancesMock.mockResolvedValue({
      address: walletContext.activeAddress,
      chain: "evm",
      balances: [arbitrumUsdc],
      totalValueUsd: 5.2,
    });
    ledgerMock.mockResolvedValue({
      status: "empty",
      balances: [],
      totalValueUsd: 0,
    });

    const result = await run(walletContext, { symbol: "USDC" });

    expect(result.showCard).toBe(false);
  });

  it("keeps the table when the token is held on more than one network", async () => {
    walletBalancesMock.mockResolvedValue({
      address: walletContext.activeAddress,
      chain: "evm",
      balances: [
        arbitrumUsdc,
        {
          ...arbitrumUsdc,
          chain: "base",
          network: "base",
          contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          balance: "3",
          rawBalance: "3000000",
          valueUsd: 3,
        },
      ],
      totalValueUsd: 8.2,
    });
    ledgerMock.mockResolvedValue({
      status: "empty",
      balances: [],
      totalValueUsd: 0,
    });

    const result = await run(walletContext, { symbol: "USDC" });

    expect(result.showCard).toBe(true);
  });

  it("keeps the table when a symbol matches more than one asset", async () => {
    walletBalancesMock.mockResolvedValue({
      address: walletContext.activeAddress,
      chain: "evm",
      balances: [
        arbitrumUsdc,
        {
          ...arbitrumUsdc,
          contractAddress: "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
          name: "USD Coin (bridged)",
        },
      ],
      totalValueUsd: 10.4,
    });
    ledgerMock.mockResolvedValue({
      status: "empty",
      balances: [],
      totalValueUsd: 0,
    });

    const result = await run(walletContext, { symbol: "USDC" });

    expect(result.showCard).toBe(true);
  });

  it("keeps the table when the address belongs to someone else", async () => {
    walletBalancesMock.mockResolvedValue({
      address: walletContext.activeAddress,
      chain: "evm",
      balances: [arbitrumUsdc],
      totalValueUsd: 5.2,
    });

    const result = await run(walletContext, {
      address: "0x9999999999999999999999999999999999999999",
      networks: ["arbitrum"],
      symbol: "USDC",
    });

    expect(result.showCard).toBe(true);
  });

  it("hides the table when the connected address was named explicitly", async () => {
    walletBalancesMock.mockResolvedValue({
      address: walletContext.activeAddress,
      chain: "evm",
      balances: [arbitrumUsdc],
      totalValueUsd: 5.2,
    });

    const result = await run(walletContext, {
      address: walletContext.activeAddress,
      networks: ["arbitrum"],
      symbol: "USDC",
    });

    expect(result.showCard).toBe(false);
  });

  it("filters the settlement ledger to the requested symbol", async () => {
    walletBalancesMock.mockResolvedValue({
      address: walletContext.activeAddress,
      chain: "evm",
      balances: [arbitrumUsdc],
      totalValueUsd: 5.2,
    });
    ledgerMock.mockResolvedValue({
      status: "settled",
      balances: [
        {
          assetId: "nep141:usdc",
          symbol: "USDC",
          decimals: 6,
          balance: "25",
          rawBalance: "25000000",
          priceUsd: 1,
          valueUsd: 25,
        },
        {
          assetId: "nep141:wrap.near",
          symbol: "wNEAR",
          decimals: 24,
          balance: "3",
          rawBalance: "3000000000000000000000000",
          priceUsd: 5,
          valueUsd: 15,
        },
      ],
      totalValueUsd: 40,
    });

    const result = await run(walletContext, { symbol: "USDC" });
    const ledgerResult = result.settlementLedger as {
      balances: Array<{ symbol: string }>;
      totalValueUsd: number;
    };

    expect(ledgerResult.balances.map((balance) => balance.symbol)).toEqual([
      "USDC",
    ]);
    expect(ledgerResult.totalValueUsd).toBe(25);
  });
});
