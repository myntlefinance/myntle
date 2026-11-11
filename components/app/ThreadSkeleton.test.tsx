import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { ThreadSkeleton } from "@/components/app/ThreadSkeleton";

describe("ThreadSkeleton", () => {
  it("renders a measured sample with the default padding", () => {
    const html = ReactDOMServer.renderToStaticMarkup(<ThreadSkeleton />);
    expect(html).toContain("Loading chat.");
    expect(html).toContain("skullet-status");
    expect(html).toContain("padding-bottom:2rem");
    // The sample carries the real turn shape: user bubble, activity pill,
    // reply, and the action row that reserves its height.
    expect(html).toContain("Swap 100 USDC for NEAR");
    expect(html).toContain("Checked your balances");
    expect(html).toContain("[&amp;_svg]:rounded-[4px]");
    expect(html).toContain("[&amp;_img]:rounded-[6px]");
  });

  it("applies bottomPad when provided", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <ThreadSkeleton bottomPad={166} />,
    );
    expect(html).toContain("padding-bottom:166px");
  });

  it("adapts classes when narrow is true", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <ThreadSkeleton narrow />,
    );
    expect(html).toContain("px-4");
    expect(html).not.toContain("sm:px-8");
  });
});
