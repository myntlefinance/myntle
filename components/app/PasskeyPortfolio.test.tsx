import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

const ACCOUNT = "0x4f3a7c1d2e5b8a9c0d1e2f3a4b5c6d7e8f901234";
const USDC_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

const state = vi.hoisted(() => ({
  fetchPrivateBalances: vi.fn(),
  openSuperUnlock: vi.fn(),
  usePasskeyPortfolio: vi.fn(),
}));

vi.mock("@/lib/intents/user-session", () => ({
  fetchPrivateBalances: state.fetchPrivateBalances,
}));

vi.mock("@/components/app/SuperUnlockDialog", () => ({
  openSuperUnlock: state.openSuperUnlock,
}));

vi.mock("./portfolioQueries", () => ({
  usePasskeyPortfolio: state.usePasskeyPortfolio,
}));

import {
  buildPasskeySnapshot,
  fetchPasskeyPortfolio,
  passkeyPortfolioScope,
  passkeyPortfolioStatus,
} from "./passkeyPortfolioData";
import type { AssetMeta } from "./toolParts";
import {
  PasskeyPortfolio,
  PasskeyPortfolioBody,
} from "./PasskeyPortfolio";

function renderBody(
  status: "locked" | "error" | "empty" | "loaded" | "pending",
  snapshot: ReturnType<typeof buildPasskeySnapshot> | null = null,
) {
  return ReactDOMServer.renderToStaticMarkup(
    <PasskeyPortfolioBody
      status={status}
      snapshot={snapshot}
      onUnlock={() => state.openSuperUnlock()}
      onRetry={() => {}}
    />,
  );
}

const USDC_META = new Map<string, AssetMeta>([
  [USDC_ID, { symbol: "USDC", decimals: 6, priceUsd: 1 }],
]);

beforeEach(() => {
  state.fetchPrivateBalances.mockReset();
  state.openSuperUnlock.mockReset();
  state.usePasskeyPortfolio.mockReset();
});

describe("passkey private balance", () => {
  it("keys its cache by passkey account, never a wallet scope", () => {
    expect(passkeyPortfolioScope(ACCOUNT)).toBe(`passkey:${ACCOUNT}`);
    expect(passkeyPortfolioScope(ACCOUNT)).not.toBe(`near:${ACCOUNT}`);
    expect(passkeyPortfolioScope(ACCOUNT)).not.toBe(`evm:${ACCOUNT}`);
  });

  it("reads the private balance with the passkey session and keeps the rows", async () => {
    state.fetchPrivateBalances.mockResolvedValue({
      ok: true,
      balances: [
        { tokenId: USDC_ID, available: "2500000", source: "confidential" },
      ],
    });

    const read = await fetchPasskeyPortfolio(ACCOUNT);
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
    const html = renderBody("loaded", snapshot);

    expect(html).toContain("Your super account holds $2.50 across 1 asset.");
    expect(html).toContain("USDC");
    expect(html).toContain("2.5");
    expect(html).toContain("$2.50");
  });

  it("paints the sample shape while the first private read lands", () => {
    const html = renderBody("pending", null);
    expect(html).not.toContain("Reading your private balance.");
    expect(html).toContain("Your super account holds $896.98 across 4 assets.");
    expect(html).toContain("USDC");
  });

  it("renders the unlock action while the session is locked", async () => {
    state.fetchPrivateBalances.mockResolvedValue({
      ok: false,
      reason: "locked",
    });

    const read = await fetchPasskeyPortfolio(ACCOUNT);
    expect(passkeyPortfolioStatus(read)).toBe("locked");

    const html = renderBody("locked");
    expect(html).toContain("Your private balance is locked.");
    expect(html).toContain("Unlock");
    expect(html).not.toContain("Unlock your private balance");
  });

  it("renders the empty state when the ledger has no positive rows", async () => {
    state.fetchPrivateBalances.mockResolvedValue({
      ok: true,
      balances: [{ tokenId: USDC_ID, available: "0" }],
    });

    const read = await fetchPasskeyPortfolio(ACCOUNT);
    expect(read).toEqual({ ok: true, entries: [] });
    expect(passkeyPortfolioStatus(read)).toBe("empty");

    const html = renderBody("empty");
    expect(html).toContain(
      "Your private balance is empty. Ask the assistant to deposit.",
    );
  });

  it("renders the error state with a retry action", async () => {
    state.fetchPrivateBalances.mockResolvedValue({
      ok: false,
      reason: "error",
    });

    const read = await fetchPasskeyPortfolio(ACCOUNT);
    expect(passkeyPortfolioStatus(read)).toBe("error");

    const html = renderBody("error");
    expect(html).toContain(
      "The private balance service is unavailable. Try again later.",
    );
    expect(html).toContain("Try again");
  });

  it("shows the unlock action through the live portfolio container", () => {
    state.usePasskeyPortfolio.mockReturnValue({
      status: "locked",
      snapshot: null,
      entries: [],
      error: null,
      isPending: false,
      refresh: vi.fn(),
    });

    const html = ReactDOMServer.renderToStaticMarkup(
      <PasskeyPortfolio accountId={ACCOUNT} />,
    );
    expect(html).toContain("Your private balance is locked.");
    expect(html).toContain("Unlock");
  });
});
