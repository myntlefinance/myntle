import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeEvmAddress } from "@/lib/intents/destination";

const {
  requireSessionMock,
  getQuoteMock,
  createApprovalMock,
  createTransactionMock,
  setTransactionRunIdMock,
  setTransactionStateMock,
  updateTransactionRefsMock,
  addEventMock,
  listLimitOrderTransactionsMock,
  getToolApprovalMock,
  recordToolApprovalMock,
  conversationIdForUserMock,
  generateIntentMock,
  getAssetsMock,
  createLimitOrderMock,
  startMock,
  limitOrderLifecycleStub,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  getQuoteMock: vi.fn(),
  createApprovalMock: vi.fn(),
  createTransactionMock: vi.fn(),
  setTransactionRunIdMock: vi.fn(),
  setTransactionStateMock: vi.fn(),
  updateTransactionRefsMock: vi.fn(),
  addEventMock: vi.fn(),
  listLimitOrderTransactionsMock: vi.fn(),
  getToolApprovalMock: vi.fn(),
  recordToolApprovalMock: vi.fn(),
  conversationIdForUserMock: vi.fn(),
  generateIntentMock: vi.fn(),
  getAssetsMock: vi.fn(),
  createLimitOrderMock: vi.fn(),
  startMock: vi.fn(),
  limitOrderLifecycleStub: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: () => ({ limited: false, retryAfterMs: 0 }),
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/intents/service", () => ({
  generateIntent: generateIntentMock,
  getAssets: getAssetsMock,
  // The real orders module imports the shared header helper. It is never
  // reached because createLimitOrder is mocked, but the export must exist.
  oneClickHeaders: () => ({ "Content-Type": "application/json" }),
}));

vi.mock("@/lib/intents/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intents/orders")>();
  return { ...actual, createLimitOrder: createLimitOrderMock };
});

vi.mock("@/lib/db/conversations", () => ({
  conversationIdForUser: conversationIdForUserMock,
}));

vi.mock("@/lib/db/tool-approvals", () => ({
  getToolApproval: getToolApprovalMock,
  recordToolApproval: recordToolApprovalMock,
}));

vi.mock("@/lib/db/transactions", () => ({
  getQuote: getQuoteMock,
  createApproval: createApprovalMock,
  createTransaction: createTransactionMock,
  setTransactionRunId: setTransactionRunIdMock,
  setTransactionState: setTransactionStateMock,
  updateTransactionRefs: updateTransactionRefsMock,
  addEvent: addEventMock,
  listLimitOrderTransactions: listLimitOrderTransactionsMock,
}));

vi.mock("workflow/api", () => ({ start: startMock }));
vi.mock("@/workflows/limit-order-lifecycle", () => ({
  limitOrderLifecycle: limitOrderLifecycleStub,
}));

import { POST } from "./route";

const USER = "user-1";
const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "0x9999999999999999999999999999999999999999";
const TX = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const WALLET = "0x32596df10ff2ac5acde8406e6adcc8d047921073";
const BASE =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const QUOTE =
  "nep141:eth-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.omft.near";
const DEPOSIT = "0x2527d02599ba641c19fea793cd0f167589a0f10d";
const ORDER_ID = "order-abc123";
const FUTURE = new Date(Date.now() + 15 * 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();
const ORDER_DEADLINE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
const PAYLOAD =
  '{"verifying_contract":"intents.near","signer_id":"0x1","deadline":"2026-11-20T11:28:18.215Z"}';

const walletSession = {
  userId: USER,
  accountKind: "wallet" as const,
  walletId: "wallet-1",
  passkeyId: null,
  intentsAccountId: ACCOUNT,
  chain: "evm" as const,
  address: WALLET,
  createdAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
};

const passkeySession = {
  ...walletSession,
  accountKind: "passkey" as const,
  walletId: null,
  passkeyId: "passkey-1",
  chain: "near" as const,
  address: ACCOUNT,
};

const CATALOGUE = [
  {
    assetId: BASE,
    symbol: "USDC",
    decimals: 6,
    chain: "base",
    price: 1,
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  {
    assetId: QUOTE,
    symbol: "WETH",
    decimals: 18,
    chain: "eth",
    price: 3000,
    contractAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  },
];

function quoteRow(
  overrides: {
    request?: Record<string, unknown>;
    response?: Record<string, unknown>;
    expiresAt?: string;
  } = {},
) {
  return {
    id: QUOTE_ID,
    user_id: USER,
    request: {
      kind: "limit_order",
      baseAssetId: BASE,
      quoteAssetId: QUOTE,
      side: "SELL",
      quantity: "1000000",
      price: "0.5",
      funding: "wallet",
      accountKind: "wallet",
      intentsAccountId: ACCOUNT,
      ...overrides.request,
    },
    response: {
      kind: "limit_order",
      inputAssetId: BASE,
      outputAssetId: QUOTE,
      inputAmount: "1000000",
      outputAmount: "500000000000000000",
      baseSymbol: "USDC",
      quoteSymbol: "WETH",
      quantityFormatted: "1",
      totalFormatted: "0.5",
      price: "0.5",
      deadline: FUTURE,
      ...overrides.response,
    },
    expires_at: overrides.expiresAt ?? FUTURE,
  };
}

function orderView(overrides: Record<string, unknown> = {}) {
  return {
    orderId: ORDER_ID,
    side: "SELL",
    baseAsset: BASE,
    quoteAsset: QUOTE,
    quantity: "1000000",
    price: "0.5",
    depositAddress: DEPOSIT,
    depositMemo: null,
    depositType: "ORIGIN_CHAIN",
    swapView: {
      swapType: "EXACT_INPUT",
      originAsset: BASE,
      destinationAsset: QUOTE,
      amountIn: "1000000",
      minAmountOut: "500000000000000000",
    },
    fillStatus: "AWAITING_DEPOSIT",
    payoutStatus: "NOT_STARTED",
    isPayoutStatusFinal: false,
    partialFills: [],
    recipient: normalizeEvmAddress(WALLET),
    recipientType: "DESTINATION_CHAIN",
    refundTo: normalizeEvmAddress(WALLET),
    refundType: "ORIGIN_CHAIN",
    confidentiality: "basic",
    deadline: ORDER_DEADLINE,
    ...overrides,
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue(walletSession);
  getQuoteMock.mockResolvedValue(quoteRow());
  getAssetsMock.mockResolvedValue(CATALOGUE);
  createLimitOrderMock.mockResolvedValue(orderView());
  createApprovalMock.mockResolvedValue("approval-1");
  createTransactionMock.mockResolvedValue({ id: TX, expected_out: "0.5" });
  startMock.mockResolvedValue({ runId: "run-1" });
  generateIntentMock.mockResolvedValue({
    standard: "webauthn",
    payload: PAYLOAD,
  });
  getToolApprovalMock.mockResolvedValue(null);
});

describe("POST /api/orders", () => {
  it("rejects a quote priced for another account", async () => {
    getQuoteMock.mockResolvedValue(
      quoteRow({ request: { intentsAccountId: OTHER_ACCOUNT } }),
    );

    const res = await POST(request({ quoteId: QUOTE_ID }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "stale" });
    expect(createLimitOrderMock).not.toHaveBeenCalled();
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects an expired quote before creating anything", async () => {
    getQuoteMock.mockResolvedValue(quoteRow({ expiresAt: PAST }));

    const res = await POST(request({ quoteId: QUOTE_ID }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "expired" });
    expect(createLimitOrderMock).not.toHaveBeenCalled();
  });

  it("creates a wallet-funded order with ORIGIN_CHAIN fields and starts its workflow", async () => {
    const res = await POST(request({ quoteId: QUOTE_ID }));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      transactionId: TX,
      runId: "run-1",
    });

    const walletRecipient = normalizeEvmAddress(WALLET);
    expect(createLimitOrderMock).toHaveBeenCalledWith({
      baseAsset: BASE,
      quoteAsset: QUOTE,
      side: "SELL",
      quantity: "1000000",
      price: "0.5",
      depositType: "ORIGIN_CHAIN",
      recipient: walletRecipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: walletRecipient,
      refundType: "ORIGIN_CHAIN",
      confidentiality: "basic",
    });

    expect(createTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        originAsset: BASE,
        destinationAsset: QUOTE,
        amountIn: "1",
        expectedOut: "0.5",
        depositAddress: DEPOSIT,
        state: "submitted",
        refs: expect.objectContaining({
          kind: "limit_order",
          orderId: ORDER_ID,
          mode: "confidential-intents",
          standard: "erc191",
          signerId: ACCOUNT,
          intentDepositAddress: DEPOSIT,
          amountInRaw: "1000000",
          assetId: BASE,
          side: "SELL",
          baseAsset: BASE,
          quoteAsset: QUOTE,
          quantity: "1000000",
          price: "0.5",
          depositType: "ORIGIN_CHAIN",
          fillStatus: "AWAITING_DEPOSIT",
          payoutStatus: "NOT_STARTED",
          isPayoutStatusFinal: false,
        }),
      }),
    );

    expect(startMock).toHaveBeenCalledWith(limitOrderLifecycleStub, [
      { transactionId: TX, orderId: ORDER_ID },
    ]);
    expect(setTransactionRunIdMock).toHaveBeenCalledWith(TX, "run-1");
    expect(generateIntentMock).not.toHaveBeenCalled();

    expect(body.deposit).toMatchObject({
      address: DEPOSIT,
      amountInRaw: "1000000",
      chainId: 8453,
      chainName: "Base",
      chainSlug: "base",
      decimals: 6,
      symbol: "USDC",
    });
  });

  it("creates an account-funded order awaiting the signed intent", async () => {
    requireSessionMock.mockResolvedValue(passkeySession);
    getQuoteMock.mockResolvedValue(
      quoteRow({
        request: {
          funding: "account",
          accountKind: "passkey",
          intentsAccountId: ACCOUNT,
        },
      }),
    );
    createLimitOrderMock.mockResolvedValue(
      orderView({
        depositType: "CONFIDENTIAL_INTENTS",
        recipient: ACCOUNT,
        recipientType: "CONFIDENTIAL_INTENTS",
        refundTo: ACCOUNT,
        refundType: "CONFIDENTIAL_INTENTS",
      }),
    );

    const res = await POST(request({ quoteId: QUOTE_ID }));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      transactionId: TX,
      intent: { standard: "webauthn", payload: PAYLOAD },
    });
    expect(body).not.toHaveProperty("runId");

    expect(createLimitOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        depositType: "CONFIDENTIAL_INTENTS",
        recipient: ACCOUNT,
        recipientType: "CONFIDENTIAL_INTENTS",
        refundTo: ACCOUNT,
        refundType: "CONFIDENTIAL_INTENTS",
      }),
    );
    expect(createTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "awaiting_approval",
        refs: expect.objectContaining({
          kind: "limit_order",
          orderId: ORDER_ID,
          depositType: "CONFIDENTIAL_INTENTS",
          standard: "webauthn",
        }),
      }),
    );
    expect(generateIntentMock).toHaveBeenCalledWith({
      type: "swap_transfer",
      standard: "webauthn",
      signerId: ACCOUNT,
      depositAddress: DEPOSIT,
    });
    // The payload's own deadline is the one the verifier will compare.
    expect(updateTransactionRefsMock).toHaveBeenCalledWith(TX, {
      intentPayload: PAYLOAD,
      deadline: "2026-11-20T11:28:18.215Z",
    });
    expect(startMock).not.toHaveBeenCalled();
  });

  it("refuses wallet funding for a passkey session", async () => {
    requireSessionMock.mockResolvedValue(passkeySession);
    getQuoteMock.mockResolvedValue(
      quoteRow({
        request: { funding: "wallet", accountKind: "passkey" },
      }),
    );

    const res = await POST(request({ quoteId: QUOTE_ID }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "funding" });
    expect(createLimitOrderMock).not.toHaveBeenCalled();
  });

  it("does not create an order after a refusal", async () => {
    getToolApprovalMock.mockResolvedValue({ decision: "denied" });

    const res = await POST(
      request({ quoteId: QUOTE_ID, approvalId: "aitxt-1" }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "denied" });
    expect(createLimitOrderMock).not.toHaveBeenCalled();
  });
});
