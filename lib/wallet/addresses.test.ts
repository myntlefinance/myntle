import { describe, expect, it, vi } from "vitest";
import {
  defaultWatchLabel,
  isEnsNameInput,
  isSnsNameInput,
  isWatchChain,
  normalizeWatchLabel,
  normalizeWatchedAddress,
  resolveWatchInput,
  watchAddressError,
  watchNameError,
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

describe("isEnsNameInput", () => {
  it("accepts a `.eth` name on EVM, case-insensitive and padded", () => {
    expect(isEnsNameInput("evm", "vitalik.eth")).toBe(true);
    expect(isEnsNameInput("evm", "  VITALIK.ETH ")).toBe(true);
  });

  it("rejects raw addresses, other suffixes, and other chains", () => {
    expect(isEnsNameInput("evm", CHECKSUMMED)).toBe(false);
    expect(isEnsNameInput("evm", "vitalik.com")).toBe(false);
    expect(isEnsNameInput("evm", "not-an-address")).toBe(false);
    expect(isEnsNameInput("evm", "")).toBe(false);
    expect(isEnsNameInput("solana", "vitalik.eth")).toBe(false);
    expect(isEnsNameInput("near", "vitalik.eth")).toBe(false);
    expect(isEnsNameInput("evm", 42)).toBe(false);
  });

  it("keeps the 128-character input cap for names", () => {
    // Realistic `.eth` names stay far under this: registry labels run to
    // 63 characters per label and full names in the wild stay well under
    // 64, so 128 admits every name a person would track. Anything longer
    // keeps the raw-path error instead of widening stored input.
    const fits = `${"a".repeat(120)}.eth`;
    expect(fits.length).toBeLessThanOrEqual(128);
    expect(isEnsNameInput("evm", fits)).toBe(true);
    expect(isEnsNameInput("evm", `${"a".repeat(125)}.eth`)).toBe(false);
  });
});

describe("isSnsNameInput", () => {
  it("accepts a `.sns` name on Solana, case-insensitive and padded", () => {
    expect(isSnsNameInput("solana", "bonfida.sns")).toBe(true);
    expect(isSnsNameInput("solana", "  BONFIDA.SNS ")).toBe(true);
  });

  it("rejects raw addresses, other suffixes, and other chains", () => {
    expect(isSnsNameInput("solana", USDC_MINT)).toBe(false);
    expect(isSnsNameInput("solana", SYSTEM_PROGRAM)).toBe(false);
    expect(isSnsNameInput("solana", "bonfida.com")).toBe(false);
    expect(isSnsNameInput("solana", "vitalik.eth")).toBe(false);
    // `.sol` is held unavailable at the resolver, so it never reads as a
    // name candidate here — it keeps the raw-path error instead.
    expect(isSnsNameInput("solana", "bonfida.sol")).toBe(false);
    expect(isSnsNameInput("solana", "not-a-name")).toBe(false);
    expect(isSnsNameInput("solana", "")).toBe(false);
    expect(isSnsNameInput("evm", "bonfida.sns")).toBe(false);
    expect(isSnsNameInput("near", "bonfida.sns")).toBe(false);
    expect(isSnsNameInput("solana", 42)).toBe(false);
  });

  it("keeps the 128-character input cap for names", () => {
    const fits = `${"a".repeat(120)}.sns`;
    expect(fits.length).toBeLessThanOrEqual(128);
    expect(isSnsNameInput("solana", fits)).toBe(true);
    expect(isSnsNameInput("solana", `${"a".repeat(125)}.sns`)).toBe(false);
  });
});

describe("resolveWatchInput", () => {
  const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const hit = (overrides: Record<string, unknown> = {}) => ({
    address: VITALIK,
    name: "vitalik.eth",
    resolvedAt: "2026-11-08T12:00:00.000Z",
    ...overrides,
  });

  it("reads a raw address through the sync path without calling the reader", () => {
    const resolve = vi.fn(async () => hit());

    return expect(
      resolveWatchInput("evm", CHECKSUMMED.toLowerCase(), resolve),
    ).resolves.toEqual({
      ok: true,
      address: CHECKSUMMED,
      name: null,
      resolvedAt: null,
    }).then(() => {
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  it("resolves a `.eth` name to its storable form", async () => {
    const resolve = vi.fn(async () => hit());

    const read = await resolveWatchInput("evm", "  vitalik.eth ", resolve);

    expect(read).toEqual({
      ok: true,
      address: VITALIK,
      name: "vitalik.eth",
      resolvedAt: "2026-11-08T12:00:00.000Z",
    });
    expect(resolve).toHaveBeenCalledWith("evm", "vitalik.eth");
  });

  it("reads an unregistered name as unregistered, never thrown", async () => {
    const resolve = vi.fn(async () => null);

    await expect(
      resolveWatchInput("evm", "unregistered12345.eth", resolve),
    ).resolves.toEqual({ ok: false, reason: "unregistered" });
  });

  it("reads a refused name as invalid without a useful mapping loss", async () => {
    const resolve = vi.fn(async () => {
      throw {
        kind: "invalid_input",
        reason: "bad_name",
        message: "That name is not valid.",
        retryable: false,
      };
    });

    await expect(
      resolveWatchInput("evm", "not_valid!.eth", resolve),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("reads a failed lookup as unavailable", async () => {
    const resolve = vi.fn(async () => {
      throw {
        kind: "unavailable",
        reason: "ens_rpc",
        message: "Name lookup is unavailable.",
        retryable: true,
      };
    });

    await expect(
      resolveWatchInput("evm", "vitalik.eth", resolve),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("reads an unexpected throw as unavailable", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("socket hung up");
    });

    await expect(
      resolveWatchInput("evm", "vitalik.eth", resolve),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("reads non-name input as invalid without calling the reader", async () => {
    const resolve = vi.fn(async () => hit());

    await expect(
      resolveWatchInput("evm", "0x123", resolve),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(
      resolveWatchInput("solana", "vitalik.eth", resolve),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    // A `.sol` input is not a name candidate (the resolver holds it
    // unavailable), so it reads as invalid here without a network call.
    await expect(
      resolveWatchInput("solana", "bonfida.sol", resolve),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("resolveWatchInput over solana", () => {
  const BONFIDA = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
  const hit = (overrides: Record<string, unknown> = {}) => ({
    address: BONFIDA,
    name: "bonfida.sns",
    resolvedAt: "2026-11-08T12:00:00.000Z",
    ...overrides,
  });

  it("reads a raw address through the sync path without calling the reader", () => {
    const resolve = vi.fn(async () => hit());

    return expect(
      resolveWatchInput("solana", USDC_MINT, resolve),
    ).resolves.toEqual({
      ok: true,
      address: USDC_MINT,
      name: null,
      resolvedAt: null,
    }).then(() => {
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  it("resolves a `.sns` name to its storable form", async () => {
    const resolve = vi.fn(async () => hit());

    const read = await resolveWatchInput("solana", "  bonfida.sns ", resolve);

    expect(read).toEqual({
      ok: true,
      address: BONFIDA,
      name: "bonfida.sns",
      resolvedAt: "2026-11-08T12:00:00.000Z",
    });
    expect(resolve).toHaveBeenCalledWith("solana", "bonfida.sns");
  });

  it("reads an unregistered name as unregistered, never thrown", async () => {
    const resolve = vi.fn(async () => null);

    await expect(
      resolveWatchInput("solana", "unregistered-xyz.sns", resolve),
    ).resolves.toEqual({ ok: false, reason: "unregistered" });
  });

  it("reads a refused name as invalid without a useful mapping loss", async () => {
    const resolve = vi.fn(async () => {
      throw {
        kind: "invalid_input",
        reason: "bad_name",
        message: "That name is not valid.",
        retryable: false,
      };
    });

    await expect(
      resolveWatchInput("solana", "bad_!.sns", resolve),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("reads a failed lookup as unavailable", async () => {
    const resolve = vi.fn(async () => {
      throw {
        kind: "unavailable",
        reason: "sns_proxy",
        message: "Name lookup is unavailable.",
        retryable: true,
      };
    });

    await expect(
      resolveWatchInput("solana", "bonfida.sns", resolve),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("reads an unexpected throw as unavailable", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("socket hung up");
    });

    await expect(
      resolveWatchInput("solana", "bonfida.sns", resolve),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("watchNameError", () => {
  it("names one complete sentence per outcome", () => {
    expect(watchNameError("unregistered")).toBe(
      "That name is not registered. Check the spelling and try again.",
    );
    expect(watchNameError("unavailable")).toBe(
      "Name lookup is unavailable. Try again shortly.",
    );
    expect(watchNameError("invalid")).toBe(
      "That name is not valid. Check it and try again.",
    );
  });
});
