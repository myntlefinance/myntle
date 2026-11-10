import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import type { SessionIdentity } from "@/lib/auth/session-identity";
import { SuperAccountTab, mergeSuperGroups } from "./SuperAccountTab";
import type { AssetGroup } from "@/lib/wallet/balances";
import type { PortfolioSnapshot } from "./portfolioCache";

const WALLET = "0x32596df10ff2ac5acde8406e6adcc8d047921073";

const state = vi.hoisted(() => ({
  unlocked: null as boolean | null,
  priv: {} as Record<string, unknown>,
}));

vi.mock("@/lib/intents/user-session", () => ({
  useSuperUnlocked: () => state.unlocked,
  SUPER_UNLOCK_EVENT: "myntle:super-unlock",
  SUPER_LOCK_EVENT: "myntle:super-lock",
  SUPER_CLOSED_EVENT: "myntle:super-closed",
}));

vi.mock("./portfolioQueries", () => ({
  useSuperPrivateBalances: () => state.priv,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({
    identity: {
      kind: "wallet",
      chain: "evm",
      address: WALLET,
      intentsAccountId: WALLET,
    } satisfies SessionIdentity,
  }),
}));

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({
    account: { kind: "evm", address: WALLET },
  }),
}));

vi.mock("@/components/app/SuperUnlockDialog", () => ({
  openSuperUnlock: vi.fn(),
}));

const PUBLIC: AssetGroup[] = [
  {
    id: "settlement",
    name: "Settlement Ledger",
    icon: "near",
    items: [
      {
        id: "pub-usdc",
        symbol: "USDC",
        name: "USD Coin",
        amount: "10",
        valueUsd: 10,
        priceUsd: 1,
        category: "stables",
        contractAddress: "token-c1",
        chain: "near",
        network: "intents",
      },
    ],
  },
];

const PRIVATE: PortfolioSnapshot = {
  groups: [
    {
      id: "private-balance",
      name: "Private balance",
      icon: "near",
      items: [
        {
          id: "priv-eth",
          symbol: "ETH",
          name: "Ether",
          amount: "1",
          valueUsd: 3000,
          priceUsd: 3000,
          category: "native",
          contractAddress: "token-c2",
          chain: "near",
          network: "intents",
        },
      ],
    },
  ],
  totalUsd: 3000,
  walletGroups: [],
  superGroups: [],
  walletUsd: 0,
  superUsd: 3000,
};

function renderTab(publicGroups: AssetGroup[] = PUBLIC) {
  return ReactDOMServer.renderToStaticMarkup(
    <SuperAccountTab
      chain="evm"
      address={WALLET}
      publicGroups={publicGroups}
      group={null}
      onToggleGroup={() => {}}
      onRefresh={() => {}}
    />,
  );
}

beforeEach(() => {
  state.unlocked = null;
  state.priv = { status: "pending", snapshot: null };
});

describe("SuperAccountTab", () => {
  it("keeps the layout and fades the in-chat unlock card over it when locked", () => {
    state.unlocked = false;
    const html = renderTab([]);
    expect(html).toContain("Super account locked");
    expect(html).toContain("Please unlock your super account to continue.");
    expect(html).toContain("Unlock");
    // The exact layout stays mounted underneath the card, masked.
    expect(html).toContain("Your super account holds $•••••• across •• assets.");
    expect(html).toContain("Asset");
    expect(html).toContain("No assets found");
  });

  it("gates public holdings behind the card while locked", () => {
    state.unlocked = false;
    const html = renderTab();
    expect(html).toContain("USDC");
    expect(html).toContain("$10.00");
    expect(html).toContain("Super account locked");
  });

  it("keeps the lock action when a live session's read is refused", () => {
    state.unlocked = true;
    state.priv = { status: "locked", snapshot: null, refresh: vi.fn() };
    // Public rows exist, which used to hide the gate and paint them as if
    // the private read had succeeded. The refused read needs the action.
    const html = renderTab();
    expect(html).toContain("Super account locked");
    expect(html).toContain("Please unlock your super account to continue.");
    expect(html).not.toContain("Super account unlocked");
    expect(html).toContain("Your super account holds $•••••• across •• assets.");
  });

  it("merges the private ledger over the public rows once unlocked", () => {
    state.unlocked = true;
    state.priv = { status: "loaded", snapshot: PRIVATE };
    const html = renderTab();
    expect(html).toContain("USDC");
    expect(html).toContain("ETH");
    expect(html).toContain("$3,010.00");
  });

  it("lets the private row win when both name the same token", () => {
    state.unlocked = true;
    state.priv = {
      status: "loaded",
      snapshot: {
        ...PRIVATE,
        groups: [
          {
            id: "private-balance",
            name: "Private balance",
            icon: "near",
            items: [
              {
                id: "priv-usdc",
                symbol: "USDC",
                name: "USD Coin",
                amount: "99",
                valueUsd: 99,
                priceUsd: 1,
                category: "stables",
                contractAddress: "token-c1",
                chain: "near",
                network: "intents",
              },
            ],
          },
        ],
        totalUsd: 99,
      },
    };
    const html = renderTab();
    expect(html).toContain("$99.00");
    expect(html).not.toContain("$10.00");
  });

  it("holds the skeleton while the first private read lands", () => {
    state.unlocked = true;
    state.priv = { status: "pending", snapshot: null };
    const html = renderTab([]);
    expect(html).toContain("Reading your super account.");
    expect(html).toContain("USDC");
    expect(html).toContain("$320.50");
  });

  it("offers a retry when the unlocked read fails", () => {
    state.unlocked = true;
    state.priv = { status: "error", snapshot: null, refresh: vi.fn() };
    const html = renderTab([]);
    expect(html).toContain("Failed to read balances.");
    expect(html).toContain("Refresh");
  });
});

describe("mergeSuperGroups", () => {
  it("keeps public rows the private read does not name", () => {
    const merged = mergeSuperGroups(PUBLIC, PRIVATE);
    expect(merged.totalUsd).toBe(3010);
    expect(merged.groups).toHaveLength(2);
  });

  it("passes public rows straight through with no private snapshot", () => {
    const merged = mergeSuperGroups(PUBLIC, null);
    expect(merged.totalUsd).toBe(10);
    expect(merged.groups).toHaveLength(1);
  });
});
