import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { TokenAvatar } from "./TokenAvatar";
import { NETWORK_ALIASES, NetworkIcon } from "./NetworkIcon";
import { BRAND_ICONS } from "./brandIcons.generated";

describe("NetworkIcon", () => {
  it("renders direct inline vector SVG for known network", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <NetworkIcon network="arbitrum" size={16} />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("width:16px");
    expect(html).toContain("#28A0F0");
    // Direct vector, not an <img> tag
    expect(html).not.toContain("<img");
  });

  it("normalizes alias like arb-mainnet to arbitrum", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <NetworkIcon network="arb-mainnet" size={16} />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("#28A0F0");
  });

  it("serves a network outside the inlined set from public/brand", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <NetworkIcon network="gnosis" size={16} />,
    );
    expect(html).toContain("<img");
    expect(html).toContain('src="/brand/networks/gnosis.svg?v=');
    expect(html).not.toContain(">G<");
  });

  it("serves a newly uploaded logo from public/brand", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <NetworkIcon network="xlayer" size={16} />,
    );
    expect(html).toContain("<img");
    expect(html).toContain('src="/brand/networks/xlayer.svg?v=');
  });

  it("serves raster brand artwork as a file, never as inline SVG", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <NetworkIcon network="neonevm" size={16} />,
    );
    expect(html).toContain('src="/brand/networks/neonevm.png?v=');
    expect(html).not.toContain("data:image/png;base64");
  });

  it("maps the catalogue slugs to the chain they settle on", () => {
    const cases: Array<[string, string]> = [
      ["hood", "robinhood"],
      ["hypercore", "hyperliquid"],
      ["zec", "zcash"],
      ["bsc", "bnb"],
      ["pol", "polygon"],
      ["bera", "berachain"],
      ["klaytn", "kaia"],
      ["abs", "abstract"],
      ["adi", "adichain"],
      ["ltc", "litecoin"],
      ["prl", "pearl"],
      ["qtc", "quantus"],
    ];
    for (const [slug, canonical] of cases) {
      expect(NETWORK_ALIASES[slug]).toBe(canonical);
    }
  });

  it("points every alias at a logo the app can draw", () => {
    const dead = Object.entries(NETWORK_ALIASES)
      .filter(
        ([alias, canonical]) =>
          alias !== canonical && !BRAND_ICONS[`network:${canonical}`],
      )
      .map(([alias, canonical]) => `${alias} -> ${canonical}`);
    expect(dead).toEqual([]);
  });
});

describe("TokenAvatar", () => {
  it("renders direct inline vector SVG for curated token symbol without <img> tag", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar symbol="USDC" size={28} />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("width:28px");
    expect(html).toContain("#2775ca");
    expect(html).not.toContain("<img");
  });

  it("renders Ethereum fitted inside circular badge without cropping", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar symbol="ETH" size={28} />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("bg-white");
    expect(html).toContain("padding:3.5px");
    expect(html).toContain("#343434");
    expect(html).not.toContain("<img");
  });

  it("serves a token outside the inlined set from public/brand", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar symbol="POL" size={28} />,
    );
    expect(html).toContain("<img");
    expect(html).toContain('src="/brand/tokens/pol.svg?v=');
    expect(html).not.toContain("llamao");
  });

  it("renders remote image tag fallback for arbitrary dynamic token", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar
        symbol="XYZ"
        logo="https://assets.example.com/xyz.png"
        size={28}
      />
    );
    expect(html).toContain("<img");
    expect(html).toContain('src="https://assets.example.com/xyz.png"');
  });

  it("uses an exact contract match instead of the ticker alone", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar
        symbol="USDC"
        chain="arb"
        contractAddress="0xAF88D065E77C8CC2239327C5EDB3A432268E5831"
        size={28}
      />,
    );
    expect(html).toContain("#2775ca");
    expect(html).not.toContain("<img");
  });

  it("uses an exact catalogue asset id when one is available", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar
        symbol="USDC"
        assetId="nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near"
        size={28}
      />,
    );
    expect(html).toContain("#2775ca");
  });

  it("never lends a same-ticker logo to an unregistered contract", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar
        symbol="USDC"
        chain="arb"
        contractAddress="0x0000000000000000000000000000000000000001"
        size={28}
      />,
    );
    expect(html).toContain(">U<");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img");
  });

  it("never falls through an unknown asset id to a ticker match", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar symbol="USDC" assetId="nep141:usdc.near" size={28} />,
    );
    expect(html).toContain(">U<");
    expect(html).not.toContain("<svg");
  });

  it("does not construct a third-party icon URL for an unknown token", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar
        symbol="PEPE"
        chain="ethereum"
        contractAddress="0x6982508145454ce325ddbe47a25d4ec3d2311933"
        size={28}
      />,
    );
    expect(html).toContain(">P<");
    expect(html).not.toContain("llamao");
    expect(html).not.toContain("<img");
  });

  it("renders a single-letter fallback when no source is available", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar symbol="UNKNOWN" size={28} />,
    );
    expect(html).toContain(">U<");
    expect(html).not.toContain(">UNK<");
  });

  it("renders direct inline vector network badge at bottom right", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar symbol="USDC" networkBadge="base" size={28} />,
    );
    // Token SVG (USDC)
    expect(html).toContain("#2775ca");
    // Badge SVG (Base #0000FF from official uploaded base.svg)
    expect(html).toContain("#0000FF");
  });

  it("reads as one skeleton block so the badge draws no second circle", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar symbol="USDC" networkBadge="base" size={28} />,
    );
    expect(html).toContain('skullet-block=""');
    expect(html).toContain("rounded-full");
  });

  it("draws NEAR and wNEAR with the green brand mark", () => {
    for (const symbol of ["NEAR", "wNEAR"]) {
      const html = ReactDOMServer.renderToStaticMarkup(
        <TokenAvatar symbol={symbol} size={28} />,
      );
      expect(html).toContain("#00EC97");
      expect(html).not.toContain("#000000");
    }
  });

  it("uses the same green mark for the NEAR network badge", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <NetworkIcon network="near" size={16} />,
    );
    expect(html).toContain("#00EC97");
    expect(html).not.toContain("#000000");
  });
});
