import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import type { DepositMetadata } from "@/lib/intents/deposit-metadata";
import type { Wallet } from "@wallet-standard/base";
import {
  createConnectedNearFunding,
  createConnectedSolanaFunding,
  formatRawAmount,
  friendlyFundingError,
  fundingActionsForState,
  fundingStateForCheck,
  tokenShortfall,
  type FundingCheck,
  type FundingConnection,
} from "@/lib/wallet/funding";

const DEPOSIT = "0x1111111111111111111111111111111111111111";
const TOKEN = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ACCOUNT = "0x3259aBcDeF12345678901073";

const state = vi.hoisted(() => ({
  buttons: [] as Array<{
    label: string;
    onClick?: () => void | Promise<void>;
    disabled?: boolean;
    variant?: string;
  }>,
  solanaWallets: [] as Wallet[],
  createConnectedEvmFunding: vi.fn(),
  connectEvmFunding: vi.fn(),
  check: vi.fn(),
}));

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({ solanaWallets: state.solanaWallets }),
}));

// The funding dialog must never reach the auth or passkey layers.
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => {
    throw new Error("funding dialog must not use auth");
  },
}));
vi.mock("@/lib/auth/passkey-client", () => ({
  usePasskeysAvailable: () => {
    throw new Error("funding dialog must not use passkeys");
  },
}));

vi.mock("@/lib/wallet/funding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallet/funding")>();
  return {
    ...actual,
    createConnectedEvmFunding: state.createConnectedEvmFunding,
    connectEvmFunding: state.connectEvmFunding,
  };
});

vi.mock("@/components/atoms/Button", async () => {
  const ReactModule = await import("react");
  const textOf = (node: unknown): string => {
    if (typeof node === "string" || typeof node === "number") {
      return String(node);
    }
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (ReactModule.isValidElement(node)) {
      return textOf((node.props as { children?: unknown }).children);
    }
    return "";
  };
  return {
    Button: (props: {
      children?: React.ReactNode;
      onClick?: () => void | Promise<void>;
      disabled?: boolean;
      variant?: string;
    }) => {
      state.buttons.push({
        label: textOf(props.children),
        onClick: props.onClick,
        disabled: props.disabled,
        variant: props.variant,
      });
      return ReactModule.createElement(
        "button",
        { disabled: props.disabled, onClick: props.onClick },
        props.children,
      );
    },
  };
});

vi.mock("@/components/app/DialogShell", () => ({
  DialogShell: ({
    label,
    title,
    subtitle,
    children,
    footer,
    busy,
  }: {
    label: string;
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    busy?: boolean;
  }) => (
    <div role="dialog" aria-label={label} data-busy={busy ? "true" : "false"}>
      <p>{title}</p>
      {subtitle ? <p>{subtitle}</p> : null}
      {children}
      <div>{footer}</div>
    </div>
  ),
}));

vi.mock("@/components/app/WalletPickerDialog", () => ({
  WalletPickerDialog: ({
    label,
    title,
    subtitle,
    children,
    footer,
    busy,
  }: {
    label: string;
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    busy?: boolean;
  }) => (
    <div role="dialog" aria-label={label} data-busy={busy ? "true" : "false"}>
      <p>{title}</p>
      {subtitle ? <p>{subtitle}</p> : null}
      {children}
      <div>{footer}</div>
    </div>
  ),
}));

import { FundWalletDialog, fundingDepositFor } from "./FundWalletDialog";

const arbitrumUsdc: DepositMetadata = {
  address: DEPOSIT,
  memo: "memo-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  amountInRaw: "2000000",
  tokenContract: TOKEN,
  chainId: 42161,
  chainName: "Arbitrum One",
  chainSlug: "arb",
  decimals: 6,
  symbol: "USDC",
};

function render(element: React.ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(element);
}

function button(label: string) {
  return [...state.buttons].reverse().find((entry) => entry.label === label);
}

function dialog(
  overrides: Partial<React.ComponentProps<typeof FundWalletDialog>> = {},
) {
  return (
    <FundWalletDialog
      deposit={arbitrumUsdc}
      chainKind="evm"
      connected={null}
      onClose={vi.fn()}
      onUseQr={vi.fn()}
      onFund={vi.fn()}
      onSendConnected={vi.fn()}
      depositReady
      {...overrides}
    />
  );
}

const connectedEvm = {
  kind: "evm" as const,
  standard: "erc191" as const,
  address: ACCOUNT,
  signerId: ACCOUNT,
  publicKey: "",
  walletName: "MetaMask",
  walletIcon: "/wallets/metamask.webp",
};

const solanaWallet = {
  name: "Phantom",
  icon: "data:image/svg+xml;base64,abc",
  accounts: [
    {
      address: "So11111111111111111111111111111111111111112",
      publicKey: new Uint8Array(32),
      chains: ["solana:mainnet"],
      features: [],
    },
  ],
  chains: ["solana:mainnet"],
  features: {},
} as unknown as Wallet;

beforeEach(() => {
  state.buttons = [];
  state.solanaWallets = [];
  state.createConnectedEvmFunding.mockReset();
  state.connectEvmFunding.mockReset();
  state.check.mockReset();
});

describe("the funding dialog", () => {
  it("lists wallet cards, excludes passkey and login copy, and keeps Use QR", () => {
    const html = render(dialog());

    expect(html).toContain("Fund from wallet");
    expect(html).toContain("2 USDC on Arbitrum One");
    expect(html).toContain("MetaMask");
    expect(html).toContain("Coinbase Wallet");
    expect(html).toContain("Use QR");
    expect(html).not.toMatch(/passkey/i);
    expect(html).not.toMatch(/sign in/i);
    expect(html).not.toMatch(/create account/i);
    expect(html).not.toContain("Injected");
    expect(html).toContain('data-funding-state="choosing"');
  });

  it("never falls back to the legacy injected provider", async () => {
    render(dialog());

    const rabby = state.buttons.find((entry) =>
      entry.label.includes("Rabby"),
    );
    expect(rabby).toBeTruthy();
    await rabby?.onClick?.();
    await Promise.resolve();

    // A non-EIP-6963 wallet is a QR path, not a request against the app's
    // legacy provider (which would switch the active account).
    expect(state.connectEvmFunding).not.toHaveBeenCalled();
  });

  it("marks the connected wallet and does not reconnect it", async () => {
    const check: FundingCheck = {
      tokenBalance: 2_000_000n,
      nativeBalance: 10n ** 18n,
      enoughToken: true,
      enoughGas: true,
    };
    const connection: FundingConnection = {
      kind: "evm",
      address: ACCOUNT,
      connected: true,
      check: state.check.mockResolvedValue(check),
      send: vi.fn(),
    };
    state.createConnectedEvmFunding.mockReturnValue(connection);

    const html = render(dialog({ connected: connectedEvm }));
    expect(html).toContain("MetaMask");
    expect(html).toContain("Connected");
    // The connected card is first in the grid.
    expect(html.indexOf("MetaMask")).toBeLessThan(html.indexOf("Coinbase Wallet"));

    const card = state.buttons.find((entry) =>
      entry.label.includes("MetaMask"),
    );
    expect(card).toBeTruthy();
    await card?.onClick?.();
    await Promise.resolve();

    expect(state.createConnectedEvmFunding).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ACCOUNT,
        walletName: "MetaMask",
      }),
    );
    // A check, never a second connection prompt.
    expect(state.connectEvmFunding).not.toHaveBeenCalled();
    expect(state.check).toHaveBeenCalledWith(
      expect.objectContaining({ address: DEPOSIT, amountRaw: "2000000" }),
    );
    expect(fundingStateForCheck(check)).toBe("ready");
  });

  it("marks a connected Solana wallet without opening a new connection", () => {
    state.solanaWallets = [solanaWallet];
    const connectedSolana = {
      kind: "solana" as const,
      standard: "raw_ed25519" as const,
      address: solanaWallet.accounts[0].address,
      signerId: "",
      publicKey: "",
      walletName: "Phantom",
      walletIcon: solanaWallet.icon,
    };

    const html = render(
      dialog({ chainKind: "solana", connected: connectedSolana }),
    );

    expect(html).toContain("Phantom");
    expect(html).toContain("Connected");
  });

  it("calls onUseQr from every non-sending footer", () => {
    const onUseQr = vi.fn();
    render(dialog({ onUseQr }));
    button("Use QR")?.onClick?.();
    expect(onUseQr).toHaveBeenCalledTimes(1);
  });

  it("never reaches the auth or passkey layer while rendering", () => {
    // The module mocks above throw if the dialog imports either hook.
    expect(() => render(dialog())).not.toThrow();
  });
});

describe("the funding states", () => {
  it("offers no Send when the exact balance is short", () => {
    const check: FundingCheck = {
      tokenBalance: 400_000n,
      nativeBalance: 10n ** 18n,
      enoughToken: false,
      enoughGas: true,
      shortfall: tokenShortfall(2_000_000n, 400_000n, 6, "USDC"),
    };

    expect(check.shortfall).toBe("Need 2 USDC, wallet has 0.4");
    expect(fundingStateForCheck(check)).toBe("insufficient");
    expect(fundingActionsForState("insufficient", true)).toEqual([
      "Use QR",
      "Try another",
    ]);
    expect(fundingActionsForState("insufficient", true)).not.toContain("Send");
  });

  it("shows Switch only when the wallet can switch networks", () => {
    expect(fundingActionsForState("wrong-network", true)).toEqual([
      "Use QR",
      "Switch",
    ]);
    expect(fundingActionsForState("wrong-network", false)).toEqual(["Use QR"]);
  });

  it("offers Send only once the wallet is ready", () => {
    expect(fundingActionsForState("ready", false)).toEqual(["Use QR", "Send"]);
    expect(fundingActionsForState("error", false)).toEqual([
      "Use QR",
      "Try again",
    ]);
  });

  it("keeps Use QR in every state except sending", () => {
    for (const stateName of [
      "choosing",
      "connecting",
      "checking",
      "wrong-network",
      "insufficient",
      "ready",
      "error",
    ] as const) {
      expect(fundingActionsForState(stateName, true)).toContain("Use QR");
    }
    expect(fundingActionsForState("sending", true)).toEqual([]);
  });

  it("reads the exact deposit metadata and refuses an incomplete record", () => {
    expect(fundingDepositFor(arbitrumUsdc)).toEqual({
      address: DEPOSIT,
      amountRaw: "2000000",
      tokenContract: TOKEN,
      chainId: 42161,
      chainSlug: "arb",
      chainName: "Arbitrum One",
      decimals: 6,
      symbol: "USDC",
    });
    expect(
      fundingDepositFor({ ...arbitrumUsdc, amountInRaw: null }),
    ).toBeNull();
    expect(fundingDepositFor({ ...arbitrumUsdc, decimals: null })).toBeNull();
    expect(fundingDepositFor({ ...arbitrumUsdc, amountInRaw: "0" })).toBeNull();
    expect(fundingDepositFor({ ...arbitrumUsdc, amountInRaw: "-1" })).toBeNull();
    expect(fundingDepositFor({ ...arbitrumUsdc, amountInRaw: "1.5" })).toBeNull();
    expect(fundingDepositFor({ ...arbitrumUsdc, decimals: -1 })).toBeNull();
    expect(fundingDepositFor({ ...arbitrumUsdc, decimals: 1.5 })).toBeNull();
    // A slug and id that disagree are malformed metadata, not a chain to guess.
    expect(fundingDepositFor({ ...arbitrumUsdc, chainId: 8453 })).toBeNull();
  });

  it("formats amounts without floating-point rounding", () => {
    expect(formatRawAmount(2_000_000n, 6)).toBe("2");
    expect(formatRawAmount(400_000n, 6)).toBe("0.4");
    expect(formatRawAmount(123_456_789n, 6)).toBe("123.456789");
  });

  it("turns wallet refusals into the copy the card uses", () => {
    expect(friendlyFundingError(new Error("User rejected"))).toBe(
      "The wallet request was rejected. Nothing was moved.",
    );
    expect(friendlyFundingError(new Error("chain-switch-rejected"), "Arbitrum")).toBe(
      "Switch to Arbitrum in your wallet, then try again.",
    );
    expect(friendlyFundingError(new Error("unsupported-network"))).toBe(
      "This network is not supported by wallet funding yet.",
    );
  });

  it("reuses a connected wallet's send path without a connector", () => {
    const send = vi.fn().mockResolvedValue({ txHash: "0xhash" });
    const near = createConnectedNearFunding({ address: "alice.near", send });
    expect(near.connected).toBe(true);
    expect(near.send).toBe(send);
    expect(near.switchNetwork).toBeUndefined();

    const solana = createConnectedSolanaFunding({ address: "sol", send });
    expect(solana.connected).toBe(true);
    expect(solana.send).toBe(send);
    expect(solana.switchNetwork).toBeUndefined();
  });
});
