import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import type { SessionIdentity } from "@/lib/auth/session-identity";
import type { PortfolioSnapshot } from "./portfolioCache";

const ACCOUNT = "0x4f3a7c1d2e5b8a9c0d1e2f3a4b5c6d7e8f901234";
const WALLET = "0x32596df10ff2ac5acde8406e6adcc8d047921073";

const state = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  unlocked: false,
  priv: {} as Record<string, unknown>,
  usePortfolio: vi.fn(),
  useWatchedPortfolio: vi.fn(),
  useWatchlist: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("skullet/react", () => ({
  Skeleton: ({
    children,
    data,
    label,
  }: {
    children: (value: unknown) => React.ReactNode;
    data: unknown;
    label?: string;
  }) => <>{data == null ? (label ?? null) : children(data)}</>,
}));

vi.mock("@/lib/intents/user-session", () => ({
  useSuperUnlocked: () => state.unlocked,
  getValidAccessToken: vi.fn(),
  notifySuperClosed: vi.fn(),
  notifySuperUnlock: vi.fn(),
  saveIntentsSession: vi.fn(),
  SUPER_UNLOCK_EVENT: "myntle:super-unlock",
  SUPER_LOCK_EVENT: "myntle:super-lock",
  SUPER_CLOSED_EVENT: "myntle:super-closed",
  SUPER_CONTINUE_EVENT: "myntle:super-continue",
  SUPER_CANCEL_EVENT: "myntle:super-cancel",
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
    prefetchQuery: () => Promise.resolve(),
  }),
}));

vi.mock("@/components/app/portfolioQueries", () => ({
  usePortfolio: state.usePortfolio,
  useWatchedPortfolio: state.useWatchedPortfolio,
  useSuperPrivateBalances: () => state.priv,
}));

vi.mock("@/components/app/useWatchlist", () => ({
  useWatchlist: state.useWatchlist,
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
      name: "Near Intents",
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
      name: "Near Intents",
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
  state.unlocked = false;
  state.priv = {
    status: "pending",
    snapshot: null,
    isPending: true,
    isRefreshing: false,
    refresh: vi.fn(),
  };
  state.usePortfolio.mockReset();
  state.usePortfolio.mockReturnValue({
    snapshot: WALLET_SNAPSHOT,
    error: null,
    authExpired: false,
    isPending: false,
    isRefreshing: false,
    refresh: vi.fn(),
  });
  state.useWatchedPortfolio.mockReset();
  state.useWatchedPortfolio.mockReturnValue({
    snapshot: null,
    error: null,
    authExpired: false,
    isPending: false,
    isRefreshing: false,
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
    expect(state.usePortfolio).toHaveBeenCalledWith("evm", WALLET, true);
    // The section names its address, with the copy mark beside it and
    // the Deposit action at the far edge.
    expect(html).toContain(WALLET);
    expect(html).toContain("Copy address");
    expect(html).toContain("Deposit");
    expect(html).toContain("Refresh balances");
    // Switching between the account layouts replays one page entrance.
    expect(html).toContain("animate-[fade-up");
  });

  it("keeps the tabbed portfolio for a passkey account, without a wallet tab", () => {
    state.auth = {
      account: null,
      connected: false,
      signedIn: true,
      status: "signed-in",
      identity: passkeyIdentity,
    };
    state.usePortfolio.mockReturnValue({
      snapshot: null,
      error: null,
      authExpired: false,
      isPending: false,
      isRefreshing: false,
      refresh: vi.fn(),
    });

    const html = ReactDOMServer.renderToStaticMarkup(<PortfolioView />);

    // The layout is the same page: its tabs, identity row, and gate.
    expect(html).toContain("Super account");
    expect(html).toContain("Watchlist");
    expect(html).not.toContain("Your wallet");
    expect(html).toContain(ACCOUNT);
    expect(html).toContain("Copy address");
    expect(html).toContain("Private balance locked");
    // The passkey account reads its private ledger, and the watchlist is
    // session-scoped, so it stays available with no connected wallet.
    expect(state.usePortfolio).toHaveBeenCalledWith(null, null, false);
    expect(state.useWatchlist).toHaveBeenCalledWith(true);
  });

  it("holds the passkey skeleton instead of painting sample balances", () => {
    state.auth = {
      account: null,
      connected: false,
      signedIn: true,
      status: "signed-in",
      identity: passkeyIdentity,
    };
    state.unlocked = true;
    state.usePortfolio.mockReturnValue({
      snapshot: null,
      error: null,
      authExpired: false,
      isPending: false,
      isRefreshing: false,
      refresh: vi.fn(),
    });

    const html = ReactDOMServer.renderToStaticMarkup(<PortfolioView />);

    expect(html).toContain("Reading your super account.");
    // The sample that measures the skeleton must never read as a balance.
    expect(html).not.toContain("$896.98");
    expect(html).not.toContain("$320.50");
    expect(html).not.toContain("USDC");
  });

  it("paints the passkey private ledger inside the shared chrome", () => {
    state.auth = {
      account: null,
      connected: false,
      signedIn: true,
      status: "signed-in",
      identity: passkeyIdentity,
    };
    state.unlocked = true;
    state.priv = {
      status: "loaded",
      snapshot: {
        groups: [
          {
            id: "private-balance",
            name: "Private balance",
            icon: "near",
            items: [
              {
                id: "private-usdc",
                symbol: "USDC",
                name: "USDC",
                amount: "2.5",
                valueUsd: 2.5,
                priceUsd: 1,
                category: "stables",
                chain: "near",
                network: "intents",
              },
            ],
          },
        ],
        totalUsd: 2.5,
        walletGroups: [],
        superGroups: [],
        walletUsd: 0,
        superUsd: 2.5,
      },
      isPending: false,
      isRefreshing: false,
      refresh: vi.fn(),
    };
    state.usePortfolio.mockReturnValue({
      snapshot: null,
      error: null,
      authExpired: false,
      isPending: false,
      isRefreshing: false,
      refresh: vi.fn(),
    });

    const html = ReactDOMServer.renderToStaticMarkup(<PortfolioView />);

    expect(html).toContain("Super account");
    expect(html).toContain("Watchlist");
    expect(html).toContain("Your super account holds $2.50 across 1 asset.");
    expect(html).toContain("USDC");
    expect(html).toContain("$2.50");
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
