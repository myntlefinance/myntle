import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { resetApprovalStore, rememberApprovalTx } from "@/components/app/approvalStore";
import type { DepositMetadata } from "@/lib/intents/deposit-metadata";
import { FRESH_DEPOSIT_PROMPT } from "@/lib/intents/deposit-status";
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
    variant?: string;
  }>,
}));

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({
    account: state.account,
    signMessage: state.signMessage,
    sendDeposit: state.sendDeposit,
    signNEP413: state.signNEP413,
    solanaWallets: [],
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

import SentenceTradeCard, {
  approveThroughAdapter,
  cardStateAfterDeny,
  CARD_WATCH_BEAT_MS,
  CARD_WATCH_MS,
  CARD_WATCH_RECENT_MS,
  isLiveCardState,
  isRecentCardBirth,
  registerDepositTx,
  sendAndRegisterDeposit,
  type SentenceApprovalWiring,
  type SentenceCardState,
} from "./SentenceTradeCard";
import type { FundingConnection } from "@/lib/wallet/funding";

const DEPOSIT = "0x1111111111111111111111111111111111111111";
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

/** The animated wallet CTA is mounted for the height transition; its data
 *  attribute says whether it is open or merely present in the collapsed grid. */
function walletCta(html: string): string | null {
  return html.match(/data-wallet-cta="(open|closed)"/)?.[1] ?? null;
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

  it("shows a skeleton instead of guessing while the record is checked", () => {
    const html = render(<SentenceTradeCard {...depositCard} decisionPending />);

    expect(html).toContain("Checking the record.");
    expect(html).toContain("skullet-bar");
    expect(button("Start")).toBeUndefined();
    expect(button("Reject")).toBeUndefined();
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
    expect(html).toContain('aria-label="Copy"');
    expect(html).not.toContain("Copy deposit address");
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
  it("opens the funding dialog from Fund from wallet instead of sending immediately", () => {
    state.account = { kind: "evm", address: "0x3259aBcDeF12345678901073" };

    const html = render(waitingCard());
    const fund = button("Fund from wallet");
    expect(fund).toBeTruthy();
    expect(fund?.variant).toBe("secondary");
    expect(button("Use Wallet")).toBeUndefined();

    expect(html.indexOf(DEPOSIT)).toBeLessThan(
      html.indexOf('aria-label="Copy"'),
    );
    expect(html.indexOf('aria-label="Copy"')).toBeLessThan(
      html.indexOf("Fund from wallet"),
    );
    expect(html.indexOf("Fund from wallet")).toBeLessThan(
      html.indexOf("Contract address"),
    );
    // Opening the dialog is the only action on this click.
    expect(state.sendDeposit).not.toHaveBeenCalled();
  });

  it("sends the exact amount and token, then registers the hash", async () => {
    const send = vi.fn().mockResolvedValue({ txHash: "0xdeposit-hash" });
    const register = vi.fn().mockResolvedValue(true);
    const connection: FundingConnection = {
      kind: "evm",
      address: "0x3259aBcDeF12345678901073",
      check: vi.fn(),
      send,
    };

    const result = await sendAndRegisterDeposit({
      connection,
      deposit: {
        address: DEPOSIT,
        amountRaw: "2000000",
        tokenContract: TOKEN,
        chainId: 42161,
        chainSlug: "arb",
        chainName: "Arbitrum One",
        decimals: 6,
        symbol: "USDC",
      },
      transactionId: "tx-deposit-1",
      memo: "memo-1",
      register,
    });

    expect(send).toHaveBeenCalledWith({
      address: DEPOSIT,
      amountRaw: "2000000",
      tokenContract: TOKEN,
      chainId: 42161,
      chainSlug: "arb",
      chainName: "Arbitrum One",
      decimals: 6,
      symbol: "USDC",
    });
    expect(register).toHaveBeenCalledWith({
      transactionId: "tx-deposit-1",
      txHash: "0xdeposit-hash",
      senderAccount: undefined,
      memo: "memo-1",
    });
    expect(result).toEqual({ registered: true, txHash: "0xdeposit-hash" });
  });

  it("keeps the transfer usable when registration exhausts its retries", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "nope" }, 500));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await registerDepositTx({
      transactionId: "tx-deposit-1",
      txHash: "0xhash",
      memo: null,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result).toBe(false);
  });

  it("offers Fund from wallet even when another chain's wallet is connected", () => {
    state.account = { kind: "solana", address: "So11111111111111111111111111111111111111112" };
    const html = render(waitingCard());

    expect(walletCta(html)).toBe("open");
    expect(button("Fund from wallet")).toBeTruthy();
    // The QR and the address stay available to copy.
    expect(button("Details")).toBeTruthy();
  });

  it("offers Fund from wallet with no connected wallet", () => {
    const html = render(waitingCard());
    expect(walletCta(html)).toBe("open");
    expect(button("Fund from wallet")).toBeTruthy();
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
  it("withdraws the address once the deposit is detected", () => {
    const html = render(waitingCard({ state: "processing" }));

    expect(html).toContain("Deposit detected. Processing…");
    expect(html).toContain("Processing");
    // A detected address is not funded again, so the QR, the address, and
    // the send control leave the card instead of fading behind it.
    expect(html).not.toContain(DEPOSIT);
    expect(html).not.toContain("Deposit address QR code");
    expect(walletCta(html)).toBeNull();
    // The record's own figures stay readable.
    expect(html).toContain("Token");
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

    expect(html).toContain("Expired.");
    expect(button("New address")).toBeUndefined();
    // A dead address is never drawn: nobody may copy it into a transfer
    // that will not be credited.
    expect(html).not.toContain(DEPOSIT);
    expect(html).not.toContain("Deposit address QR code");
    expect(walletCta(html)).toBeNull();
  });
});

describe("a revisited deposit", () => {
  it("starts collapsed instead of reopening the address panel", () => {
    const html = render(waitingCard());

    expect(html).toContain("height:0px");
    expect(html).toContain("opacity:0");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("inert");
    expect(button("Details")?.disabled).not.toBe(true);
  });

  it("renders a waiting deposit without a Checking state", () => {
    const html = render(waitingCard({ active: false }));

    expect(html).toContain("Waiting");
    expect(html).not.toContain("Checking");
    expect(walletCta(html)).toBe("open");
    expect(html).toContain(DEPOSIT);
  });

  it("renders Expired instead of the skeleton when the record is pending", () => {
    const html = render(waitingCard({ expiresAt: PAST, decisionPending: true }));

    expect(html).toContain("Expired");
    expect(html).not.toContain("skullet-bar");
    expect(html).not.toContain("Checking the record.");
  });

  it("keeps a pending record without a deadline out of the Unverified state", () => {
    const html = render(
      waitingCard({
        depositMeta: { ...arbitrumUsdc, expiresAt: null },
      }),
    );

    expect(html).toContain("Waiting");
    expect(html).not.toContain("Unverified");
    expect(html).not.toContain(
      "This address has no stored deadline, so its status cannot be confirmed.",
    );
    expect(walletCta(html)).toBe("open");
    expect(html).toContain(DEPOSIT);
  });

  it("keeps the address fundable when it is more than fifteen minutes out", () => {
    state.account = { kind: "evm", address: "0x3259aBcDeF12345678901073" };
    const html = render(
      waitingCard({
        expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      }),
    );

    expect(html).toContain("Waiting");
    expect(walletCta(html)).toBe("open");
    expect(html).toContain("grid-template-rows:1fr");
  });

  it("closes the funding window fifteen minutes before the quote deadline", () => {
    const html = render(
      waitingCard({
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    );

    expect(html).toContain("Expired");
    expect(html).not.toContain("Waiting");
    expect(html).not.toContain(DEPOSIT);
    expect(walletCta(html)).toBeNull();
  });

  it("bounds the active watch to one beat every six seconds for two minutes", () => {
    expect(CARD_WATCH_BEAT_MS).toBe(6_000);
    expect(CARD_WATCH_MS).toBe(2 * 60_000);
  });

  it("watches only live card states", () => {
    expect(isLiveCardState("waiting", { intents: true, action: "deposit" })).toBe(true);
    for (const live of ["submitting", "submitted", "processing"] as const) {
      expect(isLiveCardState(live, { intents: true, action: "swap" })).toBe(true);
      expect(isLiveCardState(live, { intents: false, action: "swap" })).toBe(true);
    }
    expect(isLiveCardState("awaiting", { intents: true, action: "deposit" })).toBe(false);
    expect(isLiveCardState("settled", { intents: true, action: "deposit" })).toBe(false);
    expect(isLiveCardState("waiting", { intents: false, action: "swap" })).toBe(false);
    expect(isLiveCardState("waiting", { intents: true, action: "swap" })).toBe(false);
  });

  it("treats a recent birth as watchable and an old one as historical", () => {
    const now = Date.now();
    expect(isRecentCardBirth(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(isRecentCardBirth(new Date(now - CARD_WATCH_RECENT_MS - 1_000).toISOString(), now)).toBe(false);
    expect(isRecentCardBirth(undefined, now)).toBe(false);
    expect(isRecentCardBirth("not-a-date", now)).toBe(false);
  });
});

describe("a dead deposit address", () => {
  it("offers one prompt sentence on every terminal state", () => {
    for (const terminal of [
      "expired",
      "failed",
      "refunded",
      "incomplete",
    ] as const) {
      state.buttons = [];
      const html = render(
        waitingCard({ state: terminal, onPrompt: () => {} }),
      );
      expect(html, terminal).toContain(FRESH_DEPOSIT_PROMPT);
      // The sentence is the action: dashed underline, arrow, no button chrome.
      expect(html, terminal).toContain("border-dashed");
      expect(button("New address"), terminal).toBeUndefined();
    }
  });

  it("keeps the prompt off a live card", () => {
    for (const live of ["waiting", "processing", "settled"] as const) {
      const html = render(waitingCard({ state: live, onPrompt: () => {} }));
      expect(html, live).not.toContain(FRESH_DEPOSIT_PROMPT);
    }
  });

  it("says only what happened when there is no composer", () => {
    const html = render(waitingCard({ state: "expired" }));

    expect(html).toContain("Expired.");
    expect(html).not.toContain(FRESH_DEPOSIT_PROMPT);
  });

  it("withdraws the address on every state that cannot fund it", () => {
    for (const dead of [
      "expired",
      "failed",
      "refunded",
      "incomplete",
      "processing",
      "settled",
    ] as const) {
      const html = render(
        waitingCard({ state: dead, onPrompt: () => {} }),
      );
      expect(html, dead).not.toContain(DEPOSIT);
      expect(html, dead).not.toContain("Deposit address QR code");
      expect(html, dead).not.toContain("Fund from wallet");
      expect(walletCta(html), dead).toBeNull();
    }
  });

  it("keeps the waiting address fundable", () => {
    const html = render(waitingCard({ onPrompt: () => {} }));

    expect(html).toContain(DEPOSIT);
    expect(html).toContain("Deposit address QR code");
    expect(walletCta(html)).toBe("open");
  });
});

describe("a refused deposit", () => {
  it("withdraws the funding panel and keeps the record's own rows", () => {
    const html = render(waitingCard({ state: "denied" }));

    expect(html).toContain("Rejected");
    // The address belonged to a proposal that was refused: no QR, no address,
    // no copy control, and no funding CTA.
    expect(html).not.toContain(DEPOSIT);
    expect(html).not.toContain("Deposit address QR code");
    expect(html).not.toContain('aria-label="Copy"');
    expect(html).not.toContain("Fund from wallet");
    expect(walletCta(html)).toBeNull();
    // The terms the address was issued under stay readable.
    expect(html).toContain("Token");
    expect(html).toContain("Contract address");
    expect(html).toContain("Network");
    expect(html).toContain("Arbitrum");
    expect(html).toContain("memo-1");
    expect(html).toContain("Valid until");
  });

  it("paints Waiting when an address seeded from the store arrives awaiting", () => {
    // A reload seeds the address from the approval store before the host's
    // state catches up. Start and Reject must not be offered for a deposit
    // that already minted its address.
    const html = render(waitingCard({ state: "awaiting" }));

    expect(html).toContain("Waiting");
    expect(html).not.toContain("Pending Approval");
    expect(button("Start")).toBeUndefined();
    expect(button("Reject")).toBeUndefined();
    expect(html).toContain(DEPOSIT);
    expect(html).not.toContain("Click Start to begin");
  });

  it("still ages a seeded address into Expired", () => {
    const html = render(waitingCard({ state: "awaiting", expiresAt: PAST }));

    expect(html).toContain("Expired");
    expect(html).not.toContain("Waiting");
    expect(button("Start")).toBeUndefined();
    expect(button("Reject")).toBeUndefined();
    expect(html).not.toContain(DEPOSIT);
  });

  it("maps the host's answer, not the gesture, to the painted state", () => {
    // Without a DOM the state write cannot be observed after a click, so the
    // mapping handleDeny calls is covered directly. `approved` is the guard
    // answering for a proposal that already started; it must never paint
    // Rejected over the address that exists.
    expect(cardStateAfterDeny("approved", { hasDeposit: true })).toBe(
      "waiting",
    );
    expect(cardStateAfterDeny("approved", { hasDeposit: false })).toBe(
      "awaiting",
    );
    expect(cardStateAfterDeny("denied", { hasDeposit: true })).toBe("denied");
    expect(cardStateAfterDeny(undefined, { hasDeposit: false })).toBe(
      "denied",
    );
  });
});
