import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { resetApprovalStore } from "@/components/app/approvalStore";
import { normalizeEvmAddress } from "@/lib/intents/destination";
import type { TradeAction } from "@/lib/trade/action";
import type { SentenceApproval } from "./sentence-approval";

/**
 * The sentence card under a passkey session.
 *
 * A passkey deposit, withdrawal, and swap render this same card, but none of
 * them sign a trade message: the deposit asks the server for a one-time
 * address, and the swap and withdrawal run approve → sign → submit. These
 * tests hold the journeys apart and prove the wallet branch still posts to
 * `/api/approve`.
 */

const state = vi.hoisted(() => ({
  account: null as
    | null
    | {
        kind: "evm";
        standard: "erc191";
        address: string;
        signerId: string;
        publicKey: string;
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

// The card's decision buttons are captured at render so a handler can be
// called directly: this suite runs in Node with no DOM to click in.
vi.mock("@/components/atoms/Button", async () => {
  const ReactModule = await import("react");
  return {
    Button: (props: {
      children?: React.ReactNode;
      onClick?: () => void | Promise<void>;
      disabled?: boolean;
    }) => {
      state.buttons.push({
        label: typeof props.children === "string" ? props.children : "",
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
  explorerLabel,
  failureMessage,
  polledState,
  receivedFrom,
  type SentenceApprovalWiring,
  type SentenceCardState,
} from "./SentenceTradeCard";

const DEPOSIT_ADDRESS =
  "e0240dfbadb1bd03ec5f5e1c93899f59a80f1307354d534bd10563d566897a43";
const CONFIDENTIAL_ACCOUNT = "f".repeat(64);
const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
const SERVER_DESTINATION = "0x0000000000000000000000000000000000000001";
const EVM_ACCOUNT = "0x3259aBcDeF12345678901073";
const NEAR_ACCOUNT = "0xb0b14cd82e1f0e6ee391ae3a31a0173aff8373b1";

function render(element: React.ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(element);
}

/** The sentence region only, so drawer copy cannot mask a sentence change. */
function sentenceOf(html: string): string {
  const match = html.match(/data-sentence[^>]*>([\s\S]*?)<\/div>/);
  return match?.[1] ?? "";
}

/** The sentence as a reader sees it, with chips reduced to their words. */
function sentenceText(html: string): string {
  return sentenceOf(html)
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function button(label: string) {
  return state.buttons.find((entry) => entry.label === label);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const depositApproval: SentenceApproval = async () => ({
  ok: true,
  transactionId: "tx-deposit-1",
  depositAddress: DEPOSIT_ADDRESS,
  depositMemo: "memo-1",
  amountIn: "2",
  expiresAt: "2099-01-01T00:00:00.000Z",
});

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
  approveLabel: "Deposit",
  runApproval: depositApproval,
};

type Calls = {
  states: SentenceCardState[];
  errors: Array<string | null>;
  txIds: string[];
  deposits: string[];
  memos: Array<string | null>;
  fees: Array<string | undefined>;
  figures: Array<Record<string, unknown>>;
  destinations: string[];
  detailsOpened: number;
  approvals: Array<unknown>;
};

/** The card's wiring, recorded so the adapter flow can be asserted. */
function record(
  action: TradeAction,
  runApproval: SentenceApproval,
  expired = false,
): { input: SentenceApprovalWiring; calls: Calls } {
  const calls: Calls = {
    states: [],
    errors: [],
    txIds: [],
    deposits: [],
    memos: [],
    fees: [],
    figures: [],
    destinations: [],
    detailsOpened: 0,
    approvals: [],
  };
  return {
    calls,
    input: {
      action,
      runApproval,
      expired,
      inFlight: { current: false },
      setState: (next) => calls.states.push(next),
      setError: (message) => calls.errors.push(message),
      setTxId: (id) => calls.txIds.push(id),
      setDeposit: (address) => calls.deposits.push(address),
      setMemo: (memo) => calls.memos.push(memo),
      setFee: (fee) => calls.fees.push(fee),
      setFigures: (patch) => calls.figures.push(patch),
      setDestination: (destination) => calls.destinations.push(destination),
      openDetails: () => {
        calls.detailsOpened += 1;
      },
      onApprove: (tx) => calls.approvals.push(tx),
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

describe("passkey deposit on the sentence card", () => {
  it("says where the money goes without inventing a wallet source", () => {
    const html = render(<SentenceTradeCard {...depositCard} />);
    const sentence = sentenceOf(html);

    expect(sentence).toContain("Deposit");
    expect(sentence).not.toContain("Send");
    expect(sentence).toContain("2");
    expect(sentence).toContain("USDC");
    expect(sentence).toContain("in your");
    expect(sentence).toContain("Near Account");
    // No funding account exists for a passkey deposit, so no "from" clause —
    // and never the generic "your wallet" chip the wallet card falls back to.
    expect(sentence).not.toContain("from");
    expect(html).not.toContain("your wallet");
    expect(html).toContain("Deposit");
    expect(html).not.toContain(">Approve<");
  });

  it("shows the full one-time address, the memo, and the deadline in Details", () => {
    const html = render(
      <SentenceTradeCard
        {...depositCard}
        state="waiting"
        depositAddress={DEPOSIT_ADDRESS}
        depositMemo="memo-1"
        expiresAt="2099-01-01T00:00:00.000Z"
        transactionId="tx-deposit-1"
      />,
    );

    expect(html).toContain(DEPOSIT_ADDRESS);
    expect(html).toContain("memo-1");
    expect(html).toContain("Valid until");
    expect(html).toContain("break-all");
    expect(html).toContain("select-all");
    expect(html).toContain("Copy");
    expect(html).not.toContain("Deposit to");
    expect(html).not.toContain("Send from an exchange or another wallet.");
    expect(html).toContain("Waiting");
    // A minted address is not an invitation to mint a second one.
    expect(html).not.toContain(">Deposit<");
  });

  it("runs the injected approval and never posts to /api/approve", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const runApproval = vi.fn(depositApproval);
    const onApprove = vi.fn();

    render(
      <SentenceTradeCard
        {...depositCard}
        approvalId="aitxt-deposit-1"
        runApproval={runApproval}
        onApprove={onApprove}
      />,
    );
    const deposit = button("Deposit");
    expect(deposit).toBeTruthy();

    await deposit?.onClick?.();

    expect(runApproval).toHaveBeenCalledTimes(1);
    expect(runApproval).toHaveBeenCalledWith({ onPhase: expect.any(Function) });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onApprove).toHaveBeenCalledWith({
      transactionId: "tx-deposit-1",
      depositAddress: DEPOSIT_ADDRESS,
    });
  });

  it("lands the minted address on Waiting and opens the details", async () => {
    const { input, calls } = record("deposit", depositApproval);

    await approveThroughAdapter(input);

    expect(calls.states).toEqual(["preparing", "waiting"]);
    expect(calls.txIds).toEqual(["tx-deposit-1"]);
    expect(calls.deposits).toEqual([DEPOSIT_ADDRESS]);
    expect(calls.memos).toEqual(["memo-1"]);
    expect(calls.detailsOpened).toBe(1);
    expect(calls.errors).toEqual([null]);
    expect(calls.approvals).toEqual([
      { transactionId: "tx-deposit-1", depositAddress: DEPOSIT_ADDRESS },
    ]);
  });

  it("hands the signing and submitting phases to a signing journey", async () => {
    let phase: ((state: "signing" | "submitting") => void) | undefined;
    const runApproval: SentenceApproval = async (input) => {
      phase = input.onPhase;
      input.onPhase("signing");
      input.onPhase("submitting");
      return {
        ok: true,
        transactionId: "tx-swap-1",
        depositAddress: DEPOSIT_ADDRESS,
      };
    };
    const { input, calls } = record("swap", runApproval);

    await approveThroughAdapter(input);

    expect(phase).toBeTypeOf("function");
    expect(calls.states).toEqual([
      "signing",
      "signing",
      "submitting",
      "processing",
    ]);
  });

  it("does not request an address while the rendered state has expired", async () => {
    const runApproval = vi.fn(depositApproval);
    const { input, calls } = record("deposit", runApproval, true);

    await approveThroughAdapter(input);

    expect(runApproval).not.toHaveBeenCalled();
    expect(calls.states).toEqual(["expired"]);
  });

  it("expires from the quote deadline, not a wallet request window", () => {
    const html = render(
      <SentenceTradeCard
        {...depositCard}
        expiresAt="2020-01-01T00:00:00.000Z"
      />,
    );

    expect(html).toContain("Expired");
    expect(html).not.toContain(">Deposit<");
    expect(html).not.toContain(">Reject<");
  });
});

describe("passkey withdrawal on the sentence card", () => {
  const withdrawCard = {
    action: "withdraw" as const,
    fromSymbol: "USDC",
    fromChain: "near",
    toSymbol: "USDC",
    toChain: "arb",
    amountIn: "0.5",
    amountOut: "0.4894",
    minAmountOut: "0.484506",
    recipient: DESTINATION,
    destinationChain: "Arbitrum One",
    fee: "0.0106",
    expiresAt: "2099-01-01T00:00:00.000Z",
    runApproval: (async () => ({
      ok: false,
      message: "The quote is no longer available. Ask for a fresh one.",
    })) satisfies SentenceApproval,
  };

  it("shows the destination, fee, chain, minimum, and deadline", () => {
    const html = render(<SentenceTradeCard {...withdrawCard} />);

    expect(sentenceOf(html)).toContain("Withdraw");
    expect(sentenceOf(html)).toContain("from your");
    expect(sentenceOf(html)).toContain("Near Account");
    expect(sentenceOf(html)).toContain("0xc8aE…3148");
    expect(html).toContain("Destination");
    // The drawer shortens the destination; the whole address stays one copy
    // away, in the copy button and the title.
    expect(html).toContain("0xc8aE…3148");
    expect(html).toContain(`title="${DESTINATION}"`);
    expect(html).not.toContain(`>${DESTINATION}<`);
    expect(html).toContain("Copy address");
    expect(html).toContain("Fee");
    expect(html).toContain("0.0106");
    expect(html).toContain("Chain");
    expect(html).toContain('title="Arbitrum"');
    // The chain reads as Arbitrum, not the chain's full registered name.
    expect(html).toContain(">Arbitrum<");
    expect(html).not.toContain("Arbitrum One");
    expect(html).toContain("Minimum received");
    expect(html).toContain("0.484506");
    expect(html).toContain("Deadline");
    expect(html).toContain(">Reject<");
    expect(html).toContain(">Approve<");
  });

  it("shows a resolved name beside its truncated address", () => {
    const html = render(
      <SentenceTradeCard {...withdrawCard} recipientName="vitalik.eth" />,
    );

    // The sentence names the destination; the drawer pairs the name with
    // the truncated address. The whole address stays one copy away.
    expect(sentenceOf(html)).toContain("vitalik.eth");
    expect(html).toContain("vitalik.eth · 0xc8aE…3148");
    expect(html).toContain(`title="${DESTINATION}"`);
    expect(html).not.toContain(`>${DESTINATION}<`);
  });

  it("marks each amount with its token and names the transaction it settled", () => {
    const html = render(
      <SentenceTradeCard
        {...withdrawCard}
        initialExplorerUrls={[
          "https://arbiscan.io/tx/0x9f2c1d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
        ]}
      />,
    );

    // The token mark sits between the figure and the ticker, grouped with the
    // ticker rather than floating midway between the two.
    expect(html).toMatch(
      /<span class="inline-flex items-center gap-2">0\.0106<span class="inline-flex items-center gap-1"><span[^>]*title="USDC"/,
    );
    expect(html).toMatch(
      /<span class="inline-flex items-center gap-2">0\.484506<span class="inline-flex items-center gap-1"><span[^>]*title="USDC"/,
    );
    expect(html).toContain("Transaction");
    expect(html).toContain("0x9f2c…1c2d");
    // A receipt is not a call to action: the link reads in ink, not accent.
    expect(html).not.toContain("View on explorer");
    expect(html).not.toContain("Settlement");
  });

  it("never renders the quote's confidential deposit account", () => {
    const html = render(
      <SentenceTradeCard
        {...withdrawCard}
        depositAddress={CONFIDENTIAL_ACCOUNT}
        transactionId="tx-withdraw-1"
      />,
    );

    expect(html).not.toContain(CONFIDENTIAL_ACCOUNT);
    expect(html).not.toContain("Deposit to");
  });

  it("leaves the fee row out when the quote did not price one", () => {
    const html = render(
      <SentenceTradeCard {...withdrawCard} fee={undefined} destinationChain={undefined} />,
    );

    expect(html).not.toContain(">Fee<");
    expect(html).not.toContain(">Chain<");
  });

  it("replaces the displayed destination with the server's rebuild", async () => {
    const { input, calls } = record("withdraw", async () => ({
      ok: true,
      transactionId: "tx-withdraw-1",
      depositAddress: CONFIDENTIAL_ACCOUNT,
      destination: SERVER_DESTINATION,
      fee: "0.0106",
      minAmountOut: "0.484506",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }));

    await approveThroughAdapter(input);

    expect(calls.states).toEqual(["signing", "processing"]);
    expect(calls.destinations).toEqual([SERVER_DESTINATION]);
    // The confidential account is the intent's business, not the reader's.
    expect(calls.deposits).toEqual([]);
    expect(calls.txIds).toEqual(["tx-withdraw-1"]);
    expect(calls.fees).toEqual(["0.0106"]);
    expect(calls.figures[0]).toMatchObject({
      minAmountOut: "0.484506",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    // The host receives the record; the withdrawal host ignores it so the
    // confidential account never reaches the stored approval.
    expect(calls.approvals).toEqual([
      { transactionId: "tx-withdraw-1", depositAddress: CONFIDENTIAL_ACCOUNT },
    ]);
  });

  it("keeps a failed approval retryable with the server's own sentence", async () => {
    const message = "The withdrawal could not be prepared. Nothing was moved.";
    const { input, calls } = record("withdraw", async () => ({
      ok: false,
      message,
    }));

    await approveThroughAdapter(input);

    expect(calls.states).toEqual(["signing", "awaiting"]);
    expect(calls.errors).toEqual([null, message]);
    expect(calls.txIds).toEqual([]);
  });

  it("marks an expired quote expired without a second sentence", async () => {
    const { input, calls } = record("withdraw", async () => ({
      ok: false,
      message: "The quote expired. Ask for a new one.",
      expired: true,
    }));

    await approveThroughAdapter(input);

    expect(calls.states).toEqual(["signing", "expired"]);
    expect(calls.errors).toEqual([null, null]);
  });

  it("reads a settled withdrawal's received amount from the record only", () => {
    const html = render(
      <SentenceTradeCard {...withdrawCard} state="settled" />,
    );
    // The quote's expected output is not a receipt.
    expect(html).not.toContain("Received");
    expect(receivedFrom({ amountOut: "0.4891" })).toBe("0.4891");
    expect(receivedFrom({ amountOut: "  " })).toBeNull();
    expect(receivedFrom(undefined)).toBeNull();
  });

  it("keeps the record's receipt on a reopened card", () => {
    const html = render(
      <SentenceTradeCard
        {...withdrawCard}
        state="settled"
        initialReceived="1.9894"
        initialExplorerUrls={[
          "https://arbiscan.io/tx/0x9f2c1d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
        ]}
      />,
    );

    // A card rebuilt from the record shows what it already settled, with
    // the same token grouping as the quote's own figures.
    expect(html).toContain("Received");
    expect(html).toMatch(
      /<span class="inline-flex items-center gap-2">1\.9894<span class="inline-flex items-center gap-1"><span[^>]*title="USDC"/,
    );
    expect(html).toContain("0x9f2c…1c2d");
  });

  it("names a withdrawal failure as a settlement, not a deposit", () => {
    const html = render(
      <SentenceTradeCard {...withdrawCard} state="failed" />,
    );
    expect(html).toContain(
      "The withdrawal did not settle. The record has the details.",
    );
    expect(html).not.toContain("Deposit failed");
  });

  it("reads the withdrawal's progress in the record's own words", () => {
    expect(render(<SentenceTradeCard {...withdrawCard} disabled />)).toContain(
      "Pending Approval",
    );
    expect(
      render(<SentenceTradeCard {...withdrawCard} state="processing" />),
    ).toContain(">Processing<");
    expect(
      render(<SentenceTradeCard {...withdrawCard} state="submitted" />),
    ).toContain(">Submitted<");
    expect(
      render(<SentenceTradeCard {...withdrawCard} state="settled" />),
    ).toContain(">Executed<");
    expect(
      render(<SentenceTradeCard {...withdrawCard} state="settled" />),
    ).not.toContain(">Approved<");
  });

  it("offers sign in instead of a dead pending pill when the card is blocked", () => {
    const html = render(
      <SentenceTradeCard
        {...withdrawCard}
        disabled
        blocked="sign-in"
        onSignIn={() => {}}
      />,
    );

    expect(html).toContain(">Sign in<");
    expect(html).not.toContain("Pending Approval");
  });

  it("offers a fresh quote when the card has no stored quote", () => {
    const html = render(
      <SentenceTradeCard
        {...withdrawCard}
        disabled
        blocked="quote"
        onPrompt={() => {}}
      />,
    );

    expect(html).toContain(">New quote<");
    expect(html).not.toContain("Pending Approval");
  });

  it("keeps a waiting deposit waiting and a submitted withdrawal submitted", () => {
    expect(polledState("submitted", "deposit", true)).toBe("waiting");
    expect(polledState("pending", "deposit", true)).toBe("waiting");
    expect(polledState("confirming", "deposit", true)).toBe("processing");
    expect(polledState("processing", "deposit", true)).toBe("processing");
    expect(polledState("expired", "deposit", true)).toBe("expired");
    expect(polledState("expired", "swap", true)).toBe("expired");
    expect(polledState("expired", "swap", false)).toBe("expired");
    expect(polledState("submitted", "withdraw", true)).toBe("submitted");
    // A submitted swap keeps processing until the record settles.
    expect(polledState("submitted", "swap", true)).toBe("processing");
    expect(polledState("pending", "swap", true)).toBe("processing");
    // The wallet path is unchanged: a non-terminal record reads as approved.
    expect(polledState("submitted", "swap", false)).toBe("submitted");
  });
});

describe("explorerLabel", () => {
  it("names the transaction an explorer link points at", () => {
    expect(
      explorerLabel(
        "https://arbiscan.io/tx/0x9f2c1d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
      ),
    ).toBe("0x9f2c…1c2d");
    expect(explorerLabel("https://explorer.example/tx/0x1234")).toBe("0x1234");
    expect(explorerLabel("not a url")).toBe("not a url");
  });
});

describe("passkey swap on the sentence card", () => {
  const swapCard = {
    action: "swap" as const,
    fromSymbol: "USDC",
    fromChain: "near",
    toSymbol: "USDT",
    toChain: "near",
    // The user's sentence, verbatim: the existing swap template.
    amountIn: "14.44",
    amountOut: "14.17",
    minAmountOut: "14.0283",
    slippageBps: 100,
    recipient: NEAR_ACCOUNT,
    expiresAt: "2099-01-01T00:00:00.000Z",
    approvalId: "aitxt-swap-1",
    runApproval: (async () => ({
      ok: true,
      transactionId: "tx-swap-1",
      depositAddress: CONFIDENTIAL_ACCOUNT,
    })) satisfies SentenceApproval,
  };

  it("reads an account-funded swap as money moving inside Near Account", () => {
    const html = render(<SentenceTradeCard {...swapCard} />);
    expect(sentenceText(html)).toBe(
      "Swap 14.44 USDC for 14.17 USDT in your Near Account",
    );
  });

  it("keeps the wallet swap's Details rows and adds nothing", () => {
    const html = render(
      <SentenceTradeCard
        {...swapCard}
        initialExplorerUrls={["https://explorer.example/tx/1"]}
      />,
    );

    expect(html).toContain("Minimum received");
    expect(html).toContain("14.0283");
    expect(html).toContain("Rate");
    expect(html).toContain("Slippage");
    expect(html).toContain("1.00%");
    expect(html).toContain("Price held until");
    expect(html).toContain("Settlement");
    expect(html).toContain("View on explorer");
    // No wallet identity rows and no confidential deposit account.
    expect(html).not.toContain(">Recipient<");
    expect(html).not.toContain(">Refund to<");
    expect(html).not.toContain(">Deposit to<");
    expect(html).not.toContain(">Destination<");
    expect(html).not.toContain(CONFIDENTIAL_ACCOUNT);
  });

  it("lands a submitted intent on Processing and continues the turn", async () => {
    const { input, calls } = record("swap", swapCard.runApproval);

    await approveThroughAdapter(input);

    expect(calls.states).toEqual(["signing", "processing"]);
    expect(calls.txIds).toEqual(["tx-swap-1"]);
    expect(calls.errors).toEqual([null]);
    // A swap has no external address to show or fund.
    expect(calls.deposits).toEqual([]);
    expect(calls.destinations).toEqual([]);
    // The record goes back to the host so a reload rejoins the settlement.
    expect(calls.approvals).toEqual([
      { transactionId: "tx-swap-1", depositAddress: CONFIDENTIAL_ACCOUNT },
    ]);
  });

  it("stays retryable with the server's own sentence and never a deposit", async () => {
    const message = "The trade could not be prepared. Nothing was moved.";
    const { input, calls } = record("swap", async () => ({
      ok: false,
      message,
    }));

    await approveThroughAdapter(input);

    expect(calls.states).toEqual(["signing", "awaiting"]);
    expect(calls.errors).toEqual([null, message]);
    expect(calls.txIds).toEqual([]);
  });

  it("names a failed swap as a trade, not a deposit", () => {
    const html = render(<SentenceTradeCard {...swapCard} state="failed" />);
    expect(html).toContain("The trade did not settle. The record has the details.");
    expect(html).not.toContain("Deposit failed");
  });
});

describe("the wallet branch under the same card", () => {
  const walletSwap = {
    action: "swap" as const,
    fromSymbol: "USDT",
    fromChain: "near",
    toSymbol: "ETH",
    toChain: "near",
    amountIn: "55",
    amountOut: "0.05",
    minAmountOut: "0.0495",
    minAmountOutRaw: "49000000000000000",
    recipient: EVM_ACCOUNT,
    expiresAt: "2099-01-01T00:00:00.000Z",
    requestedAt: new Date().toISOString(),
    slippageBps: 100,
    approvalId: "aitxt-wallet-1",
    swapInput: {
      fromAssetId: "nep141:usdt",
      toAssetId: "nep141:eth",
      amount: "55000000",
      recipient: EVM_ACCOUNT,
      slippageBps: 100,
      quoteId: "11111111-1111-4111-8111-111111111111",
    },
  };

  it("still signs, posts to /api/approve, and sends the deposit", async () => {
    state.account = {
      kind: "evm",
      standard: "erc191",
      address: EVM_ACCOUNT,
      signerId: EVM_ACCOUNT,
      publicKey: "",
    };
    state.signMessage.mockResolvedValue(new Uint8Array([1, 2, 3]));
    state.sendDeposit.mockResolvedValue({ txHash: "0xdeposit-hash" });
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        void _init;
        const url = String(input);
        if (url === "/api/approve") {
          return jsonResponse({
            transactionId: "tx-wallet-1",
            depositAddress: "0xone-time-address",
            amountIn: "55",
            tokenContract: "0xtoken",
            originChain: "arb",
            originChainId: 42161,
            originChainName: "Arbitrum",
          });
        }
        if (url === "/api/tx/tx-wallet-1/deposit") {
          return jsonResponse({ ok: true });
        }
        throw new Error(`unexpected request ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchSpy);
    const onApprove = vi.fn();

    render(
      <SentenceTradeCard {...walletSwap} onApprove={onApprove} />,
    );
    const approve = button("Approve");
    expect(approve).toBeTruthy();

    await approve?.onClick?.();

    const urls = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(urls[0]).toBe("/api/approve");
    expect(urls).toContain("/api/tx/tx-wallet-1/deposit");
    // The body names the preview it was priced against, and the signed
    // message and the body share one approval birth.
    const posted = JSON.parse(
      String((fetchSpy.mock.calls[0][1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(posted.quoteId).toBe(walletSwap.swapInput.quoteId);
    expect(posted.requestedAt).toBe(walletSwap.requestedAt);
    expect(posted.message).toContain(`Requested: ${walletSwap.requestedAt}`);
    expect(state.signMessage).toHaveBeenCalledTimes(1);
    expect(state.sendDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        depositAddress: "0xone-time-address",
        amount: "55",
        tokenContract: "0xtoken",
        chainId: 42161,
      }),
    );
    expect(onApprove).toHaveBeenCalledWith({
      transactionId: "tx-wallet-1",
      depositAddress: "0xone-time-address",
    });
  });

  it("signs the EIP-55 refund when the card defaults to a lowercase account", async () => {
    const lower = "0x32596df10ff2ac5acde8406e6adcc8d047921073";
    const canonical = normalizeEvmAddress(lower) as string;
    expect(canonical).not.toBe(lower);

    state.account = {
      kind: "evm",
      standard: "erc191",
      address: lower,
      signerId: lower,
      publicKey: "",
    };
    state.signMessage.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "unavailable", message: "no" }, 400),
      ),
    );

    render(<SentenceTradeCard {...walletSwap} />);
    const approve = button("Approve");
    expect(approve).toBeTruthy();

    await approve?.onClick?.();

    expect(state.signMessage).toHaveBeenCalledTimes(1);
    const signedBytes = state.signMessage.mock.calls[0][0] as Uint8Array;
    const message = new TextDecoder().decode(signedBytes);
    expect(message).toContain(`Refund to: ${canonical}`);
    expect(message).not.toContain(`Refund to: ${lower}`);
  });

  it("keeps the wallet drawer's rows and copy", () => {
    state.account = {
      kind: "evm",
      standard: "erc191",
      address: EVM_ACCOUNT,
      signerId: EVM_ACCOUNT,
      publicKey: "",
    };
    const html = render(
      <SentenceTradeCard
        {...walletSwap}
        depositAddress="0xone-time-address"
      />,
    );

    expect(html).toContain("Recipient");
    expect(html).toContain("Rate");
    expect(html).toContain("Slippage");
    expect(html).toContain("Price held until");
    expect(html).toContain("Deposit to");
    // The intents rows belong to the injected path only.
    expect(html).not.toContain("Send from an exchange or another wallet.");
    expect(html).not.toContain("Valid until");
  });

  it("keeps the wallet's expiry window on the card birth", () => {
    const html = render(
      <SentenceTradeCard
        {...walletSwap}
        requestedAt="2020-01-01T00:00:00.000Z"
      />,
    );
    expect(html).toContain("Expired");
    expect(html).not.toContain(">Approve<");
  });

  it("expires a wallet card at the quote deadline before the request window", () => {
    const html = render(
      <SentenceTradeCard
        {...walletSwap}
        requestedAt={new Date().toISOString()}
        expiresAt="2020-01-01T00:00:00.000Z"
      />,
    );
    expect(html).toContain("Expired");
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain(">Reject<");
  });
});

describe("failure copy", () => {
  it("is action-aware and leaves the wallet sentences alone", () => {
    expect(failureMessage("failed", "withdraw", true)).toBe(
      "The withdrawal did not settle. The record has the details.",
    );
    expect(failureMessage("incomplete_deposit", "deposit", true)).toBe(
      "The deposit arrived short of the quoted amount.",
    );
    expect(failureMessage("needs_reconciliation", "deposit", true)).toBe(
      "The settlement timed out before confirming.",
    );
    expect(failureMessage("failed", "swap", false)).toBe(
      "Deposit failed. Nothing was moved.",
    );
  });
});
