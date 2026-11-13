import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  getTransactionMock,
  updateTransactionRefsMock,
  setTransactionStateMock,
  addEventMock,
  setTransactionRunIdMock,
  submitIntentMock,
  verifyIntentMock,
  getWebAuthnConfigMock,
  getSupabaseAdminMock,
  recordToolApprovalMock,
  startMock,
  swapLifecycleStub,
  limitOrderLifecycleStub,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  getTransactionMock: vi.fn(),
  updateTransactionRefsMock: vi.fn(),
  setTransactionStateMock: vi.fn(),
  addEventMock: vi.fn(),
  setTransactionRunIdMock: vi.fn(),
  submitIntentMock: vi.fn(),
  verifyIntentMock: vi.fn(),
  getWebAuthnConfigMock: vi.fn(),
  getSupabaseAdminMock: vi.fn(),
  recordToolApprovalMock: vi.fn(),
  startMock: vi.fn(),
  swapLifecycleStub: vi.fn(),
  limitOrderLifecycleStub: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: () => ({ limited: false, retryAfterMs: 0 }),
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/auth/webauthn-config", () => ({
  getWebAuthnConfig: getWebAuthnConfigMock,
}));

vi.mock("@/lib/db/client", () => ({
  getSupabaseAdmin: getSupabaseAdminMock,
}));

vi.mock("@/lib/db/transactions", () => ({
  getTransaction: getTransactionMock,
  updateTransactionRefs: updateTransactionRefsMock,
  setTransactionState: setTransactionStateMock,
  addEvent: addEventMock,
  setTransactionRunId: setTransactionRunIdMock,
}));

vi.mock("@/lib/db/tool-approvals", () => ({
  recordToolApproval: recordToolApprovalMock,
  TOOL_APPROVAL_NAMES: [
    "prepare_swap",
    "prepare_deposit",
    "prepare_withdrawal",
    "prepare_limit_order",
  ],
}));

vi.mock("@/lib/intents/service", () => ({
  submitIntent: submitIntentMock,
}));

vi.mock("@/lib/intents/verify-intent", () => ({
  verifyIntent: verifyIntentMock,
  intentHashForPayload: (payload: string) => `hash:${payload}`,
}));

vi.mock("workflow/api", () => ({ start: startMock }));
vi.mock("@/workflows/swap-lifecycle", () => ({
  swapLifecycle: swapLifecycleStub,
}));
vi.mock("@/workflows/limit-order-lifecycle", () => ({
  limitOrderLifecycle: limitOrderLifecycleStub,
}));

import { POST } from "./route";

const TRANSACTION_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const WALLET_ADDRESS = "0x3259abcdef12345678901073abcdef1234567890";
const DEPOSIT =
  "e0240dfbadb1bd03ec5f5e1c93899f59a80f1307354d534bd10563d566897a43";
const ASSET_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e3613a1";
const PAYLOAD = '{"verifying_contract":"intents.far","signer_id":"0x1"}';
const ORDER_ID = "order-abc123";
const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const DEADLINE = new Date(Date.now() + 72 * 60 * 60_000).toISOString();

const walletSession = {
  userId: "user-1",
  accountKind: "wallet" as const,
  walletId: "wallet-1",
  passkeyId: null,
  intentsAccountId: ACCOUNT,
  chain: "evm" as const,
  address: WALLET_ADDRESS,
  createdAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
};

const SIGNED_DATA = {
  standard: "erc191",
  payload: PAYLOAD,
  signature: "0xsignature",
};

const intentRefs = {
  mode: "confidential-intents",
  standard: "erc191",
  signerId: ACCOUNT,
  intentPayload: PAYLOAD,
  intentDepositAddress: DEPOSIT,
  amountInRaw: "500000",
  deadline: DEADLINE,
  assetId: ASSET_ID,
  toolApprovalId: null,
  conversationId: null,
};

function tx(refs: Record<string, unknown>) {
  return {
    tx: {
      id: TRANSACTION_ID,
      user_id: "user-1",
      approval_id: "approval-1",
      conversation_id: null,
      state: "awaiting_approval",
      deposit_address: DEPOSIT,
      workflow_run_id: null,
      recipient: ACCOUNT,
      refund_to: ACCOUNT,
      origin_asset: ASSET_ID,
      destination_asset: "nep141:wrap.near",
      amount_in: "0.5",
      expected_out: "100",
      refs,
      outcome: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    events: [],
  };
}

function limitOrderRefs(overrides: Record<string, unknown> = {}) {
  return {
    ...intentRefs,
    kind: "limit_order",
    orderId: ORDER_ID,
    toolApprovalId: "aitxt-1",
    toolName: "prepare_limit_order",
    dryQuoteId: QUOTE_ID,
    side: "SELL",
    baseAsset: ASSET_ID,
    quoteAsset: "nep141:wrap.near",
    quantity: "500000",
    price: "5",
    depositType: "ORIGIN_CHAIN",
    swapView: {
      swapType: "EXACT_INPUT",
      originAsset: ASSET_ID,
      destinationAsset: "nep141:wrap.near",
      amountIn: "500000",
      minAmountOut: "2500000000000000000000000",
    },
    fillStatus: "AWAITING_DEPOSIT",
    payoutStatus: "NOT_STARTED",
    isPayoutStatusFinal: false,
    ...overrides,
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/intents/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue(walletSession);
  startMock.mockResolvedValue({ runId: "run-1" });
  verifyIntentMock.mockResolvedValue({ ok: true, standard: "erc191" });
  submitIntentMock.mockResolvedValue({
    intentHash: "server-hash",
    correlationId: "corr",
  });
  recordToolApprovalMock.mockResolvedValue(null);
});

describe("/api/intents/submit workflow choice", () => {
  it("starts the limit-order lifecycle for a limit-order record", async () => {
    getTransactionMock.mockResolvedValue({ ...tx(limitOrderRefs()) });

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      transactionId: TRANSACTION_ID,
      intentHash: "server-hash",
      runId: "run-1",
    });
    expect(startMock).toHaveBeenCalledWith(limitOrderLifecycleStub, [
      { transactionId: TRANSACTION_ID, orderId: ORDER_ID },
    ]);
    expect(startMock).not.toHaveBeenCalledWith(
      swapLifecycleStub,
      expect.anything(),
    );
    expect(setTransactionRunIdMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      "run-1",
    );
    expect(recordToolApprovalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolApprovalId: "aitxt-1",
        toolName: "prepare_limit_order",
        decision: "approved",
        quoteId: QUOTE_ID,
      }),
    );
    // The signed transfer is still verified against the stored order deposit
    // address, input asset, and input amount.
    expect(verifyIntentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        depositAddress: DEPOSIT,
        amountIn: "500000",
        assetId: ASSET_ID,
        mode: "confidential",
      }),
    );
  });

  it("keeps the swap lifecycle for a swap record", async () => {
    getTransactionMock.mockResolvedValue({ ...tx({ ...intentRefs }) });

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(200);
    expect(startMock).toHaveBeenCalledWith(swapLifecycleStub, [
      {
        transactionId: TRANSACTION_ID,
        depositAddress: DEPOSIT,
        expectedOut: "100",
        mode: "confidential-intents",
      },
    ]);
    expect(startMock).not.toHaveBeenCalledWith(
      limitOrderLifecycleStub,
      expect.anything(),
    );
  });

  it("refuses a limit-order record with no order id", async () => {
    getTransactionMock.mockResolvedValue({
      ...tx(limitOrderRefs({ orderId: undefined })),
    });

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "An error occurred." });
    expect(verifyIntentMock).not.toHaveBeenCalled();
    expect(submitIntentMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });
});
