import { describe, expect, it } from "vitest";
import {
  SOLANA_BASE_FEE,
  SOLANA_TOKEN_ACCOUNT_RENT,
  solanaGasNeed,
} from "./types";

describe("solanaGasNeed", () => {
  it("charges destination ATA rent when the deposit address has no token account", () => {
    expect(
      solanaGasNeed({
        tokenTransfer: true,
        destinationAtaExists: false,
        amount: 2_000_000n,
      }),
    ).toBe(SOLANA_BASE_FEE + SOLANA_TOKEN_ACCOUNT_RENT);
  });

  it("does not charge rent when the destination token account already exists", () => {
    expect(
      solanaGasNeed({
        tokenTransfer: true,
        destinationAtaExists: true,
        amount: 2_000_000n,
      }),
    ).toBe(SOLANA_BASE_FEE);
  });

  it("includes the amount for a native SOL transfer", () => {
    expect(
      solanaGasNeed({
        tokenTransfer: false,
        destinationAtaExists: false,
        amount: 2_000_000n,
      }),
    ).toBe(2_000_000n + SOLANA_BASE_FEE);
  });
});
