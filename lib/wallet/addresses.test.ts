import { describe, expect, it } from "vitest";
import {
  defaultWatchLabel,
  isWatchChain,
  normalizeWatchLabel,
  normalizeWatchedAddress,
  watchAddressError,
} from "./addresses";

/**
 * The watch-address validator vectors.
 *
 * EVM goes through the existing viem strict normaliser, Solana through a
 * 32-byte base58 decode, NEAR through the account-id grammar. Every chain
 * rejects malformed input and over-length input with the same null.
 */

const CHECKSUMMED = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const IMPLICIT = "a".repeat(64);

describe("normalizeWatchedAddress", () => {
  it("keeps a checksummed EVM address and checksums a lowercase one", () => {
    expect(normalizeWatchedAddress("evm", CHECKSUMMED)).toBe(CHECKSUMMED);
    expect(normalizeWatchedAddress("evm", CHECKSUMMED.toLowerCase())).toBe(
      CHECKSUMMED,
    );
  });

  it("rejects a wrong-checksum EVM address", () => {
    const wrong = `0x${CHECKSUMMED.slice(2, 6).toUpperCase()}${CHECKSUMMED.slice(6).toLowerCase()}`;
    expect(wrong).not.toBe(CHECKSUMMED);
    expect(normalizeWatchedAddress("evm", wrong)).toBeNull();
  });

  it("rejects malformed EVM input", () => {
    expect(normalizeWatchedAddress("evm", "0x123")).toBeNull();
    expect(normalizeWatchedAddress("evm", "not-an-address")).toBeNull();
    expect(normalizeWatchedAddress("evm", "")).toBeNull();
    expect(normalizeWatchedAddress("evm", 42)).toBeNull();
  });

  it("accepts Solana base58 addresses that decode to 32 bytes", () => {
    expect(normalizeWatchedAddress("solana", USDC_MINT)).toBe(USDC_MINT);
    expect(normalizeWatchedAddress("solana", SYSTEM_PROGRAM)).toBe(
      SYSTEM_PROGRAM,
    );
  });

  it("rejects malformed Solana input", () => {
    expect(normalizeWatchedAddress("solana", "not-a-key!!!")).toBeNull();
    expect(normalizeWatchedAddress("solana", "")).toBeNull();
    // Valid base58 but the wrong length decodes away from 32 bytes.
    expect(normalizeWatchedAddress("solana", "1111")).toBeNull();
  });

  it("accepts a named NEAR account and the implicit form", () => {
    expect(normalizeWatchedAddress("near", "alice.near")).toBe("alice.near");
    expect(normalizeWatchedAddress("near", IMPLICIT)).toBe(IMPLICIT);
    expect(normalizeWatchedAddress("near", IMPLICIT.toUpperCase())).toBe(
      IMPLICIT,
    );
  });

  it("rejects malformed NEAR input", () => {
    expect(normalizeWatchedAddress("near", "Alice!.near")).toBeNull();
    expect(normalizeWatchedAddress("near", "-bad.near")).toBeNull();
    expect(normalizeWatchedAddress("near", "a")).toBeNull();
    expect(normalizeWatchedAddress("near", `${"a".repeat(60)}.near`)).toBeNull();
    expect(normalizeWatchedAddress("near", "")).toBeNull();
  });

  it("rejects over-length input on every chain", () => {
    const long = `0x${"a".repeat(130)}`;
    expect(normalizeWatchedAddress("evm", long)).toBeNull();
    expect(normalizeWatchedAddress("solana", "1".repeat(129))).toBeNull();
    expect(normalizeWatchedAddress("near", `${"a".repeat(120)}.near`)).toBeNull();
  });
});

describe("isWatchChain", () => {
  it("accepts the three chains and nothing else", () => {
    expect(isWatchChain("evm")).toBe(true);
    expect(isWatchChain("solana")).toBe(true);
    expect(isWatchChain("near")).toBe(true);
    expect(isWatchChain("bitcoin")).toBe(false);
    expect(isWatchChain(undefined)).toBe(false);
  });
});

describe("normalizeWatchLabel", () => {
  it("defaults an empty label to the truncated address", () => {
    expect(normalizeWatchLabel(undefined, "evm", CHECKSUMMED)).toBe(
      defaultWatchLabel("evm", CHECKSUMMED),
    );
    expect(normalizeWatchLabel("   ", "near", "alice.near")).toBe("alice.near");
  });

  it("keeps a short name and rejects an over-length one", () => {
    expect(normalizeWatchLabel("Vault", "evm", CHECKSUMMED)).toBe("Vault");
    expect(normalizeWatchLabel("x".repeat(25), "evm", CHECKSUMMED)).toBeNull();
    expect(normalizeWatchLabel(42, "evm", CHECKSUMMED)).toBeNull();
  });
});

describe("watchAddressError", () => {
  it("stays quiet while empty and names one reason per chain", () => {
    expect(watchAddressError("evm", "   ")).toBeNull();
    expect(watchAddressError("evm", CHECKSUMMED)).toBeNull();
    expect(watchAddressError("evm", "0x123")).toBe("Enter a valid 0x address.");
    expect(watchAddressError("solana", "nope")).toBe(
      "Enter a valid Solana address.",
    );
    expect(watchAddressError("near", "-bad.near")).toBe(
      "Enter a valid NEAR account.",
    );
  });
});
