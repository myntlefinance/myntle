import { describe, expect, it } from "vitest";
import {
  isNameResolutionError,
  MONEY_PATH_TTL_MS,
  nameError,
  NAME_RESOLUTION_REASONS,
  RESOLVED_NAME_TTL_MS,
  UNREGISTERED_NAME_TTL_MS,
  type NameResolverPort,
  type ResolvedName,
} from "./names";

describe("name port contract", () => {
  it("caches success 10 minutes, unregistered 1 hour, money path 0", () => {
    expect(RESOLVED_NAME_TTL_MS).toBe(10 * 60 * 1000);
    expect(UNREGISTERED_NAME_TTL_MS).toBe(60 * 60 * 1000);
    expect(MONEY_PATH_TTL_MS).toBe(0);
  });

  it("keeps the reason list closed", () => {
    expect([...NAME_RESOLUTION_REASONS].sort()).toEqual(
      ["bad_name", "bad_suffix", "ens_rpc", "sns_proxy", "sns_sol_transition"].sort(),
    );
  });

  it("marks unavailable retryable and invalid input final", () => {
    expect(nameError("unavailable", "ens_rpc", "rpc failed").retryable).toBe(
      true,
    );
    expect(
      nameError("unavailable", "sns_sol_transition", ".sol suspended")
        .retryable,
    ).toBe(true);
    expect(nameError("invalid_input", "bad_name", "bad").retryable).toBe(
      false,
    );
    expect(nameError("invalid_input", "bad_suffix", "bad").retryable).toBe(
      false,
    );
  });

  it("rejects reasons outside the closed list", () => {
    expect(() =>
      nameError("unavailable", "other_signal" as never, "nope"),
    ).toThrow(/Unknown name-resolution reason/);
  });

  it("guards the thrown shape", () => {
    expect(
      isNameResolutionError(
        nameError("unavailable", "sns_proxy", "proxy failed"),
      ),
    ).toBe(true);
    expect(isNameResolutionError(null)).toBe(false);
    // Unregistered is a null return, never a thrown NotFound-shaped error.
    expect(isNameResolutionError({ kind: "not_found" })).toBe(false);
    expect(
      isNameResolutionError({
        kind: "unavailable",
        message: "x",
        reason: "made_up",
        retryable: true,
      }),
    ).toBe(false);
  });

  it("resolves through the port signature", async () => {
    const stub: NameResolverPort = {
      async resolveName(chain, input): Promise<ResolvedName | null> {
        if (input === "unregistered.eth") return null;
        return {
          address:
            chain === "evm"
              ? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
              : "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v",
          name: input,
          resolvedAt: new Date().toISOString(),
        };
      },
    };

    const hit = await stub.resolveName("evm", "vitalik.eth");
    expect(hit?.address).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(Number.isNaN(Date.parse(hit?.resolvedAt ?? ""))).toBe(false);

    const miss = await stub.resolveName("evm", "unregistered.eth");
    expect(miss).toBeNull();
  });
});
