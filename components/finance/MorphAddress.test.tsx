import { describe, expect, it } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { MorphAddress } from "./MorphAddress";

describe("MorphAddress", () => {
  it("renders the current address as readable text", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <p>
        <MorphAddress value="myntle.near" />
      </p>,
    );

    expect(html).toContain("myntle.near");
    expect(html).toContain("sr-only");
    // The visible layer is hidden from assistive tech; the sr-only copy
    // is the one the page reads.
    expect(html).toContain('aria-hidden="true"');
  });

  it("paints plainly in the skeleton and reduced states", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <MorphAddress value="0xaf88d065e77c8cC2239327C5EDb3A432268e5831" animate={false} />,
    );

    expect(html).toContain("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
    expect(html).not.toContain("sr-only");
  });
});
