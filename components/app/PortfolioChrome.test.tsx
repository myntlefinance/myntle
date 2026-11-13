import { describe, expect, it } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { PortfolioChrome } from "./PortfolioChrome";
import type { AssetGroup } from "@/lib/wallet/balances";

const GROUPS: AssetGroup[] = [
  {
    id: "base",
    name: "Base",
    icon: "base",
    items: [
      {
        id: "usdc",
        symbol: "USDC",
        name: "USD Coin",
        amount: "10",
        valueUsd: 10,
        priceUsd: 1,
        category: "stables",
        chain: "base",
        network: "base",
      },
    ],
  },
];

describe("PortfolioChrome", () => {
  it("keeps the identity, hero, and toolbar outside the table entrance", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PortfolioChrome
        address="0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
        chain="evm"
        qrTitle="Your wallet"
        scope="wallet"
        groups={GROUPS}
        heroGroups={GROUPS}
        total={10}
        bodyKey="wallet"
        group={null}
        onSelectGroup={() => {}}
        onRefresh={() => {}}
      />,
    );

    // The watched row and the account chrome read as one section.
    expect(html).toContain("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
    expect(html).toContain("Copy address");
    expect(html).toContain("Deposit");
    expect(html).toContain("Refresh balances");
    expect(html).toContain("Your wallet holds $10.00 across 1 asset.");
    expect(html).toContain("Search assets");

    // The page-level tab entrance owns the motion; the chrome itself is
    // entrance-free so a watched card change can morph in place.
    expect(html.match(/fade-up/g) ?? []).toHaveLength(0);
  });

  it("reads a watched account through the same identity row", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PortfolioChrome
        address="0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
        chain="evm"
        qrTitle="Vault"
        scope="watched"
        subject="Vault"
        groups={GROUPS}
        heroGroups={GROUPS}
        total={10}
        bodyKey="watch-1"
        emptyTitle="No public holdings found."
        group={null}
        onSelectGroup={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(html).toContain("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
    expect(html).toContain("Copy address");
    // A watched address is someone else's account: the action moves funds
    // to it, it is not a deposit into the connected account.
    expect(html).toContain("Transfer");
    expect(html).not.toContain("Deposit");
    expect(html).toContain("Refresh balances");
    expect(html).toContain(
      "Vault’s wallet holds $10.00 across 1 asset.",
    );
    expect(html.match(/fade-up/g) ?? []).toHaveLength(0);
  });
});
