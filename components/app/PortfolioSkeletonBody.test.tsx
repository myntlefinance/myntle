import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { parsePortfolioTab } from "./portfolioTabs";
import { PortfolioSkeletonBody } from "./PortfolioSkeletonBody";
import { SAMPLE_PORTFOLIO } from "./portfolioCache";

vi.mock("skullet/react", () => ({
  Skeleton: ({
    children,
    sample,
  }: {
    children: (value: unknown) => React.ReactNode;
    sample: unknown;
  }) => <>{children(sample)}</>,
}));

/**
 * The page skeleton replays the opening tab.
 *
 * The server reads `?tab=` into `initialTab`, so the first paint —
 * switcher, sentence, and body — already agrees with the URL instead
 * of flashing the wallet first. Unknown values fall back to the wallet.
 */

describe("parsePortfolioTab", () => {
  it("maps the known tab values", () => {
    expect(parsePortfolioTab("super")).toBe("Super account");
    expect(parsePortfolioTab("watched")).toBe("Watchlist");
  });

  it("falls back to the wallet for anything else", () => {
    expect(parsePortfolioTab("wallet")).toBe("Your wallet");
    expect(parsePortfolioTab(undefined)).toBe("Your wallet");
    expect(parsePortfolioTab("evm:0x123")).toBe("Your wallet");
  });
});

describe("PortfolioSkeletonBody", () => {
  it("replays the watchlist list shape on a watched visit", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PortfolioSkeletonBody snapshot={SAMPLE_PORTFOLIO} tab="Watchlist" />,
    );

    expect(html).toContain("Watchlist");
    expect(html).toContain("Watch new");
    expect(html).toContain("Vault");
    // The detail is a second read; the shell must not promise it before
    // the list has even said whether there is an address to watch.
    expect(html).not.toContain("Watching Vault");
    expect(html).not.toContain("Your wallet holds");
  });

  it("names the super account on a super visit", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PortfolioSkeletonBody snapshot={SAMPLE_PORTFOLIO} tab="Super account" />,
    );

    expect(html).toContain("Super account");
    expect(html).toContain("Your super account holds");
    expect(html).not.toContain("Your wallet holds");
  });

  it("keeps the wallet shape by default", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <PortfolioSkeletonBody snapshot={SAMPLE_PORTFOLIO} />,
    );

    expect(html).toContain("Your wallet holds");
  });
});
