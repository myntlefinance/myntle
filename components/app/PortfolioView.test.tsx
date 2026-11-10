import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import type { SessionIdentity } from "@/lib/auth/session-identity";
import type { PortfolioSnapshot } from "./portfolioCache";

const ACCOUNT = "0x4f3a7c1d2e5b8a9c0d1e2f3a4b5c6d7e8f901234";
const WALLET = "0x32596df10ff2ac5acde8406e6adcc8d047921073";

const state = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  usePortfolio: vi.fn(),
  useWatchedPortfolio: vi.fn(),
  useWatchlist: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("skullet/react", () => ({
  Skeleton: ({
    children,
    data,
    sample,
  }: {
    children: (value: unknown) => React.ReactNode;
    data: unknown;
    sample: unknown;
  }) => <>{children(data ?? sample)}</>,
}));

vi.mock("@/components/primitives/SidebarNav", () => ({
  default: () => "sidebar",
}));

vi.mock("@/components/app/AccountControl", () => ({
  AccountControl: () => "account-control",
}));

vi.mock("@/components/app/ConnectGate", () => ({
  openWalletPicker: vi.fn(),
}));

vi.mock("@/components/app/SignInDialog", () => ({
  openSignIn: vi.fn(),
}));

vi.mock("@/components/app/PasskeyDialog", () => ({
  openPasskeyDialog: vi.fn(),
}));

vi.mock("@/lib/auth/passkey-client", () => ({
  usePasskeysAvailable: () => true,
}));

vi.mock("@/components/app/threadQueries", () => ({
  useThreads: () => ({ data: [] }),
  useTrashed: () => ({ data: [] }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    getQueryData: () => undefined,
    setQueryData: () => undefined,
  }),
}));

vi.mock("@/components/app/portfolioQueries", () => ({
  usePortfolio: state.usePortfolio,
  useWatchedPortfolio: state.useWatchedPortfolio,
}));

vi.mock("@/components/app/useWatchlist", () => ({
  useWatchlist: state.useWatchlist,
}));

vi.mock("@/components/app/PasskeyPortfolio", () => ({
  PasskeyPortfolio: ({ accountId }: { accountId: string }) =>
    `passkey-portfolio:${accountId}`,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => state.auth,
}));

import PortfolioView from "./PortfolioView";

const walletIdentity: SessionIdentity = {
  kind: "wallet",
  chain: "evm",
  address: WALLET,
  intentsAccountId: WALLET,
};

const passkeyIdentity: SessionIdentity = {
  kind: "passkey",
  chain: "near",
  address: ACCOUNT,
  accountId: ACCOUNT,
  intentsAccountId: ACCOUNT,
  credentialId: "credential-id",
  publicKey: "p256:public-key",
  rpId: "myntle.xyz",
};

const WALLET_SNAPSHOT: PortfolioSnapshot = {
  groups: [
    {
      id: "base",
      name: "Base",
      icon: "base",
      items: [
        {
          id: "base-usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "10",
          valueUsd: 10,
          priceUsd: 1,
          category: "stables",
        },
      ],
    },
    {
      id: "settlement",
      name: "Settlement Ledger",
      icon: "near",
      items: [
        {
          id: "intents-usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "5",
          valueUsd: 5,
          priceUsd: 1,
          category: "stables",
        },
      ],
    },
  ],
  totalUsd: 15,
  walletGroups: [
    {
      id: "base",
      name: "Base",
      icon: "base",
      items: [
        {
          id: "base-usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "10",
          valueUsd: 10,
          priceUsd: 1,
          category: "stables",
        },
      ],
    },
  ],
  superGroups: [
    {
      id: "settlement",
      name: "Settlement Ledger",
      icon: "near",
      items: [
        {
          id: "intents-usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "5",
          valueUsd: 5,
          priceUsd: 1,
          category: "stables",
        },
      ],
    },
  ],
  walletUsd: 10,
  superUsd: 5,
};

beforeEach(() => {
  state.usePortfolio.mockReset();
  state.usePortfolio.mockReturnValue({
    snapshot: WALLET_SNAPSHOT,
    error: null,
    authExpired: false,
    isPending: false,
  });
  state.useWatchedPortfolio.mockReset();
  state.useWatchedPortfolio.mockReturnValue({
    snapshot: null,
    error: null,
    authExpired: false,
    isPending: false,
    refresh: vi.fn(),
  });
  state.useWatchlist.mockReset();
  state.useWatchlist.mockReturnValue({
    entries: [],
    isPending: false,
    error: null,
    refresh: vi.fn(),
    add: vi.fn(),
    addError: null,
    isAdding: false,
    remove: vi.fn(),
    removeError: null,
    isRemoving: false,
  });
});

describe("PortfolioView branches", () => {
  it("keeps the wallet portfolio on the wallet balances route", () => {
    state.auth = {
      account: { kind: "evm", address: WALLET },
      connected: true,
      signedIn: true,
      status: "signed-in",
      identity: walletIdentity,
    };

    const html = ReactDOMServer.renderToStaticMarkup(<PortfolioView />);

    expect(html).toContain("Your wallet");
    expect(html).toContain("Super account");
    expect(html).toContain("Watchlist");
    expect(html).toContain("myntle-logo.svg");
    expect(html).toContain("Your wallet holds $10.00 across 1 asset.");
    expect(html).toContain("USDC");
    expect(html).toContain("Search assets");
    expect(html).not.toContain("passkey-portfolio");
    expect(state.usePortfolio).toHaveBeenCalledWith("evm", WALLET, true);
  });

  it("reads no wallet balance for a passkey account", () => {
    state.auth = {
      account: null,
      connected: false,
      signedIn: true,
      status: "signed-in",
      identity: passkeyIdentity,
    };

    const html = ReactDOMServer.renderToStaticMarkup(<PortfolioView />);

    expect(html).toContain(`passkey-portfolio:${ACCOUNT}`);
    expect(html).not.toContain("Connect Wallet");
    expect(html).not.toContain("Private balances are being connected.");
    expect(state.usePortfolio).toHaveBeenCalledWith(null, null, false);
  });

  it("offers one log-in action to a connected wallet without a session", () => {
    // The state left behind by a sign-out that has not finished severing the
    // wallet must not read as a different, second account action.
    state.auth = {
      account: { kind: "evm", address: WALLET },
      connected: true,
      signedIn: false,
      status: "signed-out",
      identity: null,
    };

    const html = ReactDOMServer.renderToStaticMarkup(<PortfolioView />);

    expect(html).toContain("Please log in to view your portfolio and balances.");
    expect(html).toContain("Log In");
    expect(html).not.toContain("Sign In");
  });
});
