import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  getQuoteMock,
  createExecutionQuoteMock,
  generateIntentMock,
  createQuoteMock,
  createApprovalMock,
  createTransactionMock,
  updateTransactionRefsMock,
  setTransactionStateMock,
  addEventMock,
  setTransactionRunIdMock,
  startMock,
  swapLifecycleStub,
  conversationIdForUserMock,
  getToolApprovalMock,
  recordToolApprovalMock,
  resolveNameMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  getQuoteMock: vi.fn(),
  createExecutionQuoteMock: vi.fn(),
  generateIntentMock: vi.fn(),
  createQuoteMock: vi.fn(),
  createApprovalMock: vi.fn(),
  createTransactionMock: vi.fn(),
  updateTransactionRefsMock: vi.fn(),
  setTransactionStateMock: vi.fn(),
  addEventMock: vi.fn(),
  setTransactionRunIdMock: vi.fn(),
  startMock: vi.fn(),
  swapLifecycleStub: vi.fn(),
  conversationIdForUserMock: vi.fn(),
  getToolApprovalMock: vi.fn(),
  recordToolApprovalMock: vi.fn(),
  resolveNameMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: () => ({ limited: false, retryAfterMs: 0 }),
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/intents/service", () => ({
  createExecutionQuote: createExecutionQuoteMock,
  generateIntent: generateIntentMock,
}));

vi.mock("@/lib/db/transactions", () => ({
  getQuote: getQuoteMock,
  createQuote: createQuoteMock,
  createApproval: createApprovalMock,
  createTransaction: createTransactionMock,
  updateTransactionRefs: updateTransactionRefsMock,
  setTransactionState: setTransactionStateMock,
  addEvent: addEventMock,
  setTransactionRunId: setTransactionRunIdMock,
}));

vi.mock("@/lib/db/conversations", () => ({
  conversationIdForUser: conversationIdForUserMock,
}));

vi.mock("@/lib/db/tool-approvals", () => ({
  TOOL_APPROVAL_NAMES: [
    "prepare_swap",
    "prepare_deposit",
    "prepare_withdrawal",
  ],
  getToolApproval: getToolApprovalMock,
  recordToolApproval: recordToolApprovalMock,
}));

vi.mock("workflow/api", () => ({ start: startMock }));
vi.mock("@/workflows/swap-lifecycle", () => ({
  swapLifecycle: swapLifecycleStub,
}));

vi.mock("@/lib/adapters/registry", () => ({
  getNameResolverPort: () => ({ resolveName: resolveNameMock }),
}));

import { POST } from "./route";
import { nameError } from "@/lib/ports/names";

const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const TRANSACTION_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "0x7edf07ede58238026db3f90fc8032633b69b8de5";
const OTHER_ACCOUNT = "0x3602b546589a8fcafdce7fad64a46f91db0e4d50";
const DEPOSIT =
  "e0240dfbadb1bd03ec5f5e1c93899f59a80f1307354d534bd10563d566897a43";
const ASSET_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e3613a1";
const TO_ASSET = "nep141:wrap.near";
const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
const WALLET_ADDRESS = "0x3259abcdef12345678901073abcdef1234567890";
const PAYLOAD =
  '{"verifying_contract":"intents.far","signer_id":"0x7edf07ede58238026db3f90fc8032633b69b8de5"}';
const EXPIRES_AT = new Date(Date.now() + 72 * 60 * 60_000).toISOString();

const session = {
  userId: "user-1",
  accountKind: "passkey" as const,
  walletId: null,
  passkeyId: "passkey-1",
  intentsAccountId: ACCOUNT,
  chain: "near" as const,
  address: ACCOUNT,
  createdAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
};

function dryQuote(mode: string) {
  return {
    id: QUOTE_ID,
    user_id: "user-1",
    request: {
      fromAssetId: ASSET_ID,
      toAssetId: TO_ASSET,
      amount: "500000",
      recipient: ACCOUNT,
      refundTo: ACCOUNT,
      slippageBps: 100,
      confidentiality: "basic",
      mode,
      accountKind: "passkey",
      intentsAccountId: ACCOUNT,
    },
    response: {},
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}

const execution = {
  engine: "intents" as const,
  fromAssetId: ASSET_ID,
  toAssetId: TO_ASSET,
  amountIn: "500000",
  amountInFormatted: "0.5",
  amountOut: "121013838219236593059936",
  amountOutFormatted: "121013.838219236593059936",
  minAmountOut: "119803.699837044227129336",
  minAmountOutRaw: "119803699837044227129336",
  amountOutUsd: "0.498577013463",
  feeBps: 0,
  rate: 242027.67643847318,
  depositAddress: DEPOSIT,
  depositMemo: null,
  expiresAt: EXPIRES_AT,
  warnings: [],
};

function withdrawalDryQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: QUOTE_ID,
    user_id: "user-1",
    request: {
      fromAssetId: ASSET_ID,
      toAssetId: ASSET_ID,
      amount: "500000",
      recipient: DESTINATION,
      refundTo: ACCOUNT,
      slippageBps: 100,
      confidentiality: "basic",
      mode: "confidential-withdrawal",
      recipientType: "DESTINATION_CHAIN",
      refundType: "CONFIDENTIAL_INTENTS",
      destination: DESTINATION,
      accountKind: "passkey",
      intentsAccountId: ACCOUNT,
      ...overrides,
    },
    response: {},
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}

const withdrawalExecution = {
  ...execution,
  toAssetId: ASSET_ID,
  amountOut: "489400",
  amountOutFormatted: "0.4894",
  minAmountOut: "0.484506",
  minAmountOutRaw: "484506",
  amountOutUsd: "0.4894",
  rate: 0.9788,
  withdrawFee: "10600",
  withdrawFeeFormatted: "0.0106",
};

function request(body: unknown) {
  return new Request("http://localhost/api/intents/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/intents/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(session);
    createQuoteMock.mockResolvedValue("wet-quote-1");
    createApprovalMock.mockResolvedValue("approval-1");
    createTransactionMock.mockResolvedValue({
      id: TRANSACTION_ID,
      expected_out: execution.amountOutFormatted,
    });
    createExecutionQuoteMock.mockResolvedValue(execution);
    conversationIdForUserMock.mockResolvedValue(CONVERSATION_ID);
    getToolApprovalMock.mockResolvedValue(null);
    recordToolApprovalMock.mockResolvedValue({
      decision: "approved",
      toolName: "prepare_swap",
      decidedAt: new Date().toISOString(),
    });
  });

  it("rejects the wallet chain mode before reading a quote", async () => {
    const res = await POST(
      request({ quoteId: QUOTE_ID, action: "swap", mode: "chain" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "An error occurred." });
    expect(getQuoteMock).not.toHaveBeenCalled();
  });

  it("rebuilds the wet quote from the stored row and returns the exact intent", async () => {
    getQuoteMock.mockResolvedValue(dryQuote("confidential-intents"));
    generateIntentMock.mockResolvedValue({
      standard: "webauthn",
      payload: PAYLOAD,
    });

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        conversationId: CONVERSATION_ID,
        approvalId: "aitxt-1",
        action: "swap",
        mode: "confidential-intents",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      transactionId: TRANSACTION_ID,
      depositAddress: DEPOSIT,
      intent: { standard: "webauthn", payload: PAYLOAD },
      figures: {
        amountIn: execution.amountIn,
        amountInFormatted: execution.amountInFormatted,
        amountOut: execution.amountOut,
        amountOutFormatted: execution.amountOutFormatted,
        minAmountOut: execution.minAmountOut,
        minAmountOutRaw: execution.minAmountOutRaw,
        amountOutUsd: execution.amountOutUsd,
        rate: execution.rate,
        feeBps: execution.feeBps,
      },
      expiresAt: EXPIRES_AT,
    });

    expect(createExecutionQuoteMock).toHaveBeenCalledWith({
      fromAssetId: ASSET_ID,
      toAssetId: TO_ASSET,
      amount: "500000",
      recipient: ACCOUNT,
      refundTo: ACCOUNT,
      slippageBps: 100,
      confidentiality: "basic",
      mode: "confidential-intents",
    });
    expect(generateIntentMock).toHaveBeenCalledWith({
      type: "swap_transfer",
      standard: "webauthn",
      signerId: ACCOUNT,
      depositAddress: DEPOSIT,
    });
    expect(createTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "awaiting_approval",
        depositAddress: DEPOSIT,
        refs: expect.objectContaining({
          dryQuoteId: QUOTE_ID,
          wetQuoteId: "wet-quote-1",
          mode: "confidential-intents",
          standard: "webauthn",
          signerId: ACCOUNT,
          intentDepositAddress: DEPOSIT,
          amountInRaw: "500000",
          deadline: EXPIRES_AT,
          assetId: ASSET_ID,
          toolApprovalId: "aitxt-1",
          conversationId: CONVERSATION_ID,
        }),
      }),
    );
    expect(updateTransactionRefsMock).toHaveBeenCalledWith(TRANSACTION_ID, {
      intentPayload: PAYLOAD,
    });
    expect(startMock).not.toHaveBeenCalled();
    // The decision belongs to the submit route. A cancelled passkey prompt
    // must leave this card retryable, so approving the payload is not enough.
    expect(recordToolApprovalMock).not.toHaveBeenCalled();
  });

  it("starts the settlement reader immediately for an external deposit", async () => {
    getQuoteMock.mockResolvedValue(dryQuote("confidential-external"));
    startMock.mockResolvedValue({ runId: "run-1" });

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        action: "deposit",
        mode: "confidential-external",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      transactionId: TRANSACTION_ID,
      depositAddress: DEPOSIT,
      depositMemo: null,
      amountIn: "500000",
      expiresAt: EXPIRES_AT,
      runId: "run-1",
    });
    expect(generateIntentMock).not.toHaveBeenCalled();
    expect(startMock).toHaveBeenCalledWith(swapLifecycleStub, [
      {
        transactionId: TRANSACTION_ID,
        depositAddress: DEPOSIT,
        expectedOut: execution.amountOutFormatted,
        mode: "confidential-external",
      },
    ]);
    expect(setTransactionRunIdMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      "run-1",
    );
    expect(createTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: "submitted" }),
    );
  });

  it("never starts a workflow when the intent could not be generated", async () => {
    getQuoteMock.mockResolvedValue(dryQuote("confidential-intents"));
    generateIntentMock.mockRejectedValue(new Error("masked"));

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        action: "swap",
        mode: "confidential-intents",
      }),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "An error occurred." });
    expect(setTransactionStateMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      "failed",
    );
    expect(startMock).not.toHaveBeenCalled();
    expect(updateTransactionRefsMock).not.toHaveBeenCalled();
  });

  it("refuses a stored quote priced for another account", async () => {
    const quote = dryQuote("confidential-intents");
    quote.request.intentsAccountId = OTHER_ACCOUNT;
    getQuoteMock.mockResolvedValue(quote);

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        action: "swap",
        mode: "confidential-intents",
      }),
    );

    expect(res.status).toBe(400);
    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
    expect(generateIntentMock).not.toHaveBeenCalled();
  });

  it("binds a withdrawal destination from the stored quote for a passkey", async () => {
    getQuoteMock.mockResolvedValue(withdrawalDryQuote());
    createExecutionQuoteMock.mockResolvedValue(withdrawalExecution);
    createTransactionMock.mockResolvedValue({
      id: TRANSACTION_ID,
      expected_out: withdrawalExecution.amountOutFormatted,
    });
    generateIntentMock.mockResolvedValue({
      standard: "webauthn",
      payload: PAYLOAD,
    });

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        conversationId: CONVERSATION_ID,
        approvalId: "aitxt-withdraw",
        action: "withdraw",
        mode: "confidential-withdrawal",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.destination).toBe(DESTINATION);
    expect(body.intent).toEqual({ standard: "webauthn", payload: PAYLOAD });
    expect(body.figures).toMatchObject({
      amountInFormatted: "0.5",
      amountOutFormatted: "0.4894",
      minAmountOut: "0.484506",
      withdrawFee: "10600",
      withdrawFeeFormatted: "0.0106",
    });
    expect(body.depositAddress).toBe(DEPOSIT);

    expect(createExecutionQuoteMock).toHaveBeenCalledWith({
      fromAssetId: ASSET_ID,
      toAssetId: ASSET_ID,
      amount: "500000",
      recipient: DESTINATION,
      refundTo: ACCOUNT,
      slippageBps: 100,
      confidentiality: "basic",
      mode: "confidential-withdrawal",
    });
    expect(generateIntentMock).toHaveBeenCalledWith({
      type: "swap_transfer",
      standard: "webauthn",
      signerId: ACCOUNT,
      depositAddress: DEPOSIT,
    });
    expect(createTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "awaiting_approval",
        recipient: DESTINATION,
        refundTo: ACCOUNT,
        originAsset: ASSET_ID,
        destinationAsset: ASSET_ID,
        refs: expect.objectContaining({
          mode: "confidential-withdrawal",
          destination: DESTINATION,
          signerId: ACCOUNT,
          standard: "webauthn",
          toolApprovalId: "aitxt-withdraw",
        }),
      }),
    );
    expect(startMock).not.toHaveBeenCalled();
  });

  it("keeps a wallet account on the same signed withdrawal lifecycle", async () => {
    requireSessionMock.mockResolvedValue({
      ...session,
      accountKind: "wallet",
      walletId: "wallet-1",
      passkeyId: null,
      chain: "evm",
      address: WALLET_ADDRESS,
    });
    getQuoteMock.mockResolvedValue(
      withdrawalDryQuote({ accountKind: "wallet" }),
    );
    createExecutionQuoteMock.mockResolvedValue(withdrawalExecution);
    createTransactionMock.mockResolvedValue({
      id: TRANSACTION_ID,
      expected_out: withdrawalExecution.amountOutFormatted,
    });
    generateIntentMock.mockResolvedValue({
      standard: "erc191",
      payload: PAYLOAD,
    });

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        action: "withdraw",
        mode: "confidential-withdrawal",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intent.standard).toBe("erc191");
    expect(body.destination).toBe(DESTINATION);
    expect(generateIntentMock).toHaveBeenCalledWith({
      type: "swap_transfer",
      standard: "erc191",
      signerId: ACCOUNT,
      depositAddress: DEPOSIT,
    });
    expect(createTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: "awaiting_approval" }),
    );
    expect(startMock).not.toHaveBeenCalled();
  });

  it("re-resolves a stored destination name fresh at sign time", async () => {
    getQuoteMock.mockResolvedValue(
      withdrawalDryQuote({
        destinationName: "vitalik.eth",
        destinationResolvedAt: "2026-11-08T00:00:00.000Z",
      }),
    );
    resolveNameMock.mockResolvedValue({
      address: DESTINATION,
      name: "vitalik.eth",
      resolvedAt: new Date().toISOString(),
    });
    createExecutionQuoteMock.mockResolvedValue(withdrawalExecution);
    createTransactionMock.mockResolvedValue({
      id: TRANSACTION_ID,
      expected_out: withdrawalExecution.amountOutFormatted,
    });
    generateIntentMock.mockResolvedValue({
      standard: "webauthn",
      payload: PAYLOAD,
    });

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        action: "withdraw",
        mode: "confidential-withdrawal",
      }),
    );

    expect(resolveNameMock).toHaveBeenCalledWith("evm", "vitalik.eth");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ destination: DESTINATION });
  });

  it("refuses a withdrawal whose name was re-pointed since pricing", async () => {
    getQuoteMock.mockResolvedValue(
      withdrawalDryQuote({
        destinationName: "vitalik.eth",
        destinationResolvedAt: "2026-11-08T00:00:00.000Z",
      }),
    );
    resolveNameMock.mockResolvedValue({
      address: "0x0000000000000000000000000000000000000001",
      name: "vitalik.eth",
      resolvedAt: new Date().toISOString(),
    });

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        action: "withdraw",
        mode: "confidential-withdrawal",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "stale",
      message:
        "The destination changed since it was priced. Please ask for a fresh quote.",
    });
    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
    expect(generateIntentMock).not.toHaveBeenCalled();
  });

  it("fails closed when the sign-time name read is unavailable", async () => {
    getQuoteMock.mockResolvedValue(
      withdrawalDryQuote({
        destinationName: "vitalik.eth",
        destinationResolvedAt: "2026-11-08T00:00:00.000Z",
      }),
    );
    resolveNameMock.mockRejectedValue(
      nameError("unavailable", "ens_rpc", "down"),
    );

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        action: "withdraw",
        mode: "confidential-withdrawal",
      }),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "An error occurred." });
    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
  });

  it("refuses an action that does not match the withdrawal mode", async () => {
    getQuoteMock.mockResolvedValue(withdrawalDryQuote());

    for (const action of ["swap", "deposit"]) {
      const res = await POST(
        request({
          quoteId: QUOTE_ID,
          action,
          mode: "confidential-withdrawal",
        }),
      );
      expect(res.status, action).toBe(400);
    }

    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
    expect(generateIntentMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("refuses a stored quote whose recipient type was tampered with", async () => {
    for (const recipientType of ["CONFIDENTIAL_INTENTS", "INTENTS"]) {
      getQuoteMock.mockResolvedValue(
        withdrawalDryQuote({ recipientType }),
      );

      const res = await POST(
        request({
          quoteId: QUOTE_ID,
          action: "withdraw",
          mode: "confidential-withdrawal",
        }),
      );

      expect(res.status, recipientType).toBe(400);
    }

    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
    expect(generateIntentMock).not.toHaveBeenCalled();
  });

  it("refuses a stored quote whose refund is not the session account", async () => {
    getQuoteMock.mockResolvedValue(
      withdrawalDryQuote({ refundTo: DESTINATION }),
    );

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        action: "withdraw",
        mode: "confidential-withdrawal",
      }),
    );

    expect(res.status).toBe(400);
    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
  });

  it("refuses a stored withdrawal destination that is not an address", async () => {
    getQuoteMock.mockResolvedValue(
      withdrawalDryQuote({ recipient: "not-an-address", destination: null }),
    );

    const res = await POST(
      request({
        quoteId: QUOTE_ID,
        action: "withdraw",
        mode: "confidential-withdrawal",
      }),
    );

    expect(res.status).toBe(400);
    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied destination or recipient type before reading a quote", async () => {
    for (const extra of [
      { destination: DESTINATION },
      { recipient: DESTINATION },
      { recipientType: "DESTINATION_CHAIN" },
      { refundType: "CONFIDENTIAL_INTENTS" },
    ]) {
      const res = await POST(
        request({
          quoteId: QUOTE_ID,
          action: "withdraw",
          mode: "confidential-withdrawal",
          ...extra,
        }),
      );
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }

    expect(getQuoteMock).not.toHaveBeenCalled();
  });
});
