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
  startMock,
  swapLifecycleStub,
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
  startMock: vi.fn(),
  swapLifecycleStub: vi.fn(),
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

import { POST } from "./route";

const TRANSACTION_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const WALLET_ADDRESS = "0x3259abcdef12345678901073abcdef1234567890";
const DEPOSIT =
  "e0240dfbadb1bd03ec5f5e1c93899f59a80f1307354d534bd10563d566897a43";
const ASSET_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e3613a1";
const PAYLOAD = '{"verifying_contract":"intents.far","signer_id":"0x1"}';
const OTHER_PAYLOAD = '{"verifying_contract":"intents.far","signer_id":"0x2"}';
const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
const OTHER_DESTINATION = "0x0000000000000000000000000000000000000001";
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

const passkeySession = {
  ...walletSession,
  accountKind: "passkey" as const,
  walletId: null,
  passkeyId: "passkey-1",
  chain: "near" as const,
  address: ACCOUNT,
};

const SIGNED_DATA = {
  standard: "erc191",
  payload: PAYLOAD,
  signature: "0xsignature",
};

function tx(overrides: Record<string, unknown> = {}) {
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
      refs: {
        dryQuoteId: "11111111-1111-4111-8111-111111111111",
        wetQuoteId: "44444444-4444-4444-8444-444444444444",
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
      },
      outcome: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    },
    events: [],
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/intents/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function passkeyDb(row: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data: row, error: null });
  return { from: vi.fn(() => chain), chain };
}

const PASSKEY_KEY_BASE64 = Buffer.from(new Uint8Array(64)).toString("base64");

describe("/api/intents/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(walletSession);
    startMock.mockResolvedValue({ runId: "run-1" });
    getWebAuthnConfigMock.mockReturnValue({
      rpID: "localhost",
      rpName: "Myntle",
      origin: ["http://localhost:3000"],
    });
  });

  it("maps any assertion failure to one generic 401 and never submits", async () => {
    getTransactionMock.mockResolvedValue(tx());
    verifyIntentMock.mockResolvedValue({
      ok: false,
      reason: "challenge-mismatch",
    });

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "An error occurred." });
    expect(JSON.stringify(body)).not.toContain("challenge-mismatch");
    expect(submitIntentMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();

    // Every expected value comes from the stored row, not the browser body.
    expect(verifyIntentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signedData: SIGNED_DATA,
        payload: PAYLOAD,
        signerId: ACCOUNT,
        standard: "erc191",
        mode: "confidential",
        depositAddress: DEPOSIT,
        amountIn: "500000",
        assetId: ASSET_ID,
        deadline: DEADLINE,
        accountKind: "wallet",
        chain: "evm",
        address: WALLET_ADDRESS,
        passkeyPublicKey: undefined,
        webauthn: { rpID: "", origins: [] },
      }),
    );
  });

  it("records the accepted hash and starts the settlement reader", async () => {
    getTransactionMock.mockResolvedValue(tx());
    verifyIntentMock.mockResolvedValue({ ok: true, standard: "erc191" });
    submitIntentMock.mockResolvedValue({
      intentHash: "server-hash",
      correlationId: "corr",
    });

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      transactionId: TRANSACTION_ID,
      intentHash: "server-hash",
      runId: "run-1",
    });
    expect(submitIntentMock).toHaveBeenCalledWith({
      type: "swap_transfer",
      signedData: SIGNED_DATA,
    });
    expect(updateTransactionRefsMock).toHaveBeenCalledWith(TRANSACTION_ID, {
      intentHash: "server-hash",
      signedAt: expect.any(String),
      standard: "erc191",
    });
    expect(setTransactionStateMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      "submitted",
    );
    expect(addEventMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      "submitted",
      "The signed intent was submitted for settlement.",
    );
    expect(startMock).toHaveBeenCalledWith(swapLifecycleStub, [
      {
        transactionId: TRANSACTION_ID,
        depositAddress: DEPOSIT,
        expectedOut: "100",
        mode: "confidential-intents",
      },
    ]);
    expect(setTransactionRunIdMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      "run-1",
    );
    expect(getSupabaseAdminMock).not.toHaveBeenCalled();
  });

  it("keeps the row awaiting approval when submit-intent rejects", async () => {
    getTransactionMock.mockResolvedValue(tx());
    verifyIntentMock.mockResolvedValue({ ok: true, standard: "erc191" });
    submitIntentMock.mockRejectedValue(new Error("masked"));

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "The transaction could not be submitted. Please try again.",
    });
    expect(updateTransactionRefsMock).not.toHaveBeenCalled();
    expect(setTransactionStateMock).not.toHaveBeenCalled();
    expect(addEventMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("returns the existing result for the same intent after submitted", async () => {
    getTransactionMock.mockResolvedValue(
      tx({
        state: "submitted",
        workflow_run_id: "run-0",
        refs: {
          ...tx().tx.refs,
          intentHash: `hash:${PAYLOAD}`,
        },
      }),
    );

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      transactionId: TRANSACTION_ID,
      intentHash: `hash:${PAYLOAD}`,
      runId: "run-0",
    });
    expect(verifyIntentMock).not.toHaveBeenCalled();
    expect(submitIntentMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("starts the missing workflow on an idempotent retry", async () => {
    getTransactionMock.mockResolvedValue(
      tx({
        state: "submitted",
        workflow_run_id: null,
        refs: {
          ...tx().tx.refs,
          intentHash: `hash:${PAYLOAD}`,
        },
      }),
    );

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      transactionId: TRANSACTION_ID,
      intentHash: `hash:${PAYLOAD}`,
      runId: "run-1",
    });
    expect(verifyIntentMock).not.toHaveBeenCalled();
    expect(submitIntentMock).not.toHaveBeenCalled();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(setTransactionRunIdMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      "run-1",
    );
  });

  it("rejects a different intent after submitted", async () => {
    getTransactionMock.mockResolvedValue(
      tx({
        state: "submitted",
        workflow_run_id: "run-0",
        refs: {
          ...tx().tx.refs,
          intentHash: `hash:${PAYLOAD}`,
        },
      }),
    );

    const res = await POST(
      request({
        transactionId: TRANSACTION_ID,
        signedData: { ...SIGNED_DATA, payload: OTHER_PAYLOAD },
      }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      message: "This transaction has already been submitted.",
    });
    expect(submitIntentMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("converts the stored passkey key and asserts the returned intent hash", async () => {
    requireSessionMock.mockResolvedValue(passkeySession);
    getSupabaseAdminMock.mockReturnValue(
      passkeyDb({
        p256_public_key: PASSKEY_KEY_BASE64,
        account_id: ACCOUNT,
      }),
    );
    getTransactionMock.mockResolvedValue(
      tx({
        refs: {
          ...tx().tx.refs,
          standard: "webauthn",
        },
      }),
    );
    verifyIntentMock.mockResolvedValue({ ok: true, standard: "webauthn" });
    submitIntentMock.mockResolvedValue({
      intentHash: `hash:${PAYLOAD}`,
      correlationId: "corr",
    });

    const res = await POST(
      request({
        transactionId: TRANSACTION_ID,
        signedData: { standard: "webauthn", payload: PAYLOAD },
      }),
    );

    expect(res.status).toBe(200);
    expect(verifyIntentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountKind: "passkey",
        chain: "near",
        address: undefined,
        passkeyPublicKey: expect.stringMatching(/^p256:/),
        webauthn: {
          rpID: "localhost",
          origins: ["http://localhost:3000"],
        },
      }),
    );
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("marks a passkey hash mismatch for reconciliation and starts no workflow", async () => {
    requireSessionMock.mockResolvedValue(passkeySession);
    getSupabaseAdminMock.mockReturnValue(
      passkeyDb({
        p256_public_key: PASSKEY_KEY_BASE64,
        account_id: ACCOUNT,
      }),
    );
    getTransactionMock.mockResolvedValue(
      tx({
        refs: {
          ...tx().tx.refs,
          standard: "webauthn",
        },
      }),
    );
    verifyIntentMock.mockResolvedValue({ ok: true, standard: "webauthn" });
    submitIntentMock.mockResolvedValue({
      intentHash: "not-the-content-hash",
      correlationId: "corr",
    });

    const res = await POST(
      request({
        transactionId: TRANSACTION_ID,
        signedData: { standard: "webauthn", payload: PAYLOAD },
      }),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "An error occurred." });
    expect(setTransactionStateMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      "needs_reconciliation",
    );
    expect(addEventMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      "needs_reconciliation",
      "The submitted intent hash did not match the stored payload.",
    );
    expect(startMock).not.toHaveBeenCalled();
  });

  it("submits a withdrawal as a signed confidential intent", async () => {
    getTransactionMock.mockResolvedValue(
      tx({
        recipient: DESTINATION,
        refs: {
          ...tx().tx.refs,
          mode: "confidential-withdrawal",
          destination: DESTINATION,
        },
      }),
    );
    verifyIntentMock.mockResolvedValue({ ok: true, standard: "erc191" });
    submitIntentMock.mockResolvedValue({
      intentHash: "server-hash",
      correlationId: "corr",
    });

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(200);
    expect(verifyIntentMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "confidential" }),
    );
    expect(submitIntentMock).toHaveBeenCalledWith({
      type: "swap_transfer",
      signedData: SIGNED_DATA,
    });
    expect(startMock).toHaveBeenCalledWith(swapLifecycleStub, [
      {
        transactionId: TRANSACTION_ID,
        depositAddress: DEPOSIT,
        expectedOut: "100",
        mode: "confidential-withdrawal",
      },
    ]);
  });

  it("refuses a withdrawal when the row and refs name different destinations", async () => {
    getTransactionMock.mockResolvedValue(
      tx({
        recipient: OTHER_DESTINATION,
        refs: {
          ...tx().tx.refs,
          mode: "confidential-withdrawal",
          destination: DESTINATION,
        },
      }),
    );

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "An error occurred." });
    expect(verifyIntentMock).not.toHaveBeenCalled();
    expect(submitIntentMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("refuses a withdrawal with no bound destination in the refs", async () => {
    getTransactionMock.mockResolvedValue(
      tx({
        recipient: DESTINATION,
        refs: {
          ...tx().tx.refs,
          mode: "confidential-withdrawal",
          destination: undefined,
        },
      }),
    );

    const res = await POST(
      request({ transactionId: TRANSACTION_ID, signedData: SIGNED_DATA }),
    );

    expect(res.status).toBe(400);
    expect(verifyIntentMock).not.toHaveBeenCalled();
    expect(submitIntentMock).not.toHaveBeenCalled();
  });
});
