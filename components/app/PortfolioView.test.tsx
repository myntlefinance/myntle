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
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("skullet/react", () => ({
  Skeleton: ({
    children,
    sample,
  }: {
    children: (value: unknown) => React.ReactNode;
    sample: unknown;
  }) => <>{children(sample)}</>,
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

vi.mock("@/components/app/portfolioQueries", () => ({
  usePortfolio: state.usePortfolio,
}));

vi.mock("@/components/app/PasskeyPortfolio", () => ({
  PasskeyPortfolio: ({ accountId }: { accountId: string }) =>
    `passkey-portfolio:${accountId}`,
}));

vi.mock("@/components/finance/AssetMatrix", () => ({
  AssetMatrix: ({
    groups,
    title,
  }: {
    groups: Array<{ items: Array<{ symbol: string }> }>;
    title: string;
  }) => (
    <div>
      {title}{" "}
      {groups.flatMap((group) =>
        group.items.map((item) => item.symbol).join(","),
      )}
    </div>
  ),
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
          category: "stables",
        },
      ],
    },
  ],
  totalUsd: 10,
};

beforeEach(() => {
  state.usePortfolio.mockReset();
  state.usePortfolio.mockReturnValue({
    snapshot: WALLET_SNAPSHOT,
    error: null,
    authExpired: false,
    isPending: false,
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

    expect(html).toContain("Portfolio balances");
    expect(html).toContain("USDC");
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
});
