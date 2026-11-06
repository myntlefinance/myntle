import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { AssetPill } from "@/components/app/AssetPill";

function render(children: React.ReactNode, props: Record<string, unknown> = {}) {
  return ReactDOMServer.renderToStaticMarkup(
    <AssetPill {...props}>{children}</AssetPill>,
  );
}

describe("AssetPill", () => {
  it("renders a token chip with the official USDC mark", () => {
    const html = render("USDC");
    expect(html).toContain("data-token-chip");
    expect(html).toContain("USDC");
    expect(html).toContain("#2775ca");
    // The chip is focusable and opens its detail card on hover/focus; the
    // card itself is client-only and must not be in the SSR markup.
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="dialog"');
  });

  it("keeps trailing prose outside the chip when the tag was not closed", () => {
    const html = render("USDC after");
    expect(html).toContain("data-token-chip");
    expect(html).toContain("USDC");
    expect(html).toContain("after");
    expect(html).not.toContain(">USDC after<");
  });

  it("does not turn an amount into a ticker", () => {
    const html = render("4 USDC");
    expect(html).not.toContain("data-token-chip");
    expect(html).toContain("4 USDC");
  });

  it("does not turn an ordinary lowercase word into a ticker", () => {
    const html = render("after");
    expect(html).not.toContain("data-token-chip");
    expect(html).toContain("after");
  });

  it("reads the ticker from the symbol attribute and keeps the rest", () => {
    const html = render("after", { symbol: "USDC" });
    expect(html).toContain("data-token-chip");
    expect(html).toContain("USDC");
    expect(html).toContain("after");
  });

  it("accepts a known lowercase ticker", () => {
    const html = render("usdc");
    expect(html).toContain("data-token-chip");
    expect(html).toContain("USDC");
  });
});
