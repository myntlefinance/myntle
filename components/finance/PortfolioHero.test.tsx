import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { PortfolioHero, allocationSegments, AllocationTooltipLabel, clampTooltipShift } from "./PortfolioHero";

const ITEMS = [
  { id: "eth", symbol: "ETH", name: "Ether", amount: "1", valueUsd: 3000, category: "native" as const },
  { id: "usdc", symbol: "USDC", name: "USD Coin", amount: "10", valueUsd: 10, category: "stables" as const },
];

function renderHero(selected: "Stables" | "Gas" | "Others" | null) {
  return ReactDOMServer.renderToStaticMarkup(
    <PortfolioHero
      total={3010}
      count={2}
      scope="wallet"
      items={ITEMS}
      selected={selected}
      onSelect={vi.fn()}
    />,
  );
}

describe("PortfolioHero", () => {
  it("states the total as a complete sentence with the group bar", () => {
    const html = renderHero(null);
    expect(html).toContain("Your wallet holds $3,010.00 across 2 assets.");
    expect(html).toContain("$3,010.00");
    expect(html).toContain("Allocation");
    // Bare pills: the name lives in the tooltip, reached on hover.
    expect(html).toContain("Gas: 99.7%");
    expect(html).not.toContain(">Gas<");
    expect(html).toContain("min-width:24px");
  });

  it("uses super account copy for the settlement side", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PortfolioHero
        total={5}
        count={1}
        scope="super"
        items={[]}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    expect(html).toContain("Your super account holds $5.00 across 1 asset.");
  });

  it("marks the watched state with the subject label", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PortfolioHero
        total={896.98}
        count={4}
        scope="watched"
        subject="Vault"
        items={ITEMS}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    expect(html).toContain(
      "Watching Vault’s public holdings across 4 assets.",
    );
    expect(html).toContain("$896.98");
    expect(html).not.toContain("Your wallet holds");
    expect(html).not.toContain("Your super account holds");
  });

  it("uses the singular asset and a fallback subject when watched", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PortfolioHero
        total={5}
        count={1}
        scope="watched"
        items={[]}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    expect(html).toContain(
      "Watching this account’s public holdings across 1 asset.",
    );
  });

  it("mutes every segment until one is selected", () => {
    const html = renderHero(null);
    expect(html).not.toContain('aria-pressed="true"');
    // The primitive's own dimming: solid colors, unselected at 0.58.
    expect(html).toContain("opacity:0.58");
    expect(html).not.toContain("tint");
  });

  it("masks the totals when the balance is unreadable", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PortfolioHero
        total={0}
        count={0}
        scope="super"
        items={[]}
        selected={null}
        onSelect={vi.fn()}
        masked
      />,
    );
    expect(html).toContain("Your super account holds $•••••• across •• assets.");
    expect(html).toContain("$••••••");
    expect(html).not.toContain("$0.00");
  });
  it("lifts the selected segment to full opacity", () => {
    const html = renderHero("Stables");
    expect(html).toContain("bg-green");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("opacity:1");
  });

  it("labels every share in the tooltip", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PortfolioHero
        total={100}
        count={3}
        scope="wallet"
        items={[
          { id: "a", symbol: "USDC", name: "USD Coin", amount: "88", valueUsd: 88, category: "stables" as const },
          { id: "b", symbol: "ETH", name: "Ether", amount: "0.003", valueUsd: 9, category: "native" as const },
          { id: "c", symbol: "FOO", name: "Foo", amount: "3", valueUsd: 3, category: "token" as const },
        ]}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    // Segments stay bare; every share names itself in its tooltip.
    expect(html).toContain("Stables: 88.0%");
    expect(html).toContain("Gas: 9.0%");
    expect(html).toContain("Others: 3.0%");
    expect(html).not.toContain(">Gas<");
    expect(html).not.toContain(">Stables<");
  });

  it("renders the tooltip label with the group glyph", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AllocationTooltipLabel group="Stables" pct={30.7} />,
    );
    expect(html).toContain("Stables 30.7%");
  });

  it("keeps a centered tooltip inside the viewport", () => {
    // Centered already: no push.
    expect(clampTooltipShift(200, 120, 400)).toBe(0);
    // Past the left edge: pushed right.
    expect(clampTooltipShift(20, 120, 400)).toBe(48);
    // Past the right edge: pushed left.
    expect(clampTooltipShift(390, 120, 400)).toBe(-58);
    // Wider than the screen: stays centered.
    expect(clampTooltipShift(200, 500, 400)).toBe(0);
  });

  it("merges same-group shares into one segment", () => {
    const segments = allocationSegments(
      [
        { category: "stables", valueUsd: 22 },
        { category: "stables", valueUsd: 18 },
        { category: "native", valueUsd: 5 },
      ],
      45,
    );
    expect(segments.map((s) => s.name)).toEqual(["Stables", "Gas"]);
    expect(segments[0].pct).toBeCloseTo(88.89, 1);
  });

  it("groups every holding into stables, gas, or others", () => {
    const segments = allocationSegments(
      [
        { category: "stables", valueUsd: 10 },
        { category: "native", valueUsd: 30 },
        { category: "token", valueUsd: 5 },
        { category: "dust", valueUsd: 0.4 },
      ],
      45.4,
    );
    expect(segments.map((s) => s.name)).toEqual([
      "Stables",
      "Gas",
      "Others",
    ]);
  });

  it("keeps every slot mounted behind a steady bar", () => {
    const stablesOnly = [
      { id: "usdc", symbol: "USDC", name: "USD Coin", amount: "10", valueUsd: 10, category: "stables" as const },
    ];
    const steady = ReactDOMServer.renderToStaticMarkup(
      <PortfolioHero
        total={10}
        count={1}
        scope="watched"
        subject="Vault"
        items={stablesOnly}
        selected={null}
        onSelect={vi.fn()}
        steadyBar
      />,
    );
    // The empty shares stay in the row, collapsed and hidden, so their
    // lengths can glide back instead of popping in and out.
    expect(steady).toContain("Others: 0.0%");
    expect(steady).toContain("transition-[width,min-width,opacity]");
    expect(steady).toContain('aria-hidden="true"');

    const plain = ReactDOMServer.renderToStaticMarkup(
      <PortfolioHero
        total={10}
        count={1}
        scope="watched"
        subject="Vault"
        items={stablesOnly}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    // Everywhere else the bar keeps its mount-on-share behavior.
    expect(plain).not.toContain("Others");
    expect(plain).not.toContain("transition-[width,min-width,opacity]");
  });
});
