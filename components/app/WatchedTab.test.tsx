import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { WatchedTab } from "./WatchedTab";
import type { PortfolioSnapshot } from "./portfolioCache";
import type { WatchlistEntry } from "./useWatchlist";

vi.mock("skullet/react", () => ({
  // Mirrors the real binding: the ghost draws from the sample while
  // data is missing, the error node wins once loading settles, and the
  // children render the data itself once it lands.
  Skeleton: ({
    children,
    sample,
    data,
    error,
    loading,
  }: {
    children: (value: unknown) => React.ReactNode;
    sample: unknown;
    data?: unknown;
    error?: React.ReactNode;
    loading?: boolean;
  }) => {
    if (typeof children !== "function") return <>{children}</>;
    if (loading || (data == null && !error)) return <>{children(sample)}</>;
    if (error) return <>{error}</>;
    return <>{children(data ?? sample)}</>;
  },
}));

/**
 * The watchlist tab.
 *
 * Selection paints the selected account's public hero plus holdings, Remove
 * deletes without a gate, and the view never reads the private ledger: the
 * snapshot arrives through props from the public read, so there is no
 * unlock card to render and no private fetch to call.
 */

const ENTRIES: WatchlistEntry[] = [
  {
    id: "watch-1",
    chain: "evm",
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    label: "Vault",
    isDefault: true,
    createdAt: "2026-11-06T12:00:00.000Z",
  },
  {
    id: "watch-2",
    chain: "near",
    address: "alice.near",
    label: null,
    isDefault: false,
    createdAt: "2026-11-06T12:01:00.000Z",
  },
];

const SNAPSHOT: PortfolioSnapshot = {
  groups: [
    {
      id: "base",
      name: "Base",
      icon: "base",
      items: [
        {
          id: "usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "10.00",
          valueUsd: 10,
          category: "stables",
        },
        {
          id: "eth",
          symbol: "ETH",
          name: "Ether",
          amount: "1.00",
          valueUsd: 3000,
          category: "native",
        },
      ],
    },
  ],
  totalUsd: 3010,
};

function render(props: Partial<React.ComponentProps<typeof WatchedTab>> = {}) {
  return ReactDOMServer.renderToString(
    <WatchedTab
      entries={ENTRIES}
      listError={null}
      refreshList={() => {}}
      selected={null}
      onSelect={() => {}}
      onRemove={() => {}}
      removeError={null}
      onEdit={() => {}}
      onTrack={() => {}}
      onSetDefault={() => {}}
      snapshot={null}
      isPending={false}
      error={null}
      refresh={() => {}}
      {...props}
    />,
  );
}

describe("WatchedTab", () => {
  it("selecting a row paints its public hero and holdings", () => {
    const html = render({ selected: ENTRIES[0], snapshot: SNAPSHOT });

    expect(html).toContain("Vault");
    expect(html).toContain(
      "Watching Vault’s public holdings across 2 assets.",
    );
    expect(html).toContain("USDC");
    expect(html).toContain("ETH");
  });

  it("never renders the unlock card or the viewer's own money", () => {
    const html = render({ selected: ENTRIES[0], snapshot: SNAPSHOT });

    expect(html).not.toContain("Unlock");
    expect(html).not.toContain("Your wallet holds");
    expect(html).not.toContain("Your super account holds");
  });

  it("asks before deleting, trash-style", () => {
    const html = render();

    // Edit and delete wait behind the kebab; the gate is the dialog.
    expect(html).toContain("Card actions for Vault");
    expect(html).not.toContain("Rename Vault");
    expect(html).not.toContain("Edit");
    expect(html).not.toContain("Delete Vault");
    expect(html).not.toContain("Delete address?");
  });

  it("falls back to the list with no selection", () => {
    const html = render({ selected: null });

    expect(html).toContain("Vault");
    expect(html).toContain("alice.near");
    expect(html).toContain("Watch new");
    expect(html).not.toContain("Watching");
  });

  it("names the public scope when holdings are empty", () => {
    const html = render({
      selected: ENTRIES[0],
      snapshot: { groups: [], totalUsd: 0 },
    });

    expect(html).toContain("No public holdings found.");
  });

  it("names a failed read with a retry", () => {
    const html = render({
      selected: ENTRIES[0],
      error: new Error("Balances are unavailable."),
    });

    expect(html).toContain("Failed to read balances.");
    expect(html).toContain("Refresh");
  });

  it("asks to track when the list is empty", () => {
    const html = render({ entries: [], selected: null });

    expect(html).toContain("Your watchlist is empty.");
    expect(html).toContain("Track");
    // One action, not a hollow card above a second Track button.
    expect(html).not.toContain("Watch new");
  });

  it("holds the list's own shape while it lands", () => {
    const html = render({ entries: null, selected: null });

    // The list lands first: its cards own the loading shape. The selected
    // account's hero and holdings are a second, later reveal, so the tab
    // never pretends to know a detail it has not read yet.
    expect(html).toContain("Vault");
    expect(html).toContain("alice.near");
    expect(html).toContain("Watch new");
    expect(html).not.toContain("Watching Vault");
    expect(html).not.toContain("Search assets");
    expect(html).not.toContain("animate-pulse");
  });

  describe("no address in the URL", () => {
    it("never reads or writes an address param", () => {
      const root = join(__dirname, "..", "..");
      const tab = readFileSync(join(root, "components/app/WatchedTab.tsx"), "utf8");
      // The selection lives in memory and falls back to the stored
      // default: a copied link can never carry an address.
      for (const forbidden of [
        "window.location",
        "URLSearchParams",
        "?address=",
        "watchKey",
      ]) {
        expect(tab, `WatchedTab must not reference ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    });
  });

  it("reads the public ledger only, never the private one", () => {
    const root = join(__dirname, "..", "..");
    const tab = readFileSync(join(root, "components/app/WatchedTab.tsx"), "utf8");
    for (const forbidden of [
      "useSuperPrivateBalances",
      "fetchSessionPortfolio",
      "fetchPasskeyPortfolio",
      "usePasskeyPortfolio",
      "SuperUnlock",
      "UnlockRequestCard",
      "User-Session",
      "user-session",
    ]) {
      expect(tab, `WatchedTab must not reference ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("names the next step when nothing is selected", () => {
    const html = render({ selected: null });

    expect(html).toContain("Select an address to view its public portfolio.");
    expect(html).not.toContain("Watching");
  });

  it("clears the hint once an account is picked", () => {
    const html = render({ selected: ENTRIES[0], snapshot: SNAPSHOT });

    expect(html).not.toContain("Select an address to view its public portfolio.");
  });
});
