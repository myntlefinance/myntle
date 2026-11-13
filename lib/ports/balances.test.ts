import { describe, expect, it } from "vitest";
import type {
  BalancesPort,
  BalancesResult,
  TokenBalance,
} from "./balances";
import type { TokenBalance as DomainBalance } from "@/lib/wallet/balances";

describe("balances port shape", () => {
  it("reuses the domain balance type instead of redefining it", () => {
    // Compile-time identity: a domain balance is a port balance.
    const domain: DomainBalance = {
      chain: "evm",
      network: "base",
      symbol: "USDC",
      name: "USD Coin",
      contractAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      decimals: 6,
      balance: "50",
      rawBalance: "50000000",
      priceUsd: 1,
      valueUsd: 50,
      category: "stables",
    };
    const port: TokenBalance = domain;
    expect(port.symbol).toBe("USDC");
  });

  it("serves balances behind the port signature", async () => {
    const stub: BalancesPort = {
      async getBalances(
        chain: string,
        address: string,
      ): Promise<BalancesResult> {
        return { address, chain, balances: [], totalValueUsd: 0 };
      },
    };
    const res = await stub.getBalances(
      "evm",
      "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    );
    expect(res.balances).toEqual([]);
    // Port results carry no string-error channel; failures throw.
    expect("error" in res).toBe(false);
  });
});
