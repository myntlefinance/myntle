import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x4f3a7c1d2e5b8a9c0d1e2f3a4b5c6d7e8f901234";
const USDC_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

const state = vi.hoisted(() => ({
  fetchPrivateBalances: vi.fn(),
}));

vi.mock("@/lib/intents/user-session", () => ({
  fetchPrivateBalances: state.fetchPrivateBalances,
}));

import type { AssetMeta } from "./toolParts";
import {
  buildPasskeySnapshot,
  fetchSessionPortfolio,
  passkeyPortfolioStatus,
} from "./passkeyPortfolioData";

const USDC_META = new Map<string, AssetMeta>([
  [USDC_ID, { symbol: "USDC", decimals: 6, priceUsd: 1 }],
]);

beforeEach(() => {
  state.fetchPrivateBalances.mockReset();
});

describe("the private session read", () => {
  it("reads a passkey account under the passkey scope and keeps its rows", async () => {
    state.fetchPrivateBalances.mockResolvedValue({
      ok: true,
      balances: [
        { tokenId: USDC_ID, available: "2500000", source: "confidential" },
      ],
    });

    const read = await fetchSessionPortfolio("passkey", ACCOUNT);
    expect(state.fetchPrivateBalances).toHaveBeenCalledWith(
      "passkey",
      ACCOUNT,
    );
    expect(read).toEqual({
      ok: true,
      entries: [
        { tokenId: USDC_ID, available: "2500000", source: "confidential" },
      ],
    });
    expect(passkeyPortfolioStatus(read)).toBe("loaded");

    const snapshot = buildPasskeySnapshot(
      read.ok ? read.entries : [],
      USDC_META,
    );
    expect(snapshot.totalUsd).toBe(2.5);
    expect(snapshot.superGroups?.[0].items[0]).toMatchObject({
      symbol: "USDC",
      amount: "2.5",
      valueUsd: 2.5,
    });
  });

  it("reads a wallet's super account under its own chain", async () => {
    state.fetchPrivateBalances.mockResolvedValue({
      ok: true,
      balances: [],
    });

    await fetchSessionPortfolio("evm", ACCOUNT);
    expect(state.fetchPrivateBalances).toHaveBeenCalledWith("evm", ACCOUNT);
  });

  it("reports a locked session as a state, not an error", async () => {
    state.fetchPrivateBalances.mockResolvedValue({
      ok: false,
      reason: "locked",
    });

    const read = await fetchSessionPortfolio("passkey", ACCOUNT);
    expect(passkeyPortfolioStatus(read)).toBe("locked");
  });

  it("reports an empty ledger when every row has no positive balance", async () => {
    state.fetchPrivateBalances.mockResolvedValue({
      ok: true,
      balances: [{ tokenId: USDC_ID, available: "0" }],
    });

    const read = await fetchSessionPortfolio("passkey", ACCOUNT);
    expect(read).toEqual({ ok: true, entries: [] });
    expect(passkeyPortfolioStatus(read)).toBe("empty");
  });

  it("reports an unreadable service as an error", async () => {
    state.fetchPrivateBalances.mockResolvedValue({
      ok: false,
      reason: "error",
    });

    const read = await fetchSessionPortfolio("passkey", ACCOUNT);
    expect(passkeyPortfolioStatus(read)).toBe("error");
  });
});
