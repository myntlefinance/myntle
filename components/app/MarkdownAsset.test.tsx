import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { Markdown } from "@/components/app/Markdown";

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({
    account: null,
    isConnected: false,
    isPending: false,
    connect: async () => {},
    disconnect: async () => {},
  }),
}));

function render(markdown: string) {
  return ReactDOMServer.renderToString(<Markdown>{markdown}</Markdown>);
}

describe("Markdown asset tags", () => {
  it("renders an asset tag in prose as a token pill", () => {
    const html = render(
      "Your private super-account balance is 4 <asset>USDC</asset>.",
    );
    expect(html).toContain("data-token-chip");
    expect(html).toContain("USDC");
    expect(html).toContain("#2775ca");
    expect(html).toContain("4 ");
  });

  it("leaves the tag literal inside a fenced code block", () => {
    const html = render("```text\n<asset>USDC</asset>\n```");
    expect(html).toContain("&lt;asset&gt;USDC&lt;/asset&gt;");
    expect(html).not.toContain("data-token-chip");
    expect(html).not.toContain("#2775ca");
  });

  it("leaves the tag literal inside inline code", () => {
    const html = render("`<asset>USDC</asset>`");
    expect(html).toContain("&lt;asset&gt;USDC&lt;/asset&gt;");
    expect(html).not.toContain("data-token-chip");
  });

  it("does not rewrite markdown characters inside code that contains the tag", () => {
    const html = render("```text\n<asset>**USDC** [x]</asset>\n```");
    expect(html).toContain("**USDC** [x]");
    expect(html).not.toContain("\\*\\*");
    expect(html).not.toContain("data-token-chip");
  });

  it("keeps the rest of an unclosed tag sentence outside the pill", () => {
    const html = render("Your balance is <asset>USDC after");
    expect(html).toContain("data-token-chip");
    expect(html).toContain("after");
    expect(html).not.toContain(">USDC after<");
  });

  it("recovers a self-closing tag with a symbol attribute", () => {
    const html = render('Your balance is <asset symbol="USDC" /> after');
    expect(html).toContain("data-token-chip");
    expect(html).toContain("USDC");
    expect(html).toContain("after");
  });

  it("recovers a bare self-closing tag without inventing a ticker", () => {
    const html = render("Your balance is <asset /> after");
    expect(html).not.toContain("data-token-chip");
    expect(html).toContain("after");
  });

  it("reads the ticker from the symbol attribute", () => {
    const html = render('<asset symbol="USDC"></asset>');
    expect(html).toContain("data-token-chip");
    expect(html).toContain("USDC");
  });
});
