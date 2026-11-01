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

describe("MarkdownTable integration with Beautiful UI RecordsTable design", () => {
  it("renders a markdown table with RecordsTable shell and header bar", () => {
    const md = `
| Asset | Chain | Balance | Price |
| :--- | :--- | :--- | :--- |
| **NEAR** | NEAR | 120.5 | $5.20 |
| USDC | Arbitrum | 450.0 | $1.00 |
`;

    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    // BeautifulUI records-shell and records-table classes
    expect(html).toContain("records-shell");
    expect(html).toContain("records-table w-full");
    expect(html).toContain("records-scroll");
    expect(html).toContain("[scrollbar-gutter:auto]");

    // Header bar with Table Icon and Title
    expect(html).toContain("Asset Balances");
    expect(html).toContain("tabler-icon-table");

    // Unified Copy button segment (inline-flex, no wrap)
    expect(html).toContain("inline-flex items-center rounded-[6px]");
    expect(html).toContain("Copy");
    expect(html).toContain("Download");

    // Row number gutter: centered, width 44px, labeled No., rownum inline-flex to stay visible on hover, no ellipsis dot
    expect(html).toContain("records-rownum !w-full !h-full !inline-flex");
    expect(html).toContain("records-sticky-cell");
    expect(html).toContain("w-11 text-center");
    expect(html).toContain("!p-0 !overflow-visible !text-clip");
    expect(html).toContain("No.");

    // Numeric and currency columns are right-aligned with tabular-nums
    expect(html).toContain("text-right tabular-nums");

    // Strictly NO calculation footer row
    expect(html).not.toContain("records-calculation-row");
    expect(html).not.toContain("records-add-calculation");
    expect(html).not.toContain("<tfoot");
  });

  it("extracts custom title if specified in table properties", () => {
    const md = `
<table title="Asset Portfolio">
  <thead>
    <tr><th>Token</th><th>Amount</th></tr>
  </thead>
  <tbody>
    <tr><td>SOL</td><td>14.2</td></tr>
  </tbody>
</table>
`;

    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);
    expect(html).toContain("Asset Portfolio");
    expect(html).toContain("SOL");
    expect(html).toContain("14.2");
  });

  it("extracts preceding heading as table title", () => {
    const md = `
### Connected Wallet Balances
| Token | Amount |
| :--- | :--- |
| SOL | 14.2 |
`;
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);
    expect(html).toContain("Connected Wallet Balances");
    expect(html).toContain(
      '<span class="truncate font-medium leading-none text-ink">Connected Wallet Balances</span>',
    );
    expect(html).toContain('data-table-title=""');
  });

  it("aligns numbers and currency columns right while keeping row numbers centered", () => {
    const md = `
| Chain | Price | Change |
| :--- | :--- | :--- |
| Bitcoin | $79,120.40 | +2.4% |
| Ethereum | $2,740.10 | -1.1% |
`;

    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    // Header buttons for numeric columns have is-right and justify-end
    expect(html).toContain("records-header-button flex h-[35px] w-full items-center gap-1.5 px-2.5 font-medium text-[12.5px] text-ink-2 hover:text-ink transition-colors is-right justify-end !text-right");

    // Price and Change are detected as numeric columns and right-aligned with inline styles
    expect(html).toContain("text-right tabular-nums");
    expect(html).toContain("text-align:right");

    // Row numbers stay centered
    expect(html).toContain("records-cell records-sticky-cell text-center");

    // Table columns do not use font-mono
    expect(html).not.toContain("font-mono");

    // Copy button includes sliding text animation from bottom
    expect(html).toContain("translateY(6px)");
    expect(html).toContain("translateY(0)");
  });

  it("sizes columns proportionally based on content and omits resize handle on the last column", () => {
    const md = `
| Coin | Chain | Price |
| :--- | :--- | :--- |
| BTC | Bitcoin | $79,650 |
| SOL | Solana | $99.72 |
`;

    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    // Proportional percentage distribution prevents single column bloat
    expect(html).toContain('style="width:25.9%;min-width:70px"');
    expect(html).toContain('style="width:44.4%;min-width:110px"');
    expect(html).toContain('style="width:29.6%;min-width:96px"');

    // The last column (Price) does not render a resize handle (prevents overflow)
    expect(html).not.toContain('aria-label="Resize Price column"');

    // Earlier columns do have resize handles
    expect(html).toContain('aria-label="Resize Coin column"');
    expect(html).toContain('aria-label="Resize Chain column"');
  });

  it("deduplicates existing row index column from markdown to preserve clean gutter", () => {
    const md = `
| No. | Coin | Chain | Price |
| :--- | :--- | :--- | :--- |
| 1. | BTC | Bitcoin | $79,650 |
| 2. | SOL | Solana | $99.72 |
`;
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);
    expect(html).toContain("records-table");

    // Only one No. column rendered in the header, deduplicating markdown's row index column
    const noMatches = html.match(/>No\.<\/div>/g);
    expect(noMatches).toHaveLength(1);
    expect(html).not.toContain('aria-label="Resize No. column"');
  });

  it("never renders nested <td> elements inside records-cell", () => {
    const md = `
| Network | Asset | Balance |
| :--- | :--- | ---: |
| Arbitrum | USDC | 14.45 |
`;
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);
    expect(html).not.toMatch(/<td[^>]*>[^<]*<td/);
    expect(html).not.toContain('data-streamdown="table-cell"');
  });
});
