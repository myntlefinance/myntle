import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import type { ConnectedWallet } from "@/lib/wallet/types";

const state = vi.hoisted(() => ({
  account: null as ConnectedWallet | null,
  signedIn: false,
  signOut: vi.fn(),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({
    account: state.account,
    signedIn: state.signedIn,
    signIn: vi.fn(),
    signOut: state.signOut,
    busy: false,
  }),
}));

vi.mock("@/lib/intents/salt", () => ({
  prefetchIntentsSalt: vi.fn(),
}));

vi.mock("@/components/app/DialogShell", () => ({
  DialogShell: ({
    footerStart,
    footer,
    children,
  }: {
    footerStart?: React.ReactNode;
    footer?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <div>
      {children}
      {footerStart}
      {footer}
    </div>
  ),
}));

import { SignInDialog } from "./SignInDialog";

const WALLET: ConnectedWallet = {
  kind: "evm",
  standard: "erc191",
  address: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  walletName: "MetaMask",
  walletIcon: "/wallets/metamask.webp",
  signerId: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  publicKey: "",
};

function render() {
  return ReactDOMServer.renderToStaticMarkup(
    <SignInDialog onClose={() => {}} />,
  );
}

beforeEach(() => {
  state.account = null;
  state.signedIn = false;
  state.signOut.mockReset();
});

describe("SignInDialog", () => {
  it("shows the connected wallet's mark and short address", () => {
    state.account = WALLET;
    const html = render();
    expect(html).toContain("0x3259…1073");
    expect(html).toContain("/wallets/metamask.webp");
    expect(html).not.toContain("font-mono");
    expect(html).toContain("rounded-full");
    expect(html).toContain("border-line-strong");
    expect(html).toContain("Disconnect");
  });

  it("offers nothing to disconnect when no wallet is connected", () => {
    const html = render();
    expect(html).not.toContain("Disconnect");
    expect(html).not.toContain("0x3259…1073");
  });

  it("hides disconnect when the session already belongs to the account", () => {
    state.account = WALLET;
    state.signedIn = true;
    expect(render()).not.toContain("Disconnect");
  });
});
