import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { connectEvmFunding } from "./evm";
import { connectSolanaFunding } from "./solana";
import type { FundingDeposit } from "./types";
import { releaseFundingConnections } from "./release";

const ADDRESS = "0x32596df10ff2ac5acde8406e6adcc8d047921073";

const arbitrumUsdc: FundingDeposit = {
  address: "0x9ab1cd2ef3a4b5c6d7e8f90123456789abcdef01",
  amountRaw: "2000000",
  tokenContract: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  chainId: 42161,
  chainSlug: "arb",
  chainName: "Arbitrum One",
  decimals: 6,
  symbol: "USDC",
};

beforeEach(async () => {
  await releaseFundingConnections();
});

describe("funding connections release their grants", () => {
  it("revokes an EVM funding provider on sign-out", async () => {
    const request = vi.fn(async ({ method }: { method: string }) =>
      method === "eth_requestAccounts" ? [ADDRESS] : null,
    );

    await connectEvmFunding({
      provider: { request } as never,
      deposit: arbitrumUsdc,
      walletName: "MetaMask",
    });
    await releaseFundingConnections();

    expect(request).toHaveBeenCalledWith({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  });

  it("disconnects a Solana funding wallet on sign-out", async () => {
    const account: WalletAccount = {
      address: "So11111111111111111111111111111111111111112",
      publicKey: new Uint8Array(32),
      chains: ["solana:mainnet"],
      features: [],
    };
    const connect = vi.fn(async () => ({ accounts: [account] }));
    const disconnect = vi.fn(async () => {});
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon: "",
      chains: ["solana:mainnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect },
        "standard:disconnect": { version: "1.0.0", disconnect },
      },
    } as unknown as Wallet;

    await connectSolanaFunding(wallet);
    await releaseFundingConnections();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
