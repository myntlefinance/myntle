import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import type { SessionIdentity } from "@/lib/auth/session-identity";

const state = vi.hoisted(() => ({
  identity: null as SessionIdentity | null,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ identity: state.identity }),
}));

vi.mock("@/components/app/WalletButton", () => ({
  WalletButton: () => "wallet-button",
}));

vi.mock("@/components/app/PasskeyAccountButton", () => ({
  PasskeyAccountButton: () => "passkey-button",
}));

vi.mock("@/components/app/PasskeyDialog", () => ({
  OPEN_PASSKEY_EVENT: "myntle:open-passkey",
  PasskeyDialog: () => "passkey-dialog",
}));

vi.mock("@/components/app/SuperUnlockDialog", () => ({
  OPEN_SUPER_EVENT: "myntle:open-super",
  SuperUnlockDialog: () => "super-unlock-dialog",
}));

import { AccountControl } from "@/components/app/AccountControl";

const walletIdentity: SessionIdentity = {
  kind: "wallet",
  chain: "evm",
  address: "0x3259abcdef12345678901073",
  intentsAccountId: "0x3259abcdef12345678901073",
};

const passkeyIdentity: SessionIdentity = {
  kind: "passkey",
  chain: "near",
  address: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  accountId: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  intentsAccountId: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  credentialId: "credential-id",
  publicKey: "p256:public-key",
  rpId: "myntle.xyz",
};

describe("AccountControl", () => {
  it("renders the wallet control for a wallet session", () => {
    state.identity = walletIdentity;
    const html = ReactDOMServer.renderToStaticMarkup(<AccountControl />);
    expect(html).toContain("wallet-button");
    expect(html).not.toContain("passkey-button");
  });

  it("renders the passkey control for a passkey session", () => {
    state.identity = passkeyIdentity;
    const html = ReactDOMServer.renderToStaticMarkup(<AccountControl />);
    expect(html).toContain("passkey-button");
    expect(html).not.toContain("wallet-button");
  });

  it("renders the wallet control while signed out", () => {
    state.identity = null;
    const html = ReactDOMServer.renderToStaticMarkup(<AccountControl />);
    expect(html).toContain("wallet-button");
    expect(html).not.toContain("passkey-button");
  });
});
