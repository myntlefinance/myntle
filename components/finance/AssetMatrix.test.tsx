import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { AssetMatrix, type AssetGroup } from "./AssetMatrix";
import type { TokenBalance } from "@/lib/wallet/balances";

const MOCK_GROUPS: AssetGroup[] = [
  {
    id: "arb",
    name: "Arbitrum",
    icon: "arb",
    items: [
      {
        id: "arb-usdc",
        symbol: "USDC",
        name: "USD Coin",
        amount: "500.00",
        valueUsd: 500.0,
        category: "stables",
      },
      {
        id: "arb-eth",
        symbol: "ETH",
        name: "Ethereum",
        amount: "0.25",
        valueUsd: 750.0,
        category: "native",
      },
      {
        id: "arb-dust",
        symbol: "TEST",
        name: "Test Token",
        amount: "1.0",
        valueUsd: 0.05,
        category: "dust",
      },
    ],
  },
];

describe("AssetMatrix", () => {
  it("renders with filter chips when showFilters is true", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AssetMatrix
        title="Portfolio balances"
        groups={MOCK_GROUPS}
        showFilters={true}
      />,
    );

    expect(html).toContain("Portfolio balances");
    expect(html).toContain("All");
    expect(html).toContain("Stables");
    expect(html).toContain("Dust");
    expect(html).toContain("$1,250.05");
  });

  it("hides filter chips when showFilters is false", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AssetMatrix
        title="Arbitrum balances"
        groups={MOCK_GROUPS}
        showFilters={false}
      />,
    );

    expect(html).toContain("Arbitrum balances");
    // Does NOT render filter chip buttons
    expect(html).not.toContain(">All<");
    expect(html).not.toContain(">Stables<");
    expect(html).not.toContain(">Dust<");
    // Still renders token holdings
    expect(html).toContain("USDC");
    expect(html).toContain("500.00");
  });

  it("omits the header and filters when the card holds a single row", () => {
    const balances: TokenBalance[] = [
      {
        chain: "evm",
        network: "arb-mainnet",
        symbol: "USDC",
        name: "USD Coin",
        contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        decimals: 6,
        balance: "100.00",
        rawBalance: "100000000",
        priceUsd: 1.0,
        valueUsd: 100.0,
        category: "stables",
      },
    ];

    const html = ReactDOMServer.renderToStaticMarkup(
      <AssetMatrix
        title="Wallet balances"
        balances={balances}
        showFilters={true}
      />,
    );

    // One row already names its chain and its value, so no header repeats it.
    expect(html).not.toContain("Wallet balances");
    expect(html).not.toContain(">All<");
    expect(html).toContain("Arbitrum");
    expect(html).toContain("USDC");
    expect(html).toContain("$100.00");
  });

  it("keeps the header and total when one network holds several rows", () => {
    const groups: AssetGroup[] = [
      {
        id: "arb",
        name: "Arbitrum",
        icon: "arb",
        items: [MOCK_GROUPS[0].items[0], MOCK_GROUPS[0].items[1]],
      },
    ];

    const html = ReactDOMServer.renderToStaticMarkup(
      <AssetMatrix title="Arbitrum balances" groups={groups} />,
    );

    expect(html).toContain("Arbitrum balances");
    expect(html).toContain("$1,250.00");
  });
});
