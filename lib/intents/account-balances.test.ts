import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountBalancesError,
  fetchAccountBalances,
} from "./account-balances";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAccountBalances", () => {
  it("returns well-formed entries and drops malformed ones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          balances: [
            { tokenId: "nep141:usdc", available: "1000000" },
            { tokenId: "nep141:usdc", available: 42 },
            { available: "100" },
            null,
          ],
        }),
      })),
    );

    await expect(fetchAccountBalances("live")).resolves.toEqual([
      { tokenId: "nep141:usdc", available: "1000000" },
    ]);
  });

  it("throws the status on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );

    const error = await fetchAccountBalances("expired").catch((e) => e);
    expect(error).toBeInstanceOf(AccountBalancesError);
    expect((error as AccountBalancesError).status).toBe(401);
  });

  it("treats a malformed body as an error, never an empty balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      })),
    );

    await expect(fetchAccountBalances("live")).rejects.toBeInstanceOf(
      AccountBalancesError,
    );
  });
});
