import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

import { TokenPriceChart } from "@/components/finance/TokenPriceChart";

describe("TokenPriceChart", () => {
  it("draws the no-data state without a chart", () => {
    const html = ReactDOMServer.renderToStaticMarkup(<TokenPriceChart />);
    expect(html).toContain("24h");
    expect(html).toContain("No data to display");
    expect(html).toContain(
      'aria-label="24 hour price chart. No data to display."',
    );
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<canvas");
  });

  it("draws a 24-hour series as a static path", () => {
    const now = Math.floor(Date.now() / 1000);
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenPriceChart
        points={[
          { time: now - 3600, value: 0.99 },
          { time: now, value: 1.01 },
        ]}
      />,
    );
    expect(html).toContain("+2.02%");
    expect(html).toContain('aria-label="24 hour price chart"');
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
    // A canvas is what replayed the reveal animation on every hover.
    expect(html).not.toContain("<canvas");
  });
});
