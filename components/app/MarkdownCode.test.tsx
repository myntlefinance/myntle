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

describe("MarkdownCode integration with Beautiful UI CodeBlock", () => {
  it("renders inline code as a monospace chip", () => {
    const md = "Use `account_id` to verify.";
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    expect(html).toContain("account_id");
    expect(html).toContain("bg-inset");
    expect(html).toContain("font-mono");
    // Ensure it is not wrapped in a full card
    expect(html).not.toContain("shadow-card");
  });

  it("renders blockchain address as a quiet TechDataChip without an outline", () => {
    const md = "Connected wallet: `0x32596df10ff2ac5acde8406e6adcc8d047921073`";
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    expect(html).toContain("0x32596df10ff2ac5acde8406e6adcc8d047921073");
    expect(html).toContain("bg-field");
    expect(html).not.toContain("border-accent");
    expect(html).toContain("Copy EVM address: 0x32596df10ff2ac5acde8406e6adcc8d047921073");
    // The chip reads in the body typeface, with no copy glyph to compete with the address
    expect(html).not.toContain("font-mono");
    expect(html).not.toContain("<svg");
    // It inherits the reply's size and weight instead of setting its own,
    // so the address never looks thinner than the sentence around it
    expect(html).not.toContain("text-[12px]");
  });

  it("renders fenced code block with Beautiful UI CodeBlock and language pill", () => {
    const md = `\`\`\`typescript filename="churn.ts"
export async function churnBatch() {
  return 42;
}
\`\`\``;
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    // Card styling
    expect(html).toContain("shadow-card");
    expect(html).toContain("rounded-card");
    // Filename in header
    expect(html).toContain("churn.ts");
    // Programming language pill with colorful badge styling
    expect(html).toContain("typescript");
    expect(html).toContain("text-blue-600");

    // Brand logo
    expect(html).toContain("tabler-icon-brand-typescript");

    // Spacious integer line height, baseline alignment, and gutter
    expect(html).toContain("leading-[23px]");
    expect(html).toContain("items-baseline");
    expect(html).toContain("left-[44px]");
    expect(html).toContain("grid-cols-[44px_minmax(0,1fr)]");

    // Slide animation structure in copy button
    expect(html).toContain("translateY(0)");
    expect(html).toContain("translateY(5px)");
    expect(html).toContain("w-[68px]");
    // Syntax highlighted tokens
    expect(html).toContain("export");
    expect(html).toContain("churnBatch");
  });

  it("resolves default snippet filename based on language extension when omitted", () => {
    const md = `\`\`\`python
def churn():
  return True
\`\`\``;
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    expect(html).toContain("snippet.py");
    expect(html).toContain("python");
    expect(html).toContain("churn");
  });

  it("renders unified diff blocks with diff stats and row tints", () => {
    const md = `\`\`\`diff
@@ -1,2 +1,2 @@
-let temp = "-14C";
+let temp = "-16C";
\`\`\``;
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    expect(html).toContain("snippet.diff");
    expect(html).toContain("diff");
    expect(html).toContain("bg-red-tint");
    expect(html).toContain("bg-green-tint");
  });

  it("renders 64 lines with consistent baseline-aligned rows and empty line handling", () => {
    const lines = Array.from({ length: 64 }, (_, i) =>
      i % 5 === 0 ? "" : `const line${i + 1} = ${i + 1};`,
    ).join("\n");
    const md = `\`\`\`typescript\n${lines}\n\`\`\``;
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    // Line 64 exists and has baseline alignment and exact integer leading
    expect(html).toContain(">64</span>");
    expect(html).toContain("line64");
    expect(html).toContain("items-baseline");
    expect(html).toContain("leading-[23px]");
    // Empty lines contain non-breaking space for strict baseline preservation
    expect(html).toContain("\u00A0");
  });

  it("routes mermaid blocks to PeleDiagram", () => {
    const md = `\`\`\`mermaid
graph TD;
A-->B;
\`\`\``;
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    expect(html).toContain("pele-diagram");
  });
});
