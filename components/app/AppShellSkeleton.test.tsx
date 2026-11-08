import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { AppShellSkeleton } from "@/components/app/AppShellSkeleton";

describe("AppShellSkeleton", () => {
  it("renders the real shell geometry as a measured sample", () => {
    const html = ReactDOMServer.renderToStaticMarkup(<AppShellSkeleton />);
    expect(html).toContain("skullet-loading");
    expect(html).toContain("skullet-status");
    expect(html).toContain("w-[235px]");
    expect(html).toContain("rounded-[14px]");
    expect(html).toContain("h-11");
    // Skullet reads each element's computed radius for its bone; without
    // these, every icon would be a sharp square.
    expect(html).toContain("[&amp;_svg]:rounded-[4px]");
    expect(html).toContain("[&amp;_img]:rounded-[6px]");
    // The thread sample is measured, not drawn from guessed boxes.
    expect(html).toContain("Swap 100 USDC for NEAR");
    expect(html).toContain("Loading chat.");
  });

  it("keeps the new-chat screen on the empty shape", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AppShellSkeleton variant="empty" />,
    );
    expect(html).toContain("Your money, in plain language");
    expect(html).toContain("Ask for a trade and watch it settle.");
    expect(html).toContain("min-h-full");
  });

  it("keeps the saved-thread screen on the thread shape", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AppShellSkeleton variant="thread" />,
    );
    expect(html).toContain("Loading chat.");
    expect(html).toContain("Checked your balances");
  });

  it("keeps the portfolio screen on the tabbed holdings shape", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AppShellSkeleton variant="portfolio" />,
    );
    expect(html).toContain("Your wallet");
    expect(html).toContain("Super account");
    expect(html).toContain("Search assets");
    // The skeleton bar is bare pills; labels live in the real content.
    expect(html).toContain("min-width:24px");
    expect(html).toContain("Loading your portfolio.");
    expect(html).not.toContain("Portfolio balances");
  });

  it("keeps the history screen on the shared history shape", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AppShellSkeleton variant="history" />,
    );
    expect(html).toContain("max-w-[860px]");
    // The shared HistoryList: real status pills, no hardcoded route.
    expect(html).toContain("Executed");
    expect(html).toContain("250.00");
    expect(html).not.toContain("Base → Ethereum");
    expect(html).toContain("Loading your history.");
  });

  it("renders the same history markup as the page skeleton", async () => {
    const { HistoryListSample } = await import(
      "@/components/app/HistoryList"
    );
    const shell = ReactDOMServer.renderToStaticMarkup(
      <AppShellSkeleton variant="history" />,
    );
    const sample = ReactDOMServer.renderToStaticMarkup(<HistoryListSample />);
    // The shell wraps the shared sample; every row in the sample
    // appears verbatim in the shell.
    for (const row of ["250.00", "0.0340", "75.00"]) {
      expect(sample).toContain(row);
      expect(shell).toContain(row);
    }
  });

  it("renders the same portfolio markup as the page skeleton", async () => {
    const { PortfolioSkeletonBody } = await import(
      "@/components/app/PortfolioSkeletonBody"
    );
    const { SAMPLE_PORTFOLIO } = await import(
      "@/components/app/portfolioCache"
    );
    const shell = ReactDOMServer.renderToStaticMarkup(
      <AppShellSkeleton variant="portfolio" />,
    );
    const sample = ReactDOMServer.renderToStaticMarkup(
      <PortfolioSkeletonBody snapshot={SAMPLE_PORTFOLIO} />,
    );
    for (const marker of ["Your wallet", "Super account", "USDC"]) {
      expect(sample).toContain(marker);
      expect(shell).toContain(marker);
    }
  });

  it("keeps the trash screen on the shared trash shape", async () => {
    const { TrashSample, TRASH_SAMPLE_ROWS } = await import(
      "@/components/app/TrashSample"
    );
    const html = ReactDOMServer.renderToStaticMarkup(
      <AppShellSkeleton variant="trash" />,
    );
    expect(html).toContain("Search deleted chats");
    expect(html).toContain("Loading your trash.");
    const sample = ReactDOMServer.renderToStaticMarkup(<TrashSample />);
    for (const row of TRASH_SAMPLE_ROWS) {
      expect(sample).toContain(row);
      expect(html).toContain(row);
    }
  });

  it("keeps the deleted-chat screen on the thread shape", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AppShellSkeleton variant="trash-thread" />,
    );
    expect(html).toContain("Deleted chat");
    expect(html).toContain("Restore");
    expect(html).toContain("Loading deleted chat.");
  });
});
