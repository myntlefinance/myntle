import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { resetApprovalStore, rememberApprovalTx } from "@/components/app/approvalStore";
import type { DepositMetadata } from "@/lib/intents/deposit-metadata";
import type { SentenceApproval } from "./sentence-approval";
import { depositQrValue } from "./DepositQr";

/**
 * The deposit half of the sentence card.
 *
 * A deposit is not signed: the server mints one address, the reader funds it
 * from an exchange or a wallet, and the record decides the outcome. These
 * tests hold the four pieces apart: the Start state, the QR panel, the wallet
 * transfer, and the status table that replaces the QR once the money moves.
 */

const state = vi.hoisted(() => ({
  account: null as
    | null
    | {
        kind: "evm" | "solana" | "near";
        address: string;
        walletName?: string;
      },
  signMessage: vi.fn(),
  sendDeposit: vi.fn(),
  signNEP413: vi.fn(),
  buttons: [] as Array<{
    label: string;
    onClick?: () => void | Promise<void>;
    disabled?: boolean;
  }>,
}));

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({
    account: state.account,
    signMessage: state.signMessage,
    sendDeposit: state.sendDeposit,
    signNEP413: state.signNEP413,
  }),
}));

// The card's buttons are captured at render so a handler can be called
// directly: this suite runs in Node with no DOM to click in.
vi.mock("@/components/atoms/Button", async () => {
  const ReactModule = await import("react");
  const textOf = (node: unknown): string => {
    if (typeof node === "string" || typeof node === "number") {
      return String(node);
    }
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (ReactModule.isValidElement(node)) {
      return textOf(
        (node.props as { children?: unknown }).children,
      );
    }
    return "";
  };
  return {
    Button: (props: {
      children?: React.ReactNode;
      onClick?: () => void | Promise<void>;
      disabled?: boolean;
    }) => {
      state.buttons.push({
        label: textOf(props.children),
        onClick: props.onClick,
        disabled: props.disabled,
      });
      return ReactModule.createElement(
        "button",
        { disabled: props.disabled, onClick: props.onClick },
        props.children,
      );
    },
  };
});

import SentenceTradeCard, {
  approveThroughAdapter,
  depositRefreshKey,
  registerDepositTx,
  type SentenceApprovalWiring,
  type SentenceCardState,
} from "./SentenceTradeCard";

const DEPOSIT = "0x1111111111111111111111111111111111111111";
const FRESH_DEPOSIT = "0x2222222222222222222222222222222222222222";
const TOKEN = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const NEAR_ACCOUNT = "0xb0b14cd82e1f0e6ee391ae3a31a0173aff8373b1";
const VALID = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

const arbitrumUsdc: DepositMetadata = {
  address: DEPOSIT,
  memo: "memo-1",
  expiresAt: VALID,
  amountInRaw: "2000000",
  tokenContract: TOKEN,
  chainId: 42161,
  chainName: "Arbitrum One",
  chainSlug: "arb",
  decimals: 6,
  symbol: "USDC",
};

const depositCard = {
  action: "deposit" as const,
  fromSymbol: "USDC",
  fromChain: "arb",
  toSymbol: "USDC",
  toChain: "near",
  amountIn: "2",
  amountOut: "2",
  recipient: NEAR_ACCOUNT,
  sender: null,
  approveLabel: "Start",
  runApproval: (async () => ({
    ok: true,
    transactionId: "tx-deposit-1",
    depositAddress: DEPOSIT,
    depositMemo: "memo-1",
    amountIn: "2",
    expiresAt: VALID,
    deposit: arbitrumUsdc,
  })) satisfies SentenceApproval,
};

function render(element: React.ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(element);
}

function sentenceOf(html: string): string {
  const match = html.match(/data-sentence[^>]*>([\s\S]*?)<\/div>/);
  return match?.[1] ?? "";
}

function sentenceText(html: string): string {
  return sentenceOf(html)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function button(label: string) {
  return [...state.buttons].reverse().find((entry) => entry.label === label);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function waitingCard(overrides: Record<string, unknown> = {}) {
  return (
    <SentenceTradeCard
      {...depositCard}
      state="waiting"
      transactionId="tx-deposit-1"
      depositAddress={DEPOSIT}
      depositMeta={arbitrumUsdc}
      {...overrides}
    />
  );
}

type MetaCalls = {
  metas: DepositMetadata[];
  detailsOpened: number;
  states: SentenceCardState[];
  deposits: string[];
  minted: Array<{ transactionId: string; depositAddress: string }>;
};

function record(runApproval: SentenceApproval): {
  input: SentenceApprovalWiring;
  calls: MetaCalls;
} {
  const calls: MetaCalls = {
    metas: [],
    detailsOpened: 0,
    states: [],
    deposits: [],
    minted: [],
  };
  return {
    calls,
    input: {
      action: "deposit",
      runApproval,
      expired: false,
      inFlight: { current: false },
      setState: (next) => calls.states.push(next),
      setError: () => {},
      setTxId: () => {},
      setDeposit: (address) => calls.deposits.push(address),
      setMemo: () => {},
      setDepositMeta: (meta) => calls.metas.push(meta),
      setFee: () => {},
      setFigures: () => {},
      setDestination: () => {},
      openDetails: () => {
        calls.detailsOpened += 1;
      },
      onMinted: (tx) => calls.minted.push(tx),
    },
  };
}

beforeEach(() => {
  resetApprovalStore();
  state.buttons = [];
  state.account = null;
  state.signMessage.mockReset();
  state.sendDeposit.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the deposit Start state", () => {
  it("keeps the sentence and offers Start without an empty Details drawer", () => {
    const html = render(<SentenceTradeCard {...depositCard} />);

    expect(sentenceText(html)).toBe("Deposit 2 USDC in your Near Account");
    expect(html).toContain("Click Start to begin the deposit process.");
    expect(button("Start")).toBeTruthy();
    expect(button("Details")?.disabled).toBe(true);
    // Nothing is drawn before an address exists.
    expect(html).not.toContain("Deposit to");
    expect(html).not.toContain("Send from an exchange or another wallet.");
    expect(html).not.toContain("Valid until");
    expect(html).not.toContain("Deposit address QR code");
  });

  it("mints the address, opens the panel, and keeps the server metadata", async () => {
    const { input, calls } = record(depositCard.runApproval);

    await approveThroughAdapter(input);

    expect(calls.states).toEqual(["signing", "waiting"]);
    expect(calls.deposits).toEqual([DEPOSIT]);
    expect(calls.detailsOpened).toBe(1);
    expect(calls.minted).toEqual([
      { transactionId: "tx-deposit-1", depositAddress: DEPOSIT },
    ]);
    expect(calls.metas).toEqual([arbitrumUsdc]);
    expect(calls.metas[0]).toMatchObject({
      amountInRaw: "2000000",
      tokenContract: TOKEN,
      chainId: 42161,
      chainSlug: "arb",
    });
  });

  it("draws the QR, the full address, memo, and deadline once it exists", () => {
    const html = render(waitingCard());

    expect(html).toContain("Deposit address QR code");
    expect(html).toContain(DEPOSIT);
    expect(html).toContain("memo-1");
    expect(html).toContain("Valid until");
    expect(html).toContain("Token");
    expect(html).toContain("Contract address");
    expect(html).toContain("Network");
    expect(html).toContain("Arbitrum");
    expect(html).toContain("break-all");
    expect(html).toContain("select-all");
    expect(html).toContain("Copy");
    expect(html).not.toContain("Deposit to");
    expect(html).not.toContain("Send from an exchange or another wallet.");
    expect(html).not.toContain("2 USDC on Arbitrum One");
    expect(html).toContain("Waiting");
    expect(html).not.toContain("Click Start to begin");
  });

  it("restores a minted address from the approval store when the snapshot is late", () => {
    rememberApprovalTx("deposit-reload", {
      transactionId: "tx-deposit-reload",
      depositAddress: DEPOSIT,
    });

    const html = render(
      <SentenceTradeCard
        {...depositCard}
        approvalId="deposit-reload"
        state="waiting"
        depositAddress={undefined}
      />,
    );

    expect(html).toContain(DEPOSIT);
    expect(html).toContain("Copy");
    expect(button("Details")?.disabled).not.toBe(true);
  });

  it("offers Start again when the host says waiting but no address survived", () => {
    const html = render(
      <SentenceTradeCard
        {...depositCard}
        state="waiting"
        depositAddress={undefined}
      />,
    );

    expect(html).toContain("Click Start to begin the deposit process.");
    expect(button("Start")).toBeTruthy();
    expect(button("Details")?.disabled).toBe(true);
  });
});

describe("the deposit QR", () => {
  it("encodes only the deposit address", () => {
    const expected = DEPOSIT;
    expect(
      depositQrValue({
        address: DEPOSIT,
        amountInRaw: "2000000",
        tokenContract: TOKEN,
        chainId: 42161,
      }),
    ).toBe(expected);
    expect(
      depositQrValue({
        address: DEPOSIT,
        amountInRaw: "2000000",
        tokenContract: null,
        chainId: 42161,
      }),
    ).toBe(expected);
    expect(
      depositQrValue({
        address: DEPOSIT,
        amountInRaw: "2000000",
        tokenContract: TOKEN,
        chainId: null,
      }),
    ).toBe(expected);
  });
});

describe("funding the address from a wallet", () => {
  it("transfers the exact amount and token, then registers the hash", async () => {
    state.account = { kind: "evm", address: "0x3259aBcDeF12345678901073" };
    state.sendDeposit.mockResolvedValue({ txHash: "0xdeposit-hash" });
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/tx/tx-deposit-1/deposit") {
          expect(JSON.parse(String(init?.body))).toBeDefined();
          return jsonResponse({ ok: true });
        }
        throw new Error(`unexpected request ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(waitingCard());
    const transfer = button("Use Wallet");
    expect(transfer).toBeTruthy();

    await transfer?.onClick?.();

    expect(state.sendDeposit).toHaveBeenCalledTimes(1);
    expect(state.sendDeposit).toHaveBeenCalledWith({
      depositAddress: DEPOSIT,
      amount: "2000000",
      tokenAddress: TOKEN,
      tokenMint: TOKEN,
      tokenContract: TOKEN,
      chainId: 42161,
      chainName: "Arbitrum One",
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/tx/tx-deposit-1/deposit");
    expect(JSON.parse(String(init?.body))).toEqual({
      txHash: "0xdeposit-hash",
      memo: "memo-1",
    });
  });

  it("hides Use Wallet from a wallet on another chain", () => {
    state.account = { kind: "solana", address: "So11111111111111111111111111111111111111112" };
    render(waitingCard());

    expect(button("Use Wallet")).toBeUndefined();
    // The QR and the address stay available to copy.
    expect(button("Details")).toBeTruthy();
  });

  it("hides Use Wallet with no connected wallet", () => {
    render(waitingCard());
    expect(button("Use Wallet")).toBeUndefined();
  });

  it("registers a retried hash without inventing a second transfer", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "nope" }, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchSpy);

    await registerDepositTx({
      transactionId: "tx-deposit-1",
      txHash: "0xhash",
      memo: null,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("the deposit status table", () => {
  it("shows a detected deposit and fades the QR", () => {
    const html = render(waitingCard({ state: "processing" }));

    expect(html).toContain("Deposit detected. Processing…");
    expect(html).toContain("pointer-events-none opacity-40");
    expect(html).toContain("Processing");
    // The address is still readable for a record of where the money went.
    expect(html).toContain(DEPOSIT);
  });

  it("reports success without ageing the record out", () => {
    const html = render(waitingCard({ state: "settled", expiresAt: PAST }));

    expect(html).toContain(
      "Success. Your deposit was detected and credited to your account.",
    );
    expect(html).not.toContain("Expired");
    expect(html).toContain("Executed");
  });

  it("keeps detected status ahead of the clock", () => {
    const html = render(waitingCard({ state: "processing", expiresAt: PAST }));

    expect(html).toContain("Deposit detected. Processing…");
    expect(html).not.toContain("Expired");
  });

  it("names a short deposit, a refund, and a failed settlement separately", () => {
    const incomplete = render(waitingCard({ state: "incomplete" }));
    expect(incomplete).toContain("The deposit was below the required amount.");
    expect(incomplete).toContain("Incomplete");
    expect(incomplete).not.toContain("Deposit failed");

    const refunded = render(waitingCard({ state: "refunded" }));
    expect(refunded).toContain("The deposit was refunded.");
    expect(refunded).toContain("Refunded");

    const failed = render(waitingCard({ state: "failed" }));
    expect(failed).toContain(
      "The deposit did not settle. The record has the details.",
    );
    expect(failed).toContain("Failed");
  });

  it("expires a pending address on its stored deadline", () => {
    const html = render(waitingCard({ expiresAt: PAST }));

    expect(html).toContain("Expired. Please generate a fresh deposit address.");
    expect(button("New address")).toBeTruthy();
    expect(button("Use Wallet")).toBeUndefined();
  });
});

describe("a revisited deposit", () => {
  it("asks for exactly one refresh per address per mount", () => {
    const first = depositRefreshKey({
      alreadyRefreshed: null,
      txId: "tx-deposit-1",
      address: DEPOSIT,
      state: "waiting",
    });
    expect(first).toBe(`tx-deposit-1:${DEPOSIT}`);

    // The same key is never requested twice, even though the card re-renders.
    expect(
      depositRefreshKey({
        alreadyRefreshed: first,
        txId: "tx-deposit-1",
        address: DEPOSIT,
        state: "waiting",
      }),
    ).toBeNull();

    // A fresh address is a new request.
    expect(
      depositRefreshKey({
        alreadyRefreshed: first,
        txId: "tx-deposit-2",
        address: FRESH_DEPOSIT,
        state: "waiting",
      }),
    ).toBe(`tx-deposit-2:${FRESH_DEPOSIT}`);
  });

  it("never refreshes a terminal record or a card with no address", () => {
    for (const terminal of [
      "settled",
      "refunded",
      "incomplete",
      "failed",
      "expired",
      "denied",
    ] as const) {
      expect(
        depositRefreshKey({
          alreadyRefreshed: null,
          txId: "tx-deposit-1",
          address: DEPOSIT,
          state: terminal,
        }),
      ).toBeNull();
    }
    expect(
      depositRefreshKey({
        alreadyRefreshed: null,
        txId: "tx-deposit-1",
        address: undefined,
        state: "waiting",
      }),
    ).toBeNull();
  });
});

describe("a fresh address", () => {
  const freshApproval: SentenceApproval = async () => ({
    ok: true,
    transactionId: "tx-deposit-2",
    depositAddress: FRESH_DEPOSIT,
    depositMemo: null,
    amountIn: "2",
    expiresAt: VALID,
    deposit: {
      ...arbitrumUsdc,
      address: FRESH_DEPOSIT,
      memo: null,
    },
  });

  it("offers New address on every terminal state", () => {
    for (const terminal of [
      "expired",
      "failed",
      "refunded",
      "incomplete",
    ] as const) {
      state.buttons = [];
      render(waitingCard({ state: terminal, runApproval: freshApproval }));
      expect(button("New address"), terminal).toBeTruthy();
    }
    for (const live of ["waiting", "processing", "settled"] as const) {
      state.buttons = [];
      render(waitingCard({ state: live, runApproval: freshApproval }));
      expect(button("New address"), live).toBeUndefined();
    }
  });

  it("mints a different address and records it without re-approving", async () => {
    const runApproval = vi.fn(freshApproval);
    const onApprove = vi.fn();
    const onRecord = vi.fn();
    render(
      waitingCard({
        state: "failed",
        runApproval,
        onApprove,
        onRecord,
      }),
    );
    const mint = button("New address");
    expect(mint).toBeTruthy();

    await mint?.onClick?.();

    expect(runApproval).toHaveBeenCalledTimes(1);
    // The old address is abandoned, never relabelled as the new one.
    expect(onRecord).toHaveBeenCalledWith({
      transactionId: "tx-deposit-2",
      depositAddress: FRESH_DEPOSIT,
    });
    expect(onRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({ depositAddress: DEPOSIT }),
    );
    // A fresh address resets the decided card; it does not answer the
    // approval a second time.
    expect(onApprove).not.toHaveBeenCalled();
  });
});
