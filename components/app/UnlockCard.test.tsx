import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import type { SessionIdentity } from "@/lib/auth/session-identity";
import { UnlockRequestCard } from "./UnlockCard";

const state = vi.hoisted(() => ({
  identity: null as unknown,
  unlocked: false,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ identity: state.identity }),
}));

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({ account: null }),
}));

vi.mock("@/lib/intents/user-session", () => ({
  useSuperUnlocked: () => state.unlocked,
  getValidAccessToken: async () => null,
  SUPER_CANCEL_EVENT: "myntle:super-cancel",
  SUPER_CONTINUE_EVENT: "myntle:super-continue",
}));

vi.mock("@/components/app/SuperUnlockDialog", () => ({
  openSuperUnlock: () => {},
}));

const SIX_MINUTES_AGO = Date.now() - 6 * 60_000;

const passkeyIdentity = {
  kind: "passkey",
  chain: "near",
  address: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  accountId: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  intentsAccountId: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  credentialId: "credential-id",
  publicKey: "p256:public-key",
  rpId: "myntle.xyz",
} as SessionIdentity;

const walletIdentity = {
  kind: "wallet",
  chain: "evm",
  address: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  intentsAccountId: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
} as SessionIdentity;

beforeEach(() => {
  state.identity = null;
  state.unlocked = false;
});

describe("UnlockRequestCard", () => {
  it("offers a new request when the live request has timed out", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={SIX_MINUTES_AGO}
        interactive
        superseded={false}
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Request expired.");
    expect(html).toContain("Prompt the agent for a new request.");
    expect(html).toContain("new request.</span></button>");
    expect(html).toContain("border-dashed");
  });

  it("keeps the prompt after a later user message, because it is a new request", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={SIX_MINUTES_AGO}
        interactive
        superseded
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Request expired.");
    expect(html).toContain("Prompt the agent for a new request");
  });

  it("does not offer an action outside the live chat", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={SIX_MINUTES_AGO}
        interactive={false}
        superseded
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Request expired.");
    expect(html).not.toContain("Prompt the agent");
  });

  it("keeps the primary action while the request is fresh", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={Date.now()}
        interactive
        superseded={false}
        onRetry={() => {}}
      />,
    );

    expect(html).toContain(
      "Please unlock your super account to continue.",
    );
    expect(html).toContain("Unlock");
    expect(html).not.toContain("Prompt the agent");
  });

  it("names the private balance for a passkey account", () => {
    state.identity = passkeyIdentity;
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={Date.now()}
        interactive
        superseded={false}
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Private balance locked");
    expect(html).toContain(
      "Please unlock your private balance to continue.",
    );
    expect(html).not.toContain("Super account");
    expect(html).not.toContain("wallet");
  });

  it("says the private balance is unlocked for a passkey account", () => {
    state.identity = passkeyIdentity;
    state.unlocked = true;
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={Date.now()}
        interactive
        superseded={false}
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Private balance unlocked");
    expect(html).toContain("Myntle can read your private balance.");
    expect(html).not.toContain("Super account");
  });

  it("keeps the wallet copy for a wallet account", () => {
    state.identity = walletIdentity;
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={Date.now()}
        interactive
        superseded={false}
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Super account locked");
    expect(html).toContain(
      "Please unlock your super account to continue.",
    );
  });

  it("keeps a resolved unlock green after the five-minute request window", () => {
    state.identity = walletIdentity;
    state.unlocked = false;
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={SIX_MINUTES_AGO}
        interactive
        superseded={false}
        resolved
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Super account unlocked");
    expect(html).not.toContain("Request expired.");
  });

  it("keeps a resolved unlock green after a newer message and outside the live chat", () => {
    state.identity = walletIdentity;
    state.unlocked = false;
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={SIX_MINUTES_AGO}
        interactive={false}
        superseded
        resolved
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Super account unlocked");
    expect(html).not.toContain("Request expired.");
  });

  it("does not turn an old card green just because the account is unlocked now", () => {
    state.identity = walletIdentity;
    state.unlocked = true;
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={SIX_MINUTES_AGO}
        interactive
        superseded
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Request expired.");
    expect(html).not.toContain("Super account unlocked");
  });

  it("keeps the unlocked wallet copy for a wallet account", () => {
    state.identity = walletIdentity;
    state.unlocked = true;
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={Date.now()}
        interactive
        superseded={false}
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Super account unlocked");
    expect(html).toContain("Myntle has access to your super account.");
    expect(html).not.toContain("Private balance unlocked");
  });

  it("forces the lock action while the private read refuses a live session", () => {
    state.identity = walletIdentity;
    state.unlocked = true;
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={null}
        interactive
        superseded={false}
        live
        forceLocked
      />,
    );

    expect(html).toContain("Super account locked");
    expect(html).toContain("Please unlock your super account to continue.");
    expect(html).toContain("Unlock");
    expect(html).not.toContain("Super account unlocked");
  });

  it("lets the live gate show the unlocked state when the read succeeds", () => {
    state.identity = walletIdentity;
    state.unlocked = true;
    const html = ReactDOMServer.renderToStaticMarkup(
      <UnlockRequestCard
        createdAt={null}
        interactive
        superseded={false}
        live
      />,
    );

    expect(html).toContain("Super account unlocked");
    expect(html).not.toContain("Super account locked");
  });
});
