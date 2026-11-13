import { describe, expect, it } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { WalletAddressRow } from "./WalletAddressRow";

const ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

function renderRow(refreshDisabled = false) {
  return ReactDOMServer.renderToStaticMarkup(
    <WalletAddressRow
      address={ADDRESS}
      chain="evm"
      qrTitle="Your wallet"
      onRefresh={() => {}}
      refreshDisabled={refreshDisabled}
      total={10}
      animate={false}
    />,
  );
}

describe("WalletAddressRow", () => {
  it("offers the refresh mark while the account is readable", () => {
    const html = renderRow();
    expect(html).toContain("Refresh balances");
    expect(html).not.toContain('disabled=""');
  });

  it("keeps copy beside the address and Deposit at the far edge", () => {
    const html = renderRow();
    const addressAt = html.indexOf(ADDRESS);
    const copyAt = html.indexOf("Copy address");
    const depositAt = html.indexOf("Deposit");

    expect(addressAt).toBeGreaterThan(-1);
    expect(copyAt).toBeGreaterThan(addressAt);
    expect(depositAt).toBeGreaterThan(copyAt);
  });

  it("keeps the refresh mark but disables it while the account is locked", () => {
    const html = renderRow(true);
    expect(html).toContain("Refresh balances");
    // The control stays in place so the row never reflows on unlock, but
    // a locked account cannot start a read that the gate cannot settle.
    expect(html).toContain('<button type="button" title="Refresh balances"');
    expect(html).toContain('disabled=""');
  });
});
