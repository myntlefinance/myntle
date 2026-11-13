import { describe, expect, it, vi } from "vitest";
import { nameError } from "@/lib/ports/names";
import {
  NameInputError,
  resolveInputAddress,
  reverifyNameBinding,
  sameResolvedAddress,
} from "./binding";

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const RESOLVED_AT = "2026-11-08T00:00:00.000Z";

function hit(address = VITALIK) {
  return { address, name: "vitalik.eth", resolvedAt: RESOLVED_AT };
}

describe("resolveInputAddress", () => {
  it("takes a direct address without resolving", async () => {
    const resolve = vi.fn();
    const out = await resolveInputAddress({
      value: ` ${VITALIK} `,
      scope: "evm",
      isDirectAddress: (v) => (v === VITALIK ? v : null),
      resolve,
    });
    expect(out).toEqual({ address: VITALIK, name: null, resolvedAt: null });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("resolves a name fresh in scope", async () => {
    const resolve = vi.fn().mockResolvedValue(hit());
    const out = await resolveInputAddress({
      value: "Vitalik.ETH",
      scope: "evm",
      isDirectAddress: () => null,
      resolve,
    });
    expect(resolve).toHaveBeenCalledWith("evm", "Vitalik.ETH");
    expect(out).toEqual({
      address: VITALIK,
      name: "vitalik.eth",
      resolvedAt: RESOLVED_AT,
    });
  });

  it("rejects a name on the wrong scope as invalid", async () => {
    const resolve = vi.fn();
    await expect(
      resolveInputAddress({
        value: "vitalik.eth",
        scope: "solana",
        isDirectAddress: () => null,
        resolve,
      }),
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("lets the suffix decide when the scope is null", async () => {
    const resolve = vi.fn().mockResolvedValue({
      address: "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v",
      name: "bonfida.sns",
      resolvedAt: RESOLVED_AT,
    });
    const out = await resolveInputAddress({
      value: "bonfida.sns",
      scope: null,
      isDirectAddress: () => null,
      resolve,
    });
    expect(resolve).toHaveBeenCalledWith("solana", "bonfida.sns");
    expect(out.name).toBe("bonfida.sns");
  });

  it("maps null to unregistered, invalid_input to invalid, the rest to unavailable", async () => {
    const direct = () => null;
    await expect(
      resolveInputAddress({
        value: "nobody.eth",
        scope: "evm",
        isDirectAddress: direct,
        resolve: async () => null,
      }),
    ).rejects.toMatchObject({ reason: "unregistered" });
    await expect(
      resolveInputAddress({
        value: "vitalik.eth",
        scope: "evm",
        isDirectAddress: direct,
        resolve: async () => {
          throw nameError("invalid_input", "bad_name", "bad");
        },
      }),
    ).rejects.toMatchObject({ reason: "invalid" });
    await expect(
      resolveInputAddress({
        value: "vitalik.eth",
        scope: "evm",
        isDirectAddress: direct,
        resolve: async () => {
          throw nameError("unavailable", "ens_rpc", "down");
        },
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    await expect(
      resolveInputAddress({
        value: "vitalik.eth",
        scope: "evm",
        isDirectAddress: direct,
        resolve: async () => {
          throw new Error("misconfigured");
        },
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("rejects empty and non-name input as invalid without resolving", async () => {
    const resolve = vi.fn();
    for (const value of ["", "   ", "not a name!", 42]) {
      await expect(
        resolveInputAddress({
          value,
          scope: "evm",
          isDirectAddress: () => null,
          resolve,
        }),
      ).rejects.toBeInstanceOf(NameInputError);
    }
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("reverifyNameBinding", () => {
  it("accepts an unchanged binding", async () => {
    const resolve = vi.fn().mockResolvedValue(hit());
    await expect(
      reverifyNameBinding({
        chain: "evm",
        name: "vitalik.eth",
        address: VITALIK.toLowerCase(),
        resolve,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("reports a re-pointed name as a mismatch", async () => {
    const resolve = vi.fn().mockResolvedValue(hit("0x0000000000000000000000000000000000000001"));
    await expect(
      reverifyNameBinding({
        chain: "evm",
        name: "vitalik.eth",
        address: VITALIK,
        resolve,
      }),
    ).resolves.toEqual({ ok: false, reason: "mismatch" });
  });

  it("reports an unregistered name and maps failures", async () => {
    await expect(
      reverifyNameBinding({
        chain: "evm",
        name: "vitalik.eth",
        address: VITALIK,
        resolve: async () => null,
      }),
    ).resolves.toEqual({ ok: false, reason: "unregistered" });
    await expect(
      reverifyNameBinding({
        chain: "evm",
        name: "vitalik.eth",
        address: VITALIK,
        resolve: async () => {
          throw nameError("unavailable", "ens_rpc", "down");
        },
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(
      reverifyNameBinding({
        chain: "evm",
        name: "vitalik.eth",
        address: VITALIK,
        resolve: async () => {
          throw nameError("invalid_input", "bad_name", "bad");
        },
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });
});

describe("sameResolvedAddress", () => {
  it("compares EVM case-insensitively and Solana exactly", () => {
    expect(sameResolvedAddress("evm", VITALIK, VITALIK.toLowerCase())).toBe(true);
    expect(sameResolvedAddress("evm", VITALIK, "0x0000")).toBe(false);
    expect(
      sameResolvedAddress(
        "solana",
        "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v",
        "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v",
      ),
    ).toBe(true);
  });
});
