import { describe, expect, it } from "vitest";
import { canFundDeposit, readDepositMetadata } from "./deposit-metadata";

describe("readDepositMetadata", () => {
  it("reads the quote deadline from an older signed-intent record", () => {
    const meta = readDepositMetadata(
      {
        mode: "confidential-external",
        depositAddress: "0xabc",
        deadline: "2026-11-03T12:30:00.000Z",
      },
      null,
    );

    expect(meta?.expiresAt).toBe("2026-11-03T12:30:00.000Z");
  });

  it("prefers the deposit expiry when both fields exist", () => {
    const meta = readDepositMetadata(
      {
        mode: "confidential-external",
        depositAddress: "0xabc",
        expiresAt: "2026-11-03T12:15:00.000Z",
        deadline: "2026-11-03T12:30:00.000Z",
      },
      null,
    );

    expect(meta?.expiresAt).toBe("2026-11-03T12:15:00.000Z");
  });
});

describe("canFundDeposit", () => {
  const evm = {
    address: "0xabc",
    amountInRaw: "2000000",
    tokenContract: "0xusdc",
    chainId: 42161,
    chainSlug: "arb",
    decimals: 6,
    symbol: "USDC",
  };

  it("accepts a sound EVM deposit", () => {
    expect(canFundDeposit(evm)).toBe(true);
  });

  it("refuses a chain slug and id that disagree", () => {
    expect(canFundDeposit({ ...evm, chainId: 8453 })).toBe(false);
  });

  it("refuses zero, negative, or fractional amounts", () => {
    expect(canFundDeposit({ ...evm, amountInRaw: "0" })).toBe(false);
    expect(canFundDeposit({ ...evm, amountInRaw: "-1" })).toBe(false);
    expect(canFundDeposit({ ...evm, amountInRaw: "1.5" })).toBe(false);
  });

  it("refuses malformed decimals", () => {
    expect(canFundDeposit({ ...evm, decimals: -1 })).toBe(false);
    expect(canFundDeposit({ ...evm, decimals: 1.5 })).toBe(false);
  });

  it("accepts a native Solana deposit without a token contract", () => {
    expect(
      canFundDeposit({
        address: "So11111111111111111111111111111111111111112",
        amountInRaw: "1000000000",
        chainSlug: "sol",
        decimals: 9,
        symbol: "SOL",
      }),
    ).toBe(true);
  });
});
