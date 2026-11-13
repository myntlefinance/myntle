import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { WatchedTab } from "./WatchedTab";
import type { WatchlistEntry } from "./useWatchlist";

vi.mock("skullet/react", () => ({
  // Mirrors the real binding: the ghost draws from the sample while
  // data is missing, and the children render the data once it lands.
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
 * The watchlist tab's cards and dialogs.
 *
 * The selected account's detail lives in the shared portfolio chrome,
 * so this section owns only the list: its loading, empty, and error
 * shapes, the selection hint, and the delete gate.
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
      {...props}
    />,
  );
}

describe("WatchedTab", () => {
  it("renders the tracked cards", () => {
    const html = render();

    expect(html).toContain("Vault");
    expect(html).toContain("alice.near");
    expect(html).toContain("Watch new");
  });

  it("leaves the page entrance to the tab", () => {
    const html = render();

    // The keyed page wrapper owns the tab entrance; the list itself does
    // not add a second slide when cards update or a card is selected.
    expect(html).not.toContain("animate-[fade-up");
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

  it("asks to track when the list is empty", () => {
    const html = render({ entries: [], selected: null });

    expect(html).toContain("Your watchlist is empty.");
    expect(html).toContain("Track");
    // One action, not a hollow card above a second Track button.
    expect(html).not.toContain("Watch new");
  });

  it("holds the list's own shape while it lands", () => {
    const html = render({ entries: null, selected: null });

    // The list lands first: its cards own the loading shape. The detail
    // is a second, later reveal, so the tab never promises one before
    // the list has even said whether there is an address to watch.
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
    const html = render({ selected: ENTRIES[0] });

    expect(html).not.toContain("Select an address to view its public portfolio.");
  });
});
