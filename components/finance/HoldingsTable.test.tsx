import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { HoldingsTable, flattenGroups } from "./HoldingsTable";
import type { AssetGroup } from "@/lib/wallet/balances";

const GROUPS: AssetGroup[] = [
  {
    id: "base",
    name: "Base",
    icon: "base",
    items: [
      { id: "usdc", symbol: "USDC", name: "USD Coin", amount: "10", valueUsd: 10, priceUsd: 1, category: "stables" },
      { id: "eth", symbol: "ETH", name: "Ether", amount: "1", valueUsd: 3000, priceUsd: 3000, category: "native" },
    ],
  },
];

describe("HoldingsTable", () => {
  it("sorts by value and keeps the search row", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <HoldingsTable groups={GROUPS} />,
    );
    expect(html).toContain("Search assets");
    expect(html).toContain("Asset");
    expect(html).toContain("Balance");
    expect(html).toContain("Value");
    // ETH outranks USDC, so it renders first.
    expect(html.indexOf("ETH")).toBeLessThan(html.indexOf("USDC"));
    expect(html).toContain("$3,000.00");
    // The hero bar owns filtering now; the table carries no pills.
    expect(html).not.toContain("Stables");
    // The chain mark is skeleton noise; the name beside it is measured.
    expect(html).toContain("skullet-ignore");
  });

  it("filters rows to the selected bar group", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <HoldingsTable groups={GROUPS} group="Stables" />,
    );
    expect(html).toContain("USDC");
    expect(html).not.toContain("ETH");
  });

  it("keeps the headers up with a failed read and a retry", () => {
    const onRetry = vi.fn();
    const html = ReactDOMServer.renderToStaticMarkup(
      <HoldingsTable groups={[]} error onRetry={onRetry} />,
    );
    expect(html).toContain("Asset");
    expect(html).toContain("Failed to read balances.");
    expect(html).toContain("Refresh");
  });

  it("flattens groups with the network name attached", () => {
    const rows = flattenGroups(GROUPS);
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe("ETH");
    expect(rows[0].groupName).toBe("Base");
  });

  it("renders headers with a bare empty message when nothing is held", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <HoldingsTable groups={[]} />,
    );
    expect(html).toContain("Asset");
    expect(html).toContain("No assets found");
    expect(html).not.toContain("Try a different search");
    // Nothing to filter: the network trigger stays for the row's shape,
    // but it cannot open a menu of no networks.
    expect(html).toContain("All networks");
    expect(html).toContain('disabled=""');
  });

  it("keeps the network filter usable when there are assets", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <HoldingsTable groups={GROUPS} />,
    );
    expect(html).toContain("All networks");
    expect(html).not.toContain('disabled=""');
  });

  it("leaves the page entrance to the tab and keeps the toolbar still", () => {
    const keyed = ReactDOMServer.renderToStaticMarkup(
      <HoldingsTable groups={GROUPS} bodyKey="watch-1" />,
    );
    // The tab owns the page entrance; a first mount never doubles it.
    expect(keyed).not.toContain("animate-[fade-up");
    expect(keyed).toContain("Search assets");

    const plain = ReactDOMServer.renderToStaticMarkup(
      <HoldingsTable groups={GROUPS} />,
    );
    expect(plain).not.toContain("animate-[fade-up");
    expect(plain).toContain("Search assets");
  });
});
