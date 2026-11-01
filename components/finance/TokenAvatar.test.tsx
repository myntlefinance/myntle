import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { TokenAvatar } from "./TokenAvatar";
import { NetworkIcon } from "./NetworkIcon";

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
    expect(html).toContain("p-[3.5px]");
    expect(html).toContain("#343434");
    expect(html).not.toContain("<img");
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

  it("falls back to DefiLlama CDN when contract and chain are provided", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar
        symbol="PEPE"
        chain="ethereum"
        contractAddress="0x6982508145454ce325ddbe47a25d4ec3d2311933"
        size={28}
      />
    );
    expect(html).toContain(
      'src="https://icons.llamao.fi/token/ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933"',
    );
  });

  it("renders monogram fallback when no source is available", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar symbol="UNKNOWN" size={28} />,
    );
    expect(html).toContain("UNK");
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
});
