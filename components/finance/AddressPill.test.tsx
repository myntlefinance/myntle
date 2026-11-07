import { describe, it, expect } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { AddressPill } from "./AddressPill";

const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

describe("AddressPill", () => {
  it("shows the full address with its chain mark and a shortened mobile form", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AddressPill address={EVM} chain="evm" />,
    );

    expect(html).toContain(EVM);
    expect(html).toContain("0xd8dA…6045");
    expect(html).toContain('src="/wallets/evm.webp"');
    expect(html).toContain(`title="${EVM}"`);
    expect(html).toContain("rounded-full");
  });

  it("resolves the chain from the address when the caller omits it", () => {
    const solana = ReactDOMServer.renderToStaticMarkup(
      <AddressPill address={SOL} />,
    );
    expect(solana).toContain('src="/wallets/solana.webp"');

    const near = ReactDOMServer.renderToStaticMarkup(
      <AddressPill address="alice.near" />,
    );
    expect(near).toContain('src="/wallets/near.webp"');
    expect(near).toContain("alice.near");
  });

  it("prefers the explicit chain over address-shape detection", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AddressPill address={EVM} chain="near" />,
    );
    expect(html).toContain('src="/wallets/near.webp"');
    expect(html).not.toContain('src="/wallets/evm.webp"');
  });

  it("prefers the connected wallet mark over the chain mark", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AddressPill
        address={EVM}
        chain="near"
        walletIcon="/wallets/metamask.webp"
        walletName="MetaMask"
      />,
    );
    expect(html).toContain('src="/wallets/metamask.webp"');
    expect(html).toContain("MetaMask");
  });

  it("carries a copy control with the same address copy pattern", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AddressPill address={EVM} chain="evm" />,
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Copy address"');
    expect(html).toContain("<svg");
  });
});
