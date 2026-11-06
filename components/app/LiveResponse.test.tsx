import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import type { UIMessage } from "ai";
import type { SessionIdentity } from "@/lib/auth/session-identity";

const state = vi.hoisted(() => ({
  identity: null as SessionIdentity | null,
  /** Every money card the live response renders, with the props it passed. */
  cards: [] as Array<Record<string, unknown>>,
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
  useWallet: () => ({ account: null }),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ identity: state.identity }),
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

/** The get_quote output every proposal in these turns was priced from. */
function quotePart() {
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
    },
  };
}

function swapMessage(action = "swap"): UIMessage {
  return {
    id: "msg-1",
    role: "assistant",
    parts: [
      quotePart(),
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

beforeEach(() => {
  state.identity = null;
  state.cards = [];
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

describe("LiveResponse money card", () => {
  it("renders the sentence card for a passkey swap, with the Intents adapter", () => {
    state.identity = passkeyIdentity;
    const html = render(swapMessage());

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

    render(swapMessage());
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

  it("keeps the wallet branch for a wallet swap", () => {
    state.identity = walletIdentity;
    const html = render(swapMessage());

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

  it("hands a reloaded deposit its record metadata and expiry", () => {
    state.identity = passkeyIdentity;
    renderWithSettlements(depositMessage("output-available"), {
      "aitxt-deposit-1": {
        state: "pending",
        transactionId: "tx-deposit-1",
        depositAddress: DEPOSIT,
        explorerUrls: ["https://explorer.example/tx/1"],
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
    expect(card.depositMeta).toMatchObject({
      amountInRaw: "1000000",
      chainId: 42161,
      chainSlug: "arb",
    });
    expect(card.initialExplorerUrls).toEqual([
      "https://explorer.example/tx/1",
    ]);
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
});
