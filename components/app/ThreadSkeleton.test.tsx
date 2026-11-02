import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { ThreadSkeleton } from "@/components/app/ThreadSkeleton";

describe("ThreadSkeleton", () => {
  it("renders with default padding", () => {
    const html = ReactDOMServer.renderToStaticMarkup(<ThreadSkeleton />);
    expect(html).toContain("Loading chat.");
    expect(html).toContain("padding-bottom:2rem");
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
