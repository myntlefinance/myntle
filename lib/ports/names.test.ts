import { describe, expect, it } from "vitest";
import {
  isNameResolutionError,
  MONEY_PATH_TTL_MS,
  nameError,
  NAME_RESOLUTION_REASONS,
  RESOLVED_NAME_TTL_MS,
  UNREGISTERED_NAME_TTL_MS,
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
});
