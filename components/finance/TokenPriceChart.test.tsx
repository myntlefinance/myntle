import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

vi.mock("liveline", () => ({
  Liveline: (props: Record<string, unknown>) => {
    const data = Array.isArray(props.data) ? props.data : [];
    return (
      <div
        data-liveline
        data-empty-text={String(props.emptyText ?? "")}
        data-points={String(data.length)}
        data-value={String(props.value ?? "")}
      />
    );
  },
}));

import { TokenPriceChart } from "@/components/finance/TokenPriceChart";

describe("TokenPriceChart", () => {
  it("passes the no-data state to Liveline when there is no history", () => {
    const html = ReactDOMServer.renderToStaticMarkup(<TokenPriceChart />);
    expect(html).toContain("24h");
    expect(html).toContain('data-points="0"');
    expect(html).toContain('data-empty-text="No data to display"');
    expect(html).not.toContain("bg-inset");
    expect(html).not.toContain("shadow-hairline");
  });

  it("passes a 24-hour series through when one exists", () => {
    const now = Math.floor(Date.now() / 1000);
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenPriceChart
        points={[
          { time: now - 3600, value: 0.99 },
          { time: now, value: 1.01 },
        ]}
      />,
    );
    expect(html).toContain('data-points="2"');
    expect(html).toContain('data-value="1.01"');
    expect(html).toContain("+2.02%");
  });
});
