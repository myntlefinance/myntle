import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import type { UIMessage } from "ai";
import type { SessionIdentity } from "@/lib/auth/session-identity";

const state = vi.hoisted(() => ({
  identity: null as SessionIdentity | null,
  /** Whether the current session can sign; defaults true for old tests. */
  canSign: true,
  /** The connected wallet the signer would use, when a test needs one. */
  account: null as null | { kind: "evm"; address: string; publicKey?: string },
  signMessage: vi.fn(),
  signNEP413: vi.fn(),
  /** Every money card the live response renders, with the props it passed. */
  cards: [] as Array<Record<string, unknown>>,
  /** The copied transcript each turn produced, if any. */
  copyTexts: [] as string[],
  /** The passkey ceremony, mocked so the signer can be observed. */
  signIntentWithPasskey: vi.fn(async (payload: string) => ({
    standard: "webauthn",
    payload,
    public_key: "p256:public-key",
    signature: "p256:signature",
    client_data_json: '{"type":"webauthn.get"}',
    authenticator_data: "auth-data",
  })),
}));

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({
    account: state.account,
    signMessage: state.signMessage,
    signNEP413: state.signNEP413,
  }),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({
    identity: state.identity,
    canSign: state.canSign,
    connected: true,
  }),
}));

vi.mock("@/lib/auth/passkey-signer", () => ({
  signIntentWithPasskey: state.signIntentWithPasskey,
}));

// The money card is replaced with a marker that records its props: this test
// is about which path the live response chooses and what it hands the card,
// not about the card's own rendering.
vi.mock("@/components/finance/SentenceTradeCard", () => ({
  default: (props: Record<string, unknown>) => {
    state.cards.push(props);
    return props?.action === "deposit"
      ? "sentence-deposit-card"
      : props?.action === "withdraw"
        ? "sentence-withdraw-card"
        : "sentence-swap-card";
  },
}));

// The action row is replaced with a marker that records the copy payload:
// this is the only way to read the copied transcript from static markup.
vi.mock("@/components/app/MessageActions", () => ({
  AgentMessageActions: (props: { copyText?: string }) => {
    if (props.copyText) state.copyTexts.push(props.copyText);
    return "message-actions";
  },
}));

// The balance table is replaced with a marker: these tests are about whether
// the turn draws it, not about the table's own rendering.
vi.mock("@/components/finance/AssetMatrix", () => ({
  default: (props: Record<string, unknown>) =>
    `asset-matrix:${String(props.title)}`,
}));

import { LiveResponse } from "./LiveResponse";
import type { SentenceApproval } from "@/components/finance/sentence-approval";
import type { SettlementSnapshot } from "./approvals";

const FROM = "nep141:usdc";
const TO = "nep141:wrap.near";
const RECIPIENT = "0x7edf07ede58238026db3f90fc8032633b69b8de5";
const QUOTE_ID = "8a1f7c2e-0c6c-4a54-9a7a-1c2d3e4f5a6b";
const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

/** The get_quote output every proposal in these turns was priced from. */
function quotePart(route: "account" | "wallet" = "wallet") {
  return {
    type: "tool-get_quote",
    state: "output-available",
    input: {
      fromAssetId: FROM,
      toAssetId: TO,
      amount: "25000000",
      recipient: RECIPIENT,
    },
    output: {
      amountIn: "25",
      amountOut: "23.5",
      minAmountOut: "23.2",
      minAmountOutRaw: "23200000000000000000000000",
      expiresAt: "2099-01-01T00:00:00.000Z",
      quoteId: QUOTE_ID,
      route,
    },
  };
}

function swapMessage(
  action = "swap",
  route: "account" | "wallet" = "wallet",
): UIMessage {
  return {
    id: "msg-1",
    role: "assistant",
    parts: [
      quotePart(route),
      {
        type: "tool-prepare_swap",
        state: "approval-requested",
        input: {
          action,
          fromAssetId: FROM,
          toAssetId: TO,
          amount: "25000000",
          recipient: RECIPIENT,
          slippageBps: 100,
        },
        approval: { id: "aitxt-1" },
      },
    ],
    metadata: { createdAt: "2026-11-02T12:00:00.000Z" },
  } as unknown as UIMessage;
}

function limitOrderMessage(): UIMessage {
  return {
    id: "msg-limit",
    role: "assistant",
    parts: [
      {
        type: "tool-get_limit_order_quote",
        state: "output-available",
        input: {
          baseAssetId: TO,
          quoteAssetId: FROM,
          side: "SELL",
          quantity: "1000000000000000000000000",
          price: "5",
        },
        output: {
          quoteId: QUOTE_ID,
          side: "SELL",
          baseAssetId: TO,
          quoteAssetId: FROM,
          inputAssetId: TO,
          outputAssetId: FROM,
          inputAmount: "1000000000000000000000000",
          outputAmount: "5000000",
          quantityFormatted: "1",
          totalFormatted: "5",
          price: "5",
          funding: "account",
          route: "account",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
      {
        type: "tool-prepare_limit_order",
        state: "approval-requested",
        input: { quoteId: QUOTE_ID },
        approval: { id: "aitxt-limit-1" },
      },
    ],
    metadata: { createdAt: "2026-11-02T12:00:00.000Z" },
  } as unknown as UIMessage;
}

function depositMessage(
  state: "approval-requested" | "output-available" = "approval-requested",
): UIMessage {
  return {
    id: "msg-2",
    role: "assistant",
    parts: [
      {
        type: "tool-prepare_deposit",
        state,
        input: {
          assetId: FROM,
          amount: "1000000",
          source: "external",
        },
        ...(state === "approval-requested"
          ? { approval: { id: "aitxt-deposit-1" } }
          : {
              approval: { id: "aitxt-deposit-1", approved: true },
              output: {
                acknowledged: true,
                action: "deposit",
                assetId: FROM,
                amount: "1000000",
                mode: "confidential-external",
              },
            }),
      },
    ],
    metadata: { createdAt: "2026-11-02T12:00:00.000Z" },
  } as unknown as UIMessage;
}

function withdrawalMessage(): UIMessage {
  return {
    id: "msg-3",
    role: "assistant",
    parts: [
      {
        type: "tool-get_withdrawal_quote",
        state: "output-available",
        input: {
          fromAssetId: FROM,
          toAssetId: FROM,
          amount: "500000",
          destinationAddress: DESTINATION,
        },
        output: {
          mode: "confidential-withdrawal",
          quoteId: QUOTE_ID,
          fromAssetId: FROM,
          toAssetId: FROM,
          amountIn: "0.5",
          amountOut: "0.4894",
          minAmountOut: "0.484506",
          withdrawFeeFormatted: "0.0106",
          destination: DESTINATION,
          destinationChain: "arb",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
      {
        type: "tool-prepare_withdrawal",
        state: "approval-requested",
        input: {
          fromAssetId: FROM,
          toAssetId: FROM,
          amount: "500000",
          destinationAddress: DESTINATION,
        },
        approval: { id: "aitxt-withdraw-1" },
      },
    ],
    metadata: { createdAt: "2026-11-02T12:00:00.000Z" },
  } as unknown as UIMessage;
}

function balanceMessage(showCard: boolean): UIMessage {
  return {
    id: "msg-balance",
    role: "assistant",
    parts: [
      {
        type: "tool-get_wallet_balances",
        state: "output-available",
        toolCallId: "call-balance",
        input: { networks: ["arbitrum"], symbol: "USDC" },
        output: {
          source: "session",
          address: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
          chain: "evm",
          title: "Arbitrum balances",
          showFilters: false,
          initialFilter: "all",
          singleNetwork: "arbitrum",
          category: "all",
          totalValueUsd: 5.2,
          showCard,
          groups: [
            {
              id: "arbitrum",
              name: "Arbitrum",
              icon: "arbitrum",
              items: [
                {
                  id: "arb-usdc",
                  symbol: "USDC",
                  name: "USD Coin",
                  amount: "5.2",
                  valueUsd: 5.2,
                  category: "stables",
                },
              ],
            },
          ],
          wallet: {
            balances: [
              {
                symbol: "USDC",
                chain: "arb",
                balance: "5.2",
                valueUsd: 5.2,
              },
            ],
            totalValueUsd: 5.2,
          },
          settlementLedger: null,
        },
      },
    ],
    metadata: { createdAt: "2026-11-02T12:00:00.000Z" },
  } as unknown as UIMessage;
}

function nameMessage(
  status: "resolved" | "unregistered",
  name = "vitalik.eth",
): UIMessage {
  return {
    id: "msg-name",
    role: "assistant",
    parts: [
      {
        type: "tool-resolve_ens_name",
        state: "output-available",
        toolCallId: "call-name",
        input: { name },
        output:
          status === "resolved"
            ? {
                status,
                name,
                address: VITALIK,
                chain: "evm",
                resolvedAt: "2026-11-10T00:00:00.000Z",
              }
            : {
                status,
                name,
                chain: "evm",
                message: "That name is not registered.",
              },
      },
    ],
    metadata: { createdAt: "2026-11-10T00:00:00.000Z" },
  } as unknown as UIMessage;
}

const passkeyIdentity: SessionIdentity = {
  kind: "passkey",
  chain: "near",
  address: RECIPIENT,
  accountId: RECIPIENT,
  intentsAccountId: RECIPIENT,
  credentialId: "credential-id",
  publicKey: "p256:public-key",
  rpId: "myntle.xyz",
};

const walletIdentity: SessionIdentity = {
  kind: "wallet",
  chain: "evm",
  address: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  intentsAccountId: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
};

function render(message: UIMessage): string {
  return ReactDOMServer.renderToStaticMarkup(
    <LiveResponse message={message} status="ready" />,
  );
}

function renderWithSettlements(
  message: UIMessage,
  settlements: Record<string, SettlementSnapshot>,
): string {
  return ReactDOMServer.renderToStaticMarkup(
    <LiveResponse message={message} status="ready" settlements={settlements} />,
  );
}

const DEPOSIT = "0x1111111111111111111111111111111111111111";

/** The props the last money card received, narrowed for assertions. */
function lastCard(): Record<string, unknown> {
  const card = state.cards.at(-1);
  if (!card) throw new Error("no money card was rendered");
  return card;
}

/** The copied transcript the last render produced. */
function lastCopyText(): string {
  const text = state.copyTexts.at(-1);
  if (text === undefined) throw new Error("no copy text was produced");
  return text;
}

beforeEach(() => {
  state.identity = null;
  state.canSign = true;
  state.account = null;
  state.cards = [];
  state.copyTexts = [];
  state.signMessage.mockReset();
  state.signNEP413.mockReset();
  state.signIntentWithPasskey.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LiveResponse balance card", () => {
  it("omits the table for a one-token check", () => {
    const html = render(balanceMessage(false));

    expect(html).not.toContain("asset-matrix");
  });

  it("draws the table for an inventory result", () => {
    const html = render(balanceMessage(true));

    expect(html).toContain("asset-matrix:Arbitrum balances");
  });
});

describe("LiveResponse activity status", () => {
  it("names the running tool instead of counting tools", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={nameMessage("resolved")} status="streaming" />,
    );

    expect(html).toContain("Resolving an ENS name");
    expect(html).not.toContain("Ran 1 tool");
    expect(html).not.toContain("resolve_ens_name");
  });

  it("drops the line once the answer starts", () => {
    const message = nameMessage("resolved");
    const withAnswer = {
      ...message,
      parts: [
        ...message.parts,
        { type: "text", text: `The address is ${VITALIK}.` },
      ],
    } as unknown as UIMessage;

    const html = ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={withAnswer} status="streaming" />,
    );

    expect(html).not.toContain("Resolving an ENS name");
    expect(html).not.toContain('role="status"');
    expect(html).toContain(VITALIK);
  });

  it("keeps the last tool name when the turn ends on tool work", () => {
    const html = render(nameMessage("resolved"));

    expect(html).toContain("Resolved an ENS name");
    // The row is gone; the answer is the record. The lookup's value was
    // never on the line, so the screen no longer repeats it.
    expect(html).not.toContain(VITALIK);
  });

  it("keeps a failed call visible after the answer", () => {
    const message = {
      id: "msg-failed",
      role: "assistant",
      parts: [
        {
          type: "tool-get_google_news",
          state: "output-error",
          input: { query: "NEAR" },
          errorText: "The news source did not answer.",
        },
        { type: "text", text: "I could not reach the news source." },
      ],
      metadata: { createdAt: "2026-11-10T00:00:00.000Z" },
    } as unknown as UIMessage;

    const html = render(message);

    expect(html).toContain("Searching Google News");
    expect(html).toContain("failed");
    expect(html).toContain("The news source did not answer.");
  });

  it("morphs past thinking into the latest tool in the run", () => {
    const message = {
      id: "msg-thinking-tools",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "I should check the news." },
        {
          type: "tool-get_google_news",
          state: "output-available",
          input: { query: "NEAR" },
          output: { items: [] },
        },
        {
          type: "tool-get_reddit_posts",
          state: "input-available",
          input: { query: "NEAR" },
        },
      ],
      metadata: { createdAt: "2026-11-10T00:00:00.000Z" },
    } as unknown as UIMessage;

    const html = ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={message} status="streaming" />,
    );

    expect(html).toContain("Searching Reddit");
    expect(html).not.toContain("Searching Google News");
    expect(html).not.toContain("Thinking");
    expect(html).not.toContain("I should check the news.");
    expect(html).not.toContain("Ran 2 tools");
  });

  it("keeps a failure while a later tool is running", () => {
    const message = {
      id: "msg-failed-then-running",
      role: "assistant",
      parts: [
        {
          type: "tool-get_google_news",
          state: "output-error",
          input: { query: "NEAR" },
          errorText: "The news source did not answer.",
        },
        {
          type: "tool-get_reddit_posts",
          state: "input-available",
          input: { query: "NEAR" },
        },
      ],
      metadata: { createdAt: "2026-11-10T00:00:00.000Z" },
    } as unknown as UIMessage;

    const html = ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={message} status="streaming" />,
    );

    expect(html).toContain("Searching Google News");
    expect(html).toContain("failed");
    expect(html).toContain("Searching Reddit");
  });
});

describe("LiveResponse money card", () => {
  it("renders the sentence card for a passkey swap, with the Intents adapter", () => {
    state.identity = passkeyIdentity;
    const html = render(swapMessage("swap", "account"));

    expect(html).toContain("sentence-swap-card");
    const card = lastCard();
    expect(card.action).toBe("swap");
    expect(card.runApproval).toBeTypeOf("function");
    // The existing swap figures, unchanged.
    expect(card.fromSymbol).toBe("nep141:usdc");
    expect(card.toSymbol).toBe("nep141:wrap.near");
    expect(card.amountIn).toBe("25");
    expect(card.amountOut).toBe("23.5");
    expect(card.minAmountOut).toBe("23.2");
    expect(card.expiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(card.approvalId).toBe("aitxt-1");
    // The quote the adapter names; the card never posts to /api/approve.
    expect(card.swapInput).toMatchObject({ quoteId: QUOTE_ID });
  });

  it("falls back to the account kind for a turn stored before the route", () => {
    state.identity = passkeyIdentity;
    const legacy = swapMessage();
    const quote = legacy.parts[0] as unknown as {
      output: Record<string, unknown>;
    };
    delete quote.output.route;

    render(legacy);
    expect(lastCard().runApproval).toBeTypeOf("function");
  });

  it("copies a legacy passkey trade as money inside Near Account", () => {
    state.identity = passkeyIdentity;
    const legacy = swapMessage();
    const quote = legacy.parts[0] as unknown as {
      output: Record<string, unknown>;
    };
    delete quote.output.route;

    const html = render(legacy);
    expect(html).toContain("sentence-swap-card");
    // The card and the copy agree on the fallback route.
    expect(lastCard().runApproval).toBeTypeOf("function");
    const copy = lastCopyText();
    expect(copy).toContain("in Near Account");
    expect(copy).not.toContain("on Near Account");
    expect(copy).not.toContain("Recipient:");
  });

  it("runs the passkey swap through the Intents routes with the session signer", async () => {
    state.identity = passkeyIdentity;
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (url === "/api/intents/approve") {
          return new Response(
            JSON.stringify({
              transactionId: "3e6f2b9a-8f11-4d5c-9a1b-2c3d4e5f6a7b",
              depositAddress: "f".repeat(64),
              intent: { standard: "webauthn", payload: "payload-bytes" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        // The submit body carries the assertion the session signer produced.
        expect(JSON.parse(String(init?.body))).toMatchObject({
          transactionId: "3e6f2b9a-8f11-4d5c-9a1b-2c3d4e5f6a7b",
          signedData: { payload: "payload-bytes" },
        });
        return new Response(JSON.stringify({ intentHash: "hash" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    render(swapMessage("swap", "account"));
    const runApproval = lastCard().runApproval as SentenceApproval;
    const result = await runApproval({ onPhase: () => {} });

    expect(result).toEqual({
      ok: true,
      transactionId: "3e6f2b9a-8f11-4d5c-9a1b-2c3d4e5f6a7b",
      depositAddress: "f".repeat(64),
    });
    expect(urls).toEqual(["/api/intents/approve", "/api/intents/submit"]);
    expect(urls).not.toContain("/api/approve");
    // The one session signer, with the passkey identity's own credential.
    expect(state.signIntentWithPasskey).toHaveBeenCalledWith("payload-bytes", {
      credentialId: "credential-id",
      publicKey: "p256:public-key",
      rpId: "myntle.xyz",
    });
  });

  it("keeps the wallet branch for a wallet chain quote", () => {
    state.identity = walletIdentity;
    const html = render(swapMessage("swap", "wallet"));

    expect(html).toContain("sentence-swap-card");
    const card = lastCard();
    expect(card.action).toBe("swap");
    expect(card.runApproval).toBeUndefined();
    // The props the wallet signature is built from.
    expect(card.swapInput).toMatchObject({
      fromAssetId: FROM,
      toAssetId: TO,
      amount: "25000000",
      recipient: RECIPIENT,
      slippageBps: 100,
      quoteId: QUOTE_ID,
    });
    expect(card.requestedAt).toBe("2026-11-02T12:00:00.000Z");
    expect(card.minAmountOutRaw).toBe("23200000000000000000000000");
    expect(card.expiresAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("runs a wallet session's Near Account trade through the Intents routes", async () => {
    // The session is a wallet, but the quote is funded by its Near Account.
    // The card must follow the quote, not the account kind: approve → sign →
    // submit, never `/api/approve`.
    state.identity = walletIdentity;
    state.account = {
      kind: "evm",
      address: walletIdentity.address,
      publicKey: "",
    };
    const signature = new Uint8Array(65);
    signature[64] = 1;
    state.signMessage.mockResolvedValue(signature);

    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (url === "/api/intents/approve") {
          return new Response(
            JSON.stringify({
              transactionId: "3e6f2b9a-8f11-4d5c-9a1b-2c3d4e5f6a7b",
              depositAddress: "0xdeposit",
              intent: { standard: "erc191", payload: "wallet-payload" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        expect(JSON.parse(String(init?.body))).toMatchObject({
          signedData: {
            standard: "erc191",
            payload: "wallet-payload",
          },
        });
        return new Response(JSON.stringify({ intentHash: "hash" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    render(swapMessage("swap", "account"));
    const card = lastCard();
    expect(card.runApproval).toBeTypeOf("function");
    expect(card.action).toBe("swap");

    const result = await (card.runApproval as SentenceApproval)({
      onPhase: () => {},
    });

    expect(result).toMatchObject({ ok: true });
    expect(urls).toEqual(["/api/intents/approve", "/api/intents/submit"]);
    expect(urls).not.toContain("/api/approve");
    expect(state.signMessage).toHaveBeenCalledWith(
      new TextEncoder().encode("wallet-payload"),
    );
  });

  it("disables a wallet chain card whose quote has no stored row", () => {
    state.identity = walletIdentity;
    const preview = swapMessage("swap", "wallet");
    const quote = preview.parts[0] as unknown as {
      output: Record<string, unknown>;
    };
    quote.output = { ...quote.output, quoteId: null };

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={preview} status="ready" interactive />,
    );
    const card = lastCard();

    expect(card.runApproval).toBeUndefined();
    expect(card.disabled).toBe(true);
    expect(card.blocked).toBe("quote");
    expect(card.amountIn).toBe("—");
    expect(card.amountOut).toBe("—");
    expect(
      (card.swapInput as { quoteId?: string } | undefined)?.quoteId,
    ).toBeUndefined();
  });

  it("disables a passkey account trade whose quote has no stored row", () => {
    state.identity = passkeyIdentity;
    const preview = swapMessage("swap", "account");
    const quote = preview.parts[0] as unknown as {
      output: Record<string, unknown>;
    };
    quote.output = { ...quote.output, quoteId: null };

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={preview} status="ready" interactive />,
    );
    const card = lastCard();

    // The session still names the account route, but there is no row to
    // approve and no quote to submit.
    expect(card.runApproval).toBeTypeOf("function");
    expect(card.disabled).toBe(true);
    expect(card.blocked).toBe("quote");
    expect(card.amountIn).toBe("—");
  });

  it("disables the wallet chain card when the session cannot sign", () => {
    state.identity = walletIdentity;
    state.canSign = false;

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse
        message={swapMessage("swap", "wallet")}
        status="ready"
        interactive
      />,
    );

    expect(lastCard().disabled).toBe(true);
    expect(lastCard().blocked).toBe("sign-in");
    expect(lastCard().onSignIn).toBeTypeOf("function");
  });

  it("disables the wallet account card when the session cannot sign", () => {
    state.identity = walletIdentity;
    state.canSign = false;

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse
        message={swapMessage("swap", "account")}
        status="ready"
        interactive
      />,
    );

    expect(lastCard().disabled).toBe(true);
    expect(lastCard().blocked).toBe("sign-in");
    expect(lastCard().onSignIn).toBeTypeOf("function");
  });

  it("disables a withdrawal card when the session cannot sign", () => {
    state.identity = walletIdentity;
    state.canSign = false;

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={withdrawalMessage()} status="ready" interactive />,
    );

    expect(lastCard().disabled).toBe(true);
  });

  it("disables a deposit card when the session cannot sign", () => {
    state.identity = walletIdentity;
    state.canSign = false;

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={depositMessage()} status="ready" interactive />,
    );

    expect(lastCard().disabled).toBe(true);
  });

  it("enables a signable wallet chain card with a matching quote", () => {
    state.identity = walletIdentity;
    state.canSign = true;

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse
        message={swapMessage("swap", "wallet")}
        status="ready"
        interactive
      />,
    );

    const card = lastCard();
    expect(card.runApproval).toBeUndefined();
    expect(card.swapInput).toMatchObject({ quoteId: QUOTE_ID });
    expect(card.disabled).toBe(false);
  });

  it("keeps the wallet branch for a wallet deposit proposal", () => {
    state.identity = walletIdentity;
    const html = render(swapMessage("deposit"));

    expect(html).toContain("sentence-deposit-card");
    const card = lastCard();
    expect(card.action).toBe("deposit");
    expect(card.runApproval).toBeUndefined();
    expect(card.swapInput).toMatchObject({ amount: "25000000" });
    expect(card.requestedAt).toBe("2026-11-02T12:00:00.000Z");
    expect(card.minAmountOutRaw).toBe("23200000000000000000000000");
  });

  it("keeps the wallet branch for a wallet withdrawal proposal", () => {
    state.identity = walletIdentity;
    const html = render(swapMessage("withdraw"));

    expect(html).toContain("sentence-withdraw-card");
    const card = lastCard();
    expect(card.action).toBe("withdraw");
    expect(card.runApproval).toBeUndefined();
    expect(card.swapInput).toMatchObject({ amount: "25000000" });
    expect(card.requestedAt).toBe("2026-11-02T12:00:00.000Z");
  });

  it("keeps the wallet branch while signed out", () => {
    state.identity = null;
    const html = render(swapMessage());

    expect(html).toContain("sentence-swap-card");
    expect(lastCard().runApproval).toBeUndefined();
  });

  it("renders the sentence card for a passkey deposit", () => {
    state.identity = passkeyIdentity;
    const html = render(depositMessage());

    expect(html).toContain("sentence-deposit-card");
    const card = lastCard();
    expect(card.action).toBe("deposit");
    expect(card.runApproval).toBeTypeOf("function");
    // No wallet funds a passkey deposit.
    expect(card.sender).toBeNull();
    expect(card.approveLabel).toBe("Start");
    expect(card.recipient).toBe(RECIPIENT);
  });

  it("keeps the deposit on the sentence card after the tool output lands", () => {
    state.identity = passkeyIdentity;
    const html = render(depositMessage("output-available"));

    expect(html).toContain("sentence-deposit-card");
    expect(lastCard().state).toBe("waiting");
  });

  it("puts a wallet deposit on the deposit route, not the wallet swap route", () => {
    state.identity = walletIdentity;
    const html = render(depositMessage());

    expect(html).toContain("sentence-deposit-card");
    const card = lastCard();
    expect(card.action).toBe("deposit");
    expect(card.runApproval).toBeTypeOf("function");
    // The funds arrive from an exchange, so there is no wallet source clause.
    expect(card.sender).toBeNull();
    // A deposit never carries a swap input; `/api/approve` cannot mint one.
    expect(card.swapInput).toBeUndefined();
  });

  it("marks only a card whose record has not been read as pending", () => {
    state.identity = passkeyIdentity;
    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse
        message={depositMessage("output-available")}
        status="ready"
        decisions={{}}
        pendingApprovalIds={new Set(["aitxt-deposit-1"])}
      />,
    );
    expect(lastCard().decisionPending).toBe(true);

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse
        message={depositMessage("output-available")}
        status="ready"
        decisions={{}}
        pendingApprovalIds={new Set()}
      />,
    );
    expect(lastCard().decisionPending).toBe(false);
  });

  it("hands a reloaded deposit its record metadata and expiry", () => {    state.identity = passkeyIdentity;
    renderWithSettlements(depositMessage("output-available"), {
      "aitxt-deposit-1": {
        state: "pending",
        transactionId: "tx-deposit-1",
        depositAddress: DEPOSIT,
        explorerUrls: ["https://explorer.example/tx/1"],
        statusCheckedAt: "2026-11-02T12:00:00.000Z",
        deposit: {
          address: DEPOSIT,
          expiresAt: "2099-01-01T00:00:00.000Z",
          amountInRaw: "1000000",
          tokenContract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          chainId: 42161,
          chainName: "Arbitrum One",
          chainSlug: "arb",
          decimals: 6,
        },
      },
    });

    const card = lastCard();
    expect(card.state).toBe("waiting");
    expect(card.approveLabel).toBe("Start");
    expect(card.depositAddress).toBe(DEPOSIT);
    expect(card.expiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(card.recordCheckedAt).toBeUndefined();
    expect(card.depositMeta).toMatchObject({
      amountInRaw: "1000000",
      chainId: 42161,
      chainSlug: "arb",
    });
    expect(card.initialExplorerUrls).toEqual([
      "https://explorer.example/tx/1",
    ]);
  });

  it("paints a registered funding hash as processing, not waiting", () => {
    state.identity = passkeyIdentity;
    renderWithSettlements(depositMessage("output-available"), {
      "aitxt-deposit-1": {
        state: "submitted",
        transactionId: "tx-deposit-1",
        depositAddress: DEPOSIT,
        depositTxHash: "0xfunded",
        deposit: {
          address: DEPOSIT,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
    });

    // The row is written at mint. A transfer that was broadcast a moment ago
    // must not put the address back in front of the reader.
    expect(lastCard().state).toBe("processing");
  });

  it("keeps a timed-out workflow waiting while the deposit quote is valid", () => {
    state.identity = passkeyIdentity;
    renderWithSettlements(depositMessage("output-available"), {
      "aitxt-deposit-1": {
        state: "needs_reconciliation",
        transactionId: "tx-deposit-1",
        depositAddress: DEPOSIT,
        deposit: {
          address: DEPOSIT,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
    });

    // The sixty-minute poll window is not a settlement; the card owns the
    // address deadline, and it is still in the future here.
    expect(lastCard().state).toBe("waiting");
  });

  it("paints a short deposit as incomplete, not failed", () => {
    state.identity = passkeyIdentity;
    renderWithSettlements(depositMessage("output-available"), {
      "aitxt-deposit-1": {
        state: "incomplete_deposit",
        transactionId: "tx-deposit-1",
        depositAddress: DEPOSIT,
        deposit: { address: DEPOSIT, expiresAt: "2099-01-01T00:00:00.000Z" },
      },
    });

    expect(lastCard().state).toBe("incomplete");
  });

  it("renders the sentence card for a passkey withdrawal", () => {
    state.identity = passkeyIdentity;
    const html = render(withdrawalMessage());

    expect(html).toContain("sentence-withdraw-card");
    const card = lastCard();
    expect(card.action).toBe("withdraw");
    expect(card.runApproval).toBeTypeOf("function");
    // The stored quote's destination, never the model's string.
    expect(card.recipient).toBe(DESTINATION);
    expect(card.fee).toBe("0.0106");
    expect(card.minAmountOut).toBe("0.484506");
    expect(card.expiresAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("renders the same sentence card for a wallet withdrawal", () => {
    state.identity = walletIdentity;
    const html = render(withdrawalMessage());

    expect(html).toContain("sentence-withdraw-card");
    const card = lastCard();
    expect(card.action).toBe("withdraw");
    // A withdrawal is a signed intent in both session kinds; the signer
    // inside the adapter follows the session.
    expect(card.runApproval).toBeTypeOf("function");
    expect(card.recipient).toBe(DESTINATION);
    expect(card.destinationChain).toBe("Arbitrum One");
  });

  it("disables a withdrawal whose stored quote has no destination", () => {
    state.identity = passkeyIdentity;
    const message = withdrawalMessage();
    const quote = message.parts[0] as unknown as {
      output: Record<string, unknown>;
    };
    quote.output = { ...quote.output };
    delete quote.output.destination;

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={message} status="ready" interactive />,
    );
    const card = lastCard();

    expect(card.runApproval).toBeTypeOf("function");
    expect(card.recipient).toBe("");
    expect(card.disabled).toBe(true);
  });

  it("rejoins the transaction a settled withdrawal already has", () => {
    state.identity = passkeyIdentity;
    renderWithSettlements(withdrawalMessage(), {
      "aitxt-withdraw-1": {
        state: "settled",
        transactionId: "tx-withdraw-1",
        explorerUrls: ["https://arbiscan.io/tx/0xabc"],
        amountOut: "1.9894",
      },
    });

    // A reopened card has no poll of its own: the record's links and amount
    // are the only thing that can show what it already settled.
    const card = lastCard();
    expect(card.state).toBe("settled");
    expect(card.initialExplorerUrls).toEqual([
      "https://arbiscan.io/tx/0xabc",
    ]);
    expect(card.initialReceived).toBe("1.9894");
  });

  it("marks only the live turn's cards as active", () => {
    state.identity = passkeyIdentity;
    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse
        message={swapMessage("swap", "account")}
        status="ready"
        interactive
        superseded={false}
      />,
    );
    expect(lastCard().active).toBe(true);

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse
        message={swapMessage("swap", "account")}
        status="ready"
        interactive
        superseded
      />,
    );
    expect(lastCard().active).toBe(false);

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={swapMessage("swap", "account")} status="ready" />,
    );
    expect(lastCard().active).toBe(false);
  });

  it("marks deposit and withdrawal cards active on the live turn only", () => {
    state.identity = passkeyIdentity;
    for (const message of [depositMessage(), withdrawalMessage()]) {
      ReactDOMServer.renderToStaticMarkup(
        <LiveResponse message={message} status="ready" interactive superseded={false} />,
      );
      expect(lastCard().active).toBe(true);

      ReactDOMServer.renderToStaticMarkup(
        <LiveResponse message={message} status="ready" interactive superseded />,
      );
      expect(lastCard().active).toBe(false);
    }
  });

  it("paints an expired deposit snapshot as expired", () => {
    state.identity = passkeyIdentity;
    renderWithSettlements(depositMessage("output-available"), {
      "aitxt-deposit-1": {
        state: "expired",
        transactionId: "tx-deposit-1",
        depositAddress: DEPOSIT,
        deposit: { address: DEPOSIT, expiresAt: "2020-01-01T00:00:00.000Z" },
      },
    });

    expect(lastCard().state).toBe("expired");
  });

  it("blocks a card priced for another account instead of offering a signer", () => {
    state.identity = walletIdentity;
    const message = swapMessage("swap", "account");
    const quote = message.parts[0] as unknown as {
      output: Record<string, unknown>;
    };
    quote.output.accountKind = "passkey";
    quote.output.intentsAccountId = RECIPIENT;

    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse message={message} status="ready" interactive />,
    );

    expect(lastCard().blocked).toBe("account");
    expect(lastCard().disabled).toBe(true);
  });

  it("keeps the earn label and vault metadata on an account quote", () => {
    state.identity = walletIdentity;
    const message = swapMessage("earn", "account");
    const quote = message.parts[0] as unknown as {
      output: Record<string, unknown>;
    };
    quote.output.earn = {
      vaultId: "gtusdcp",
      name: "USDC Prime",
      protocol: "Morpho",
      apy: 4.50508,
    };

    render(message);

    const card = state.cards.find((entry) => entry.action === "earn");
    expect(card).toBeTruthy();
    expect(card?.earn).toMatchObject({
      name: "USDC Prime",
      protocol: "Morpho",
      apy: 4.50508,
    });
  });

  it("renders a limit order proposal as a limit card", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <LiveResponse
        message={limitOrderMessage()}
        status="ready"
        interactive
      />,
    );

    expect(html).toContain("sentence-");
    const card = state.cards.find((entry) => entry.action === "limit");
    expect(card).toBeTruthy();
    expect(card?.limit).toMatchObject({
      side: "SELL",
      price: "5",
      total: "5",
      funding: "account",
    });
    expect(typeof card?.runApproval).toBe("function");
  });

  it("hands a live deposit card the composer for a fresh address", () => {
    state.identity = passkeyIdentity;
    const onPrompt = vi.fn();
    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse
        message={depositMessage("output-available")}
        status="ready"
        interactive
        onPrompt={onPrompt}
      />,
    );
    expect(lastCard().onPrompt).toBe(onPrompt);

    // A read-only transcript has nowhere to send the sentence.
    ReactDOMServer.renderToStaticMarkup(
      <LiveResponse
        message={depositMessage("output-available")}
        status="ready"
        onPrompt={onPrompt}
      />,
    );
    expect(lastCard().onPrompt).toBeUndefined();
  });
});
