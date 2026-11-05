import { describe, expect, it } from "vitest";
import {
  checkDestinationForAsset,
  normalizeEvmAddress,
} from "./destination";

const CHECKSUMMED = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";

describe("withdrawal destination", () => {
  it("accepts the EIP-55 form and returns it unchanged", () => {
    expect(normalizeEvmAddress(CHECKSUMMED)).toBe(CHECKSUMMED);
  });

  it("accepts the lowercase form and normalises it to EIP-55", () => {
    expect(normalizeEvmAddress(CHECKSUMMED.toLowerCase())).toBe(CHECKSUMMED);
  });

  it("rejects a mixed-case address with a wrong checksum", () => {
    expect(
      normalizeEvmAddress("0xc8aECa3431542a1340D7Ef0EEb4684311b5A3148"),
    ).toBeNull();
  });

  it("rejects a non-address and a non-string", () => {
    for (const value of [
      "",
      "   ",
      "0x1234",
      "not-an-address",
      "0x" + "0".repeat(64),
      null,
      42,
      undefined,
    ]) {
      expect(normalizeEvmAddress(value), String(value)).toBeNull();
    }
  });

  it("validates against the destination asset's chain", () => {
    expect(checkDestinationForAsset("arb", CHECKSUMMED)).toEqual({
      ok: true,
      address: CHECKSUMMED,
      chain: "arb",
    });
    expect(
      checkDestinationForAsset("arb", CHECKSUMMED.toLowerCase()),
    ).toEqual({ ok: true, address: CHECKSUMMED, chain: "arb" });
  });

  it("refuses a shipped chain that is not an EVM destination", () => {
    for (const chain of ["near", "sol", "solana"]) {
      expect(checkDestinationForAsset(chain, CHECKSUMMED)).toEqual({
        ok: false,
        reason: "unsupported-chain",
      });
    }
  });

  it("refuses an unknown or missing chain rather than guessing", () => {
    expect(checkDestinationForAsset(null, CHECKSUMMED)).toEqual({
      ok: false,
      reason: "unknown-chain",
    });
    expect(checkDestinationForAsset("", CHECKSUMMED)).toEqual({
      ok: false,
      reason: "unknown-chain",
    });
  });

  it("reports an invalid address on a supported chain", () => {
    expect(checkDestinationForAsset("base", "0xnot-an-address")).toEqual({
      ok: false,
      reason: "invalid-address",
    });
  });
});
