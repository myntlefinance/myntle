import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import {
  AssetMatrix,
  selectAssetMatrixGroups,
  type AssetGroup,
  type AssetItem,
} from "./AssetMatrix";
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

function asset(
  id: string,
  valueUsd: number,
  category: AssetItem["category"] = "token",
): AssetItem {
  return { id, symbol: id, name: id, amount: "1", valueUsd, category };
}

const RANKED_GROUPS: AssetGroup[] = [
  {
    id: "arb",
    name: "Arbitrum",
    icon: "arb",
    items: [asset("SMALLA", 2), asset("DUP", 90), asset("ARB80", 80)],
  },
  {
    id: "base",
    name: "Base",
    icon: "base",
    items: [asset("DUP", 500), asset("SMALLB", 1), asset("BASE100", 100)],
  },
  {
    id: "eth",
    name: "Ethereum",
    icon: "eth",
    items: [asset("ETH1000", 1000), asset("SMALLC", 4)],
  },
];

describe("selectAssetMatrixGroups", () => {
  it("previews the five highest values across networks without merging identifiers", () => {
    const original = structuredClone(RANKED_GROUPS);
    const result = selectAssetMatrixGroups(RANKED_GROUPS, "all", false);

    expect(result.count).toBe(8);
    expect(result.groups.map((group) => group.name)).toEqual([
      "Ethereum",
      "Base",
      "Arbitrum",
    ]);
    expect(result.groups.flatMap((group) => group.items.map((item) => item.id)))
      .toEqual(["ETH1000", "DUP", "BASE100", "DUP", "ARB80"]);
    expect(RANKED_GROUPS).toEqual(original);
  });

  it("keeps every filtered row when expanded", () => {
    const result = selectAssetMatrixGroups(RANKED_GROUPS, "all", true);

    expect(result.count).toBe(8);
    expect(result.groups).toEqual(RANKED_GROUPS);
  });

  it("filters before choosing the preview and counts only matching rows", () => {
    const groups: AssetGroup[] = [
      {
        id: "arb",
        name: "Arbitrum",
        icon: "arb",
        items: [
          asset("STABLE1", 1, "stables"),
          asset("STABLE2", 2, "stables"),
          asset("STABLE3", 3, "stables"),
          asset("STABLE4", 4, "stables"),
        ],
      },
      {
        id: "base",
        name: "Base",
        icon: "base",
        items: [
          asset("STABLE5", 5, "stables"),
          asset("STABLE6", 6, "stables"),
          asset("STABLE7", 7, "stables"),
          asset("NOTSTABLE", 10000),
        ],
      },
    ];
    const preview = selectAssetMatrixGroups(groups, "stables", false);
    const expanded = selectAssetMatrixGroups(groups, "stables", true);

    expect(preview.count).toBe(7);
    expect(preview.groups.flatMap((group) => group.items.map((item) => item.id)))
      .toEqual(["STABLE7", "STABLE6", "STABLE5", "STABLE4", "STABLE3"]);
    expect(expanded.count).toBe(7);
    expect(expanded.groups.flatMap((group) => group.items)).toHaveLength(7);
  });

  it("keeps short and empty filter results complete", () => {
    const dust = selectAssetMatrixGroups(MOCK_GROUPS, "dust", false);
    const empty = selectAssetMatrixGroups(RANKED_GROUPS, "dust", false);

    expect(dust.count).toBe(1);
    expect(dust.groups[0].items.map((item) => item.symbol)).toEqual(["TEST"]);
    expect(empty).toEqual({ groups: [], count: 0 });
  });

  it("breaks value ties in the original order", () => {
    const groups: AssetGroup[] = [{
      id: "base",
      name: "Base",
      icon: "base",
      items: Array.from({ length: 7 }, (_, index) => asset(`TIE${index}`, 10)),
    }];
    const result = selectAssetMatrixGroups(groups, "all", false);

    expect(result.groups[0].items.map((item) => item.id)).toEqual([
      "TIE0", "TIE1", "TIE2", "TIE3", "TIE4",
    ]);
  });

  it("keeps one group per network when value order alternates between chains", () => {
    const groups: AssetGroup[] = [
      {
        id: "arb",
        name: "Arbitrum",
        icon: "arb",
        items: [asset("A9", 9), asset("A7", 7), asset("A5", 5)],
      },
      {
        id: "base",
        name: "Base",
        icon: "base",
        items: [asset("B8", 8), asset("B6", 6), asset("B4", 4)],
      },
    ];
    const result = selectAssetMatrixGroups(groups, "all", false);

    expect(result.groups.map((group) => group.name)).toEqual([
      "Arbitrum",
      "Base",
    ]);
    expect(
      result.groups.flatMap((group) => group.items.map((item) => item.id)),
    ).toEqual(["A9", "A7", "A5", "B8", "B6"]);
    expect(new Set(result.groups.map((group) => group.id)).size).toBe(2);
  });

  it("puts non-finite values behind priced holdings in the preview", () => {
    const groups: AssetGroup[] = [{
      id: "base",
      name: "Base",
      icon: "base",
      items: [
        asset("UNKNOWN", Number.NaN),
        asset("ONE", 1),
        asset("TWO", 2),
        asset("THREE", 3),
        asset("FOUR", 4),
        asset("FIVE", 5),
      ],
    }];
    const result = selectAssetMatrixGroups(groups, "all", false);

    expect(result.count).toBe(6);
    expect(result.groups[0].items.map((item) => item.id)).toEqual([
      "FIVE", "FOUR", "THREE", "TWO", "ONE",
    ]);
  });
});

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
    expect(html).toContain('aria-pressed="true"');
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

  it("rounds every icon so the measured skeleton has no sharp squares", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AssetMatrix title="Portfolio balances" groups={MOCK_GROUPS} />,
    );

    const iconClasses = [...html.matchAll(/<svg[^>]*class="([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(iconClasses.length).toBeGreaterThan(0);
    expect(
      iconClasses.every((classes) => classes.includes("rounded-[4px]")),
    ).toBe(true);
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

  it("shows a compact preview, full total and accessible expansion control", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AssetMatrix title="EVM balances" groups={RANKED_GROUPS} />,
    );

    expect(html).toContain("$1,777.00");
    expect(html).toContain("5 of 8 holdings");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="[^"]+"/);
    expect(html).toContain('role="group" aria-label="Arbitrum"');
    expect(html).toContain('role="group" aria-label="Ethereum"');
    expect(html).toContain("Show all");
    expect(html).toContain("ETH1000");
    expect(html).toContain("BASE100");
    expect(html).not.toContain("SMALLA");
    expect(html).not.toContain("SMALLB");
    expect(html).not.toContain("SMALLC");
  });

  it("renders one network rail per network in a highest-first preview", () => {
    const groups: AssetGroup[] = [
      {
        id: "arb",
        name: "Arbitrum",
        icon: "arb",
        items: [
          asset("ARB-USDC", 15),
          asset("ARB-ETH", 4),
          asset("ARB-USDS", 2),
          asset("ARB-LINK", 1),
        ],
      },
      {
        id: "base",
        name: "Base",
        icon: "base",
        items: [
          asset("BASE-USDT", 12),
          asset("BASE-WETH", 3),
          asset("BASE-CBBTC", 1.5),
          asset("BASE-DAI", 0.5),
        ],
      },
    ];

    const html = ReactDOMServer.renderToStaticMarkup(
      <AssetMatrix title="EVM balances" groups={groups} />,
    );

    expect(html).toContain("5 of 8 holdings");
    expect([
      ...html.matchAll(/role="group" aria-label="Arbitrum"/g),
    ]).toHaveLength(1);
    expect([...html.matchAll(/role="group" aria-label="Base"/g)]).toHaveLength(
      1,
    );
    // Selection stays value-ordered, then groups internally by network.
    const arbitrum = html.indexOf('role="group" aria-label="Arbitrum"');
    expect(html.indexOf("ARB-USDC")).toBeGreaterThan(arbitrum);
    expect(html.indexOf("ARB-ETH")).toBeGreaterThan(html.indexOf("ARB-USDC"));
    expect(html.indexOf("ARB-USDS")).toBeGreaterThan(html.indexOf("ARB-ETH"));
    expect(html.indexOf("BASE-USDT")).toBeGreaterThan(
      html.indexOf('role="group" aria-label="Base"'),
    );
  });

  it("does not offer expansion when every holding fits", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AssetMatrix groups={MOCK_GROUPS} />,
    );

    expect(html).toContain("USDC");
    expect(html).toContain("ETH");
    expect(html).toContain("TEST");
    expect(html).not.toContain("Show all");
    expect(html).not.toContain("holdings</span>");
  });

  it("still offers expansion when the filter bar is hidden", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AssetMatrix groups={RANKED_GROUPS} showFilters={false} />,
    );

    expect(html).not.toContain(">Stables<");
    expect(html).toContain("5 of 8 holdings");
    expect(html).toContain("Show all");
  });

  it("uses a distinct controlled region for each card", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <>
        <AssetMatrix groups={RANKED_GROUPS} />
        <AssetMatrix groups={RANKED_GROUPS} />
      </>,
    );
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(controls).toHaveLength(2);
    expect(new Set(controls).size).toBe(2);
    for (const id of controls) expect(html).toContain(`id="${id}"`);
  });
});
