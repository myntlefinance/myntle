import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { AddressQrDialog, DepositButton } from "./AddressQrDialog";

vi.mock("@/components/app/DialogShell", () => ({
  DialogShell: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => <div data-dialog={title}>{children}</div>,
}));

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("AddressQrDialog", () => {
  it("shows the address as a locally generated QR code with its text", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AddressQrDialog
        address={ADDRESS}
        chain="evm"
        title="Your wallet"
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Your wallet");
    expect(html).toContain(ADDRESS);
    expect(html).toContain("Deposit address QR code");
    expect(html).toContain("<svg");
    // Locally generated pattern only: no remote image ever loads here.
    expect(html).not.toContain("<img");
    expect(html).toContain("Copy address");
    expect(html).toContain("View on explorer");
    expect(html).toContain(`https://blockscan.com/address/${ADDRESS}`);
    expect(html).toContain(
      "Only send tokens supported by this address. Tokens sent on an unsupported network or contract cannot be recovered.",
    );
  });

  it("offers a Deposit action that opens nothing until pressed", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <DepositButton address={ADDRESS} chain="evm" title="Your wallet" />,
    );

    expect(html).toContain("Deposit");
    // Closed by default: the action renders, the dialog does not.
    expect(html).not.toContain("Deposit address QR code");
    expect(html).not.toContain(ADDRESS);
  });
});
