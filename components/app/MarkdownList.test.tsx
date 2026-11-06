import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { Markdown } from "@/components/app/Markdown";

describe("Markdown lists", () => {
  it("renders bullets list-outside so wrapped lines hang under the text", () => {
    const md = "- Short item\n- A much longer item that wraps onto a second line in a narrow container";
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    expect(html).toContain("list-outside");
    expect(html).toContain("list-disc");
    expect(html).toContain("pl-6");
    expect(html).not.toContain("list-inside");
  });

  it("replaces native task checkboxes with the styled marker and keeps the bullet", () => {
    const md = "- [ ] Balances & portfolio\n  - [x] Review supported assets";
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    // No grey native checkbox; bullet list styling untouched
    expect(html).not.toContain("<input");
    expect(html).toContain("md-task-check");
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('data-checked="true"');
    // Checked box draws the product check glyph
    expect(html).toContain("m5 12 4 4L19 6");
    // Task items render box and text as a row with the native bullet intact
    expect(html).toContain("task-list-item");
    expect(html).toContain("list-outside list-disc");
    expect(html).toContain("items-start");
    expect(html).not.toContain("list-none");
  });

  it("keeps plain bullets aligned with task items in a mixed list", () => {
    const md = "- [ ] A task item\n- A plain bullet";
    const html = ReactDOMServer.renderToString(<Markdown>{md}</Markdown>);

    expect(html).toContain("md-task-check");
    expect(html).toContain("list-outside list-disc");
    expect(html).not.toContain("list-none");
  });
});
