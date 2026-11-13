import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  getQuoteMock,
  verifyWalletSignatureMock,
  getToolApprovalMock,
  recordToolApprovalMock,
  conversationIdForUserMock,
  resolveNameMock,
  createApprovalMock,
  createQuoteMock,
  createTransactionMock,
  createExecutionQuoteMock,
  getAssetsMock,
  startMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  getQuoteMock: vi.fn(),
  verifyWalletSignatureMock: vi.fn(),
  getToolApprovalMock: vi.fn(),
  recordToolApprovalMock: vi.fn(),
  conversationIdForUserMock: vi.fn(),
  resolveNameMock: vi.fn(),
  createApprovalMock: vi.fn(),
  createQuoteMock: vi.fn(),
  createTransactionMock: vi.fn(),
  createExecutionQuoteMock: vi.fn(),
  getAssetsMock: vi.fn(),
  startMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: () => ({ limited: false, retryAfterMs: 0 }),
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/auth/signatures", () => ({
  verifyWalletSignature: verifyWalletSignatureMock,
}));

vi.mock("@/lib/db/transactions", () => ({
  getQuote: getQuoteMock,
  createApproval: createApprovalMock,
  createQuote: createQuoteMock,
  createTransaction: createTransactionMock,
  setTransactionRunId: vi.fn(),
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
vi.mock("@/workflows/swap-lifecycle", () => ({ swapLifecycle: vi.fn() }));

vi.mock("@/lib/intents/service", () => ({
  createExecutionQuote: createExecutionQuoteMock,
  getAssets: getAssetsMock,
}));

vi.mock("@/lib/adapters/registry", () => ({
  getNameResolverPort: () => ({ resolveName: resolveNameMock }),
}));

import { buildTradeApprovalMessage } from "@/lib/trade/approval-message";
import { normalizeEvmAddress } from "@/lib/intents/destination";
import { POST } from "./route";

const passkeySession = {
  userId: "user-1",
  accountKind: "passkey" as const,
  walletId: null,
  passkeyId: "passkey-1",
  intentsAccountId: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  chain: "near" as const,
  address: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  createdAt: Date.now() - 1_000,
  expiresAt: Date.now() + 1_000,
};

const walletSession = {
  userId: "user-1",
  accountKind: "wallet" as const,
  walletId: "wallet-1",
  passkeyId: null,
  intentsAccountId: "0x3259abcdef12345678901073abcdef1234567890",
  chain: "evm" as const,
  address: "0x3259abcdef12345678901073abcdef1234567890",
  createdAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
};

const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const EXPIRES_AT = new Date(Date.now() + 30 * 60_000).toISOString();

function approvalBody(overrides: Record<string, unknown> = {}) {
  return {
    fromAssetId: "nep141:usdc.near",
    toAssetId: "nep141:wrap.near",
    amount: "500000",
    recipient: walletSession.address,
    slippageBps: 100,
    minAmountOut: "1",
    expiresAt: EXPIRES_AT,
    requestedAt: new Date().toISOString(),
    quoteId: QUOTE_ID,
    message: "the exact approval message",
    signature: "0xsignature",
    ...overrides,
  };
}

function storedQuote(mode: string) {
  return {
    id: QUOTE_ID,
    user_id: "user-1",
    request: {
      fromAssetId: "nep141:usdc.near",
      toAssetId: "nep141:wrap.near",
      amount: "500000",
      recipient: walletSession.address,
      refundTo: walletSession.address,
      slippageBps: 100,
      mode,
    },
    response: {
      minAmountOutRaw: "1",
      expiresAt: EXPIRES_AT,
    },
    expires_at: EXPIRES_AT,
  };
}

describe("/api/approve stored confidential mode guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(walletSession);
    getToolApprovalMock.mockResolvedValue(null);
    conversationIdForUserMock.mockResolvedValue(null);
  });

  it("refuses a stored confidential quote before any signature work", async () => {
    for (const mode of [
      "confidential-intents",
      "confidential-external",
      "confidential-withdrawal",
    ]) {
      getQuoteMock.mockResolvedValue(storedQuote(mode));

      const res = await POST(
        new Request("http://localhost/api/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(approvalBody()),
        }),
      );

      expect(res.status, mode).toBe(400);
      const body = await res.json();
      expect(body, mode).toEqual({
        error: "unavailable",
        message:
          "This trade can't be completed here. Please ask for a fresh quote.",
      });
      expect(
        JSON.stringify(body).toLowerCase(),
        mode,
      ).not.toContain("confidential");
    }

    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
    expect(createApprovalMock).not.toHaveBeenCalled();
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("leaves a chain quote on the existing path", async () => {
    getQuoteMock.mockResolvedValue(storedQuote("chain"));

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          approvalBody({ fromAssetId: "nep141:other-asset" }),
        ),
      }),
    );

    // The guard did not fire: the request reached the stored-quote comparison
    // and failed there, before any signature work.
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "stale" });
    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
  });

  it("leaves a quote written before the mode existed on the existing path", async () => {
    const legacy = storedQuote("chain");
    legacy.request.mode = undefined as unknown as string;
    getQuoteMock.mockResolvedValue(legacy);

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          approvalBody({ fromAssetId: "nep141:other-asset" }),
        ),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "stale" });
  });
});

describe("/api/approve passkey guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers before reading a body, a quote, or a signature", async () => {
    requireSessionMock.mockResolvedValue(passkeySession);

    const res = await POST(
      new Request("http://localhost/api/approve", { method: "POST" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "This account signs with a passkey. Use the passkey route.",
    });
    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
  });

  it("leaves a wallet session on the existing path", async () => {
    requireSessionMock.mockResolvedValue({
      ...passkeySession,
      accountKind: "wallet",
      walletId: "wallet-1",
      passkeyId: null,
      chain: "evm",
      address: "0x3259abcdef12345678901073abcdef1234567890",
    });

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    // The empty body is rejected by the existing schema, not by the passkey
    // guard. The wallet route keeps its own validation.
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "An error occurred." });
  });
});

describe("/api/approve decided proposal guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(walletSession);
    conversationIdForUserMock.mockResolvedValue(null);
    getQuoteMock.mockResolvedValue(storedQuote("chain"));
  });

  it("refuses a proposal that was rejected on another device", async () => {
    getToolApprovalMock.mockResolvedValue({
      decision: "denied",
      toolName: "prepare_swap",
      decidedAt: new Date().toISOString(),
    });

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(approvalBody({ approvalId: "aitxt-denied" })),
      }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "denied",
      message: "This proposal was rejected. Please ask for a new one.",
    });
    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
  });
});

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

function namedStoredQuote() {
  const stored = storedQuote("chain");
  return {
    ...stored,
    request: {
      ...stored.request,
      recipient: VITALIK,
      recipientName: "vitalik.eth",
      recipientResolvedAt: "2026-11-08T00:00:00.000Z",
    },
  };
}

describe("/api/approve stored name bindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(walletSession);
    conversationIdForUserMock.mockResolvedValue(null);
    getToolApprovalMock.mockResolvedValue(null);
  });

  it("refuses a swap whose recipient name was re-pointed since pricing", async () => {
    getQuoteMock.mockResolvedValue(namedStoredQuote());
    resolveNameMock.mockResolvedValue({
      address: "0x0000000000000000000000000000000000000001",
      name: "vitalik.eth",
      resolvedAt: new Date().toISOString(),
    });

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(approvalBody({ recipient: VITALIK })),
      }),
    );

    expect(resolveNameMock).toHaveBeenCalledWith("evm", "vitalik.eth");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "stale",
      message:
        "The trade changed since it was priced. Please ask for a fresh quote.",
    });
    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
  });

  it("binds a claim that names the recipient instead of the address", async () => {
    getQuoteMock.mockResolvedValue(namedStoredQuote());
    resolveNameMock.mockImplementation(async (chain: string, input: string) => {
      if (chain === "evm" && input === "vitalik.eth") {
        return {
          address: VITALIK,
          name: "vitalik.eth",
          resolvedAt: new Date().toISOString(),
        };
      }
      return null;
    });

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(approvalBody({ recipient: "vitalik.eth" })),
      }),
    );

    // The claim normalized to the stored address, so the request passed the
    // stored-quote comparison and failed later on the signature message,
    // which the test does not mint. A raw mismatch would be stale.
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "An error occurred." });
    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
  });

  it("treats an unresolvable claim name as a moved trade", async () => {
    getQuoteMock.mockResolvedValue(storedQuote("chain"));
    resolveNameMock.mockResolvedValue(null);

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(approvalBody({ recipient: "vitalik.eth" })),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "stale" });
    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
  });
});

function approveExecution() {
  return {
    minAmountOutRaw: "1",
    depositAddress: "0xdeposit",
    depositMemo: null,
    amountIn: "500000",
    amountInFormatted: "0.5",
    amountOut: "1",
    amountOutFormatted: "1",
    minAmountOut: "1",
    expiresAt: EXPIRES_AT,
  };
}

function matchedApprovalBody(stored: ReturnType<typeof storedQuote>) {
  const request = stored.request as Record<string, unknown>;
  const response = stored.response;
  const requestedAt = new Date().toISOString();
  const recipient = String(request.recipient);
  const refundTo = String(request.refundTo);
  return approvalBody({
    requestedAt,
    minAmountOut: response.minAmountOutRaw,
    expiresAt: response.expiresAt,
    message: buildTradeApprovalMessage({
      fromAssetId: String(request.fromAssetId),
      toAssetId: String(request.toAssetId),
      amount: String(request.amount),
      recipient: normalizeEvmAddress(recipient) ?? recipient,
      refundTo: normalizeEvmAddress(refundTo) ?? refundTo,
      slippageBps: Number(request.slippageBps),
      minAmountOut: response.minAmountOutRaw,
      expiresAt: response.expiresAt,
      requestedAt,
    }),
  });
}

describe("/api/approve stored confidentiality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(walletSession);
    getToolApprovalMock.mockResolvedValue(null);
    conversationIdForUserMock.mockResolvedValue(null);
    verifyWalletSignatureMock.mockResolvedValue(undefined);
    createExecutionQuoteMock.mockResolvedValue(approveExecution());
    getAssetsMock.mockResolvedValue([]);
    createApprovalMock.mockResolvedValue("ap-1");
    createTransactionMock.mockResolvedValue({ id: "tx-1" });
    startMock.mockResolvedValue({ runId: "run-1" });
  });

  it("forwards a stored public quote as basic", async () => {
    const stored = storedQuote("chain");
    (stored.request as Record<string, unknown>).confidentiality = "public";
    getQuoteMock.mockResolvedValue(stored);

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(matchedApprovalBody(stored)),
      }),
    );

    expect(res.status).toBe(200);
    expect(createExecutionQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ confidentiality: "basic" }),
    );
  });

  it("keeps a stored advanced quote advanced", async () => {
    const stored = storedQuote("chain");
    (stored.request as Record<string, unknown>).confidentiality = "advanced";
    getQuoteMock.mockResolvedValue(stored);

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(matchedApprovalBody(stored)),
      }),
    );

    expect(res.status).toBe(200);
    expect(createExecutionQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ confidentiality: "advanced" }),
    );
  });
});

describe("/api/approve stored account binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(walletSession);
    getToolApprovalMock.mockResolvedValue(null);
    conversationIdForUserMock.mockResolvedValue(null);
    verifyWalletSignatureMock.mockResolvedValue(undefined);
    createExecutionQuoteMock.mockResolvedValue(approveExecution());
    getAssetsMock.mockResolvedValue([]);
    createApprovalMock.mockResolvedValue("ap-1");
    createTransactionMock.mockResolvedValue({ id: "tx-1" });
    startMock.mockResolvedValue({ runId: "run-1" });
  });

  it("refuses a quote stored for another account kind", async () => {
    const stored = storedQuote("chain");
    (stored.request as Record<string, unknown>).accountKind = "passkey";
    getQuoteMock.mockResolvedValue(stored);

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(approvalBody()),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "unavailable",
      message:
        "This trade can't be completed here. Please ask for a fresh quote.",
    });
    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
    expect(createApprovalMock).not.toHaveBeenCalled();
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("refuses a quote stored for another Intents account", async () => {
    const stored = storedQuote("chain");
    (stored.request as Record<string, unknown>).accountKind = "wallet";
    (stored.request as Record<string, unknown>).intentsAccountId =
      "0x0000000000000000000000000000000000000002";
    getQuoteMock.mockResolvedValue(stored);

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(approvalBody()),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "unavailable",
      message:
        "This trade can't be completed here. Please ask for a fresh quote.",
    });
    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
    expect(createApprovalMock).not.toHaveBeenCalled();
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("refuses a NEAR account id that differs only in case", async () => {
    requireSessionMock.mockResolvedValue({
      ...walletSession,
      chain: "near",
      address: "alice.near",
      intentsAccountId: "alice.near",
    });
    const stored = storedQuote("chain");
    (stored.request as Record<string, unknown>).accountKind = "wallet";
    (stored.request as Record<string, unknown>).intentsAccountId = "Alice.near";
    getQuoteMock.mockResolvedValue(stored);

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(approvalBody()),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "unavailable",
      message:
        "This trade can't be completed here. Please ask for a fresh quote.",
    });
    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
    expect(createApprovalMock).not.toHaveBeenCalled();
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("accepts an EVM Intents account that differs only in case", async () => {
    const stored = storedQuote("chain");
    (stored.request as Record<string, unknown>).accountKind = "wallet";
    (stored.request as Record<string, unknown>).intentsAccountId =
      "0x3259ABCDEF12345678901073ABCDEF1234567890";
    getQuoteMock.mockResolvedValue(stored);

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(matchedApprovalBody(stored)),
      }),
    );

    expect(res.status).toBe(200);
    expect(verifyWalletSignatureMock).toHaveBeenCalledTimes(1);
  });
});

describe("/api/approve price moves", () => {
  const FRESH_QUOTE_ID = "22222222-2222-4222-8222-222222222222";
  const FRESH_EXPIRES_AT = new Date(
    Date.now() + 3 * 24 * 60 * 60_000,
  ).toISOString();

  function revisedApprovalBody(
    stored: ReturnType<typeof storedQuote>,
    revised: {
      quoteId: string;
      minAmountOut: string;
      expiresAt: string;
      requestedAt: string;
    },
  ) {
    const request = stored.request as Record<string, unknown>;
    const recipient =
      normalizeEvmAddress(String(request.recipient)) ??
      String(request.recipient);
    const refundTo =
      normalizeEvmAddress(String(request.refundTo)) ??
      String(request.refundTo);
    return approvalBody({
      quoteId: revised.quoteId,
      minAmountOut: revised.minAmountOut,
      expiresAt: revised.expiresAt,
      requestedAt: revised.requestedAt,
      recipient,
      refundTo,
      message: buildTradeApprovalMessage({
        fromAssetId: String(request.fromAssetId),
        toAssetId: String(request.toAssetId),
        amount: String(request.amount),
        recipient,
        refundTo,
        slippageBps: Number(request.slippageBps),
        minAmountOut: revised.minAmountOut,
        expiresAt: revised.expiresAt,
        requestedAt: revised.requestedAt,
      }),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(walletSession);
    getToolApprovalMock.mockResolvedValue(null);
    conversationIdForUserMock.mockResolvedValue(null);
    verifyWalletSignatureMock.mockResolvedValue(undefined);
    getAssetsMock.mockResolvedValue([]);
    createApprovalMock.mockResolvedValue("ap-1");
    createQuoteMock.mockResolvedValue(FRESH_QUOTE_ID);
    createTransactionMock.mockResolvedValue({ id: "tx-1" });
    startMock.mockResolvedValue({ runId: "run-1" });
  });

  it("saves the revised figures so the resubmission is not stale", async () => {
    const stored = storedQuote("chain");
    stored.response.minAmountOutRaw = "100";
    getQuoteMock.mockResolvedValue(stored);
    createExecutionQuoteMock.mockResolvedValue({
      ...approveExecution(),
      minAmountOutRaw: "90",
      minAmountOut: "0.00000000000000009",
      amountOut: "90",
      amountOutFormatted: "0.00000000000000009",
      expiresAt: FRESH_EXPIRES_AT,
    });

    const first = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(matchedApprovalBody(stored)),
      }),
    );

    expect(first.status).toBe(409);
    const moved = (await first.json()) as {
      error?: string;
      message?: string;
      fresh?: {
        quoteId?: string;
        requestedAt?: string;
        amountOut: string;
        minAmountOut: string;
        minAmountOutRaw: string;
        expiresAt: string;
      };
    };
    expect(moved.error).toBe("price-moved");
    expect(moved.fresh).toMatchObject({
      quoteId: FRESH_QUOTE_ID,
      minAmountOutRaw: "90",
      expiresAt: FRESH_EXPIRES_AT,
    });
    const requestedAt = moved.fresh?.requestedAt;
    expect(requestedAt).toEqual(expect.any(String));
    expect(createQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        request: expect.objectContaining({
          fromAssetId: stored.request.fromAssetId,
          revisedFromQuoteId: QUOTE_ID,
        }),
        response: expect.objectContaining({
          minAmountOutRaw: "90",
          expiresAt: FRESH_EXPIRES_AT,
        }),
        expiresAt: FRESH_EXPIRES_AT,
      }),
    );
    // The signature was checked, but nothing was recorded on a refused price.
    expect(verifyWalletSignatureMock).toHaveBeenCalledTimes(1);
    expect(createApprovalMock).not.toHaveBeenCalled();
    expect(createTransactionMock).not.toHaveBeenCalled();

    // The next click reads the revised preview the route just saved and
    // signs the figures the card now shows.
    const revised = {
      ...stored,
      id: FRESH_QUOTE_ID,
      response: {
        minAmountOutRaw: "90",
        expiresAt: FRESH_EXPIRES_AT,
      },
      expires_at: FRESH_EXPIRES_AT,
    };
    getQuoteMock.mockResolvedValue(revised);
    createExecutionQuoteMock.mockResolvedValue({
      ...approveExecution(),
      minAmountOutRaw: "90",
      expiresAt: FRESH_EXPIRES_AT,
    });

    const second = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          revisedApprovalBody(stored, {
            quoteId: FRESH_QUOTE_ID,
            minAmountOut: "90",
            expiresAt: FRESH_EXPIRES_AT,
            requestedAt: requestedAt as string,
          }),
        ),
      }),
    );

    expect(second.status).toBe(200);
    expect(verifyWalletSignatureMock).toHaveBeenCalledTimes(2);
    expect(createTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        originAsset: stored.request.fromAssetId,
        destinationAsset: stored.request.toAssetId,
      }),
    );
  });

  it("fails closed when the revised preview cannot be saved", async () => {
    const stored = storedQuote("chain");
    stored.response.minAmountOutRaw = "100";
    getQuoteMock.mockResolvedValue(stored);
    createExecutionQuoteMock.mockResolvedValue({
      ...approveExecution(),
      minAmountOutRaw: "90",
      expiresAt: FRESH_EXPIRES_AT,
    });
    createQuoteMock.mockRejectedValueOnce(new Error("write failed"));

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(matchedApprovalBody(stored)),
      }),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "price-moved",
      message: "The price has moved. Please ask for a fresh quote.",
    });
    expect(createApprovalMock).not.toHaveBeenCalled();
    expect(createTransactionMock).not.toHaveBeenCalled();
  });
});

describe("/api/approve EVM canonicalisation", () => {
  function claimBody(
    stored: ReturnType<typeof storedQuote>,
    recipient: string,
    refundTo: string,
  ) {
    const request = stored.request as Record<string, unknown>;
    const response = stored.response;
    const requestedAt = new Date().toISOString();
    return approvalBody({
      recipient,
      refundTo,
      requestedAt,
      message: buildTradeApprovalMessage({
        fromAssetId: String(request.fromAssetId),
        toAssetId: String(request.toAssetId),
        amount: String(request.amount),
        recipient,
        refundTo,
        slippageBps: Number(request.slippageBps),
        minAmountOut: response.minAmountOutRaw,
        expiresAt: response.expiresAt,
        requestedAt,
      }),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(walletSession);
    getToolApprovalMock.mockResolvedValue(null);
    conversationIdForUserMock.mockResolvedValue(null);
    verifyWalletSignatureMock.mockResolvedValue(undefined);
    createExecutionQuoteMock.mockResolvedValue(approveExecution());
    getAssetsMock.mockResolvedValue([]);
    createApprovalMock.mockResolvedValue("ap-1");
    createTransactionMock.mockResolvedValue({ id: "tx-1" });
    startMock.mockResolvedValue({ runId: "run-1" });
  });

  it("accepts an EIP-55 claim against an old lowercase stored quote", async () => {
    const lower = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const checksummed = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const stored = storedQuote("chain");
    (stored.request as Record<string, unknown>).recipient = lower;
    (stored.request as Record<string, unknown>).refundTo = lower;
    getQuoteMock.mockResolvedValue(stored);

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(claimBody(stored, checksummed, checksummed)),
      }),
    );

    expect(res.status).toBe(200);
    expect(verifyWalletSignatureMock).toHaveBeenCalledTimes(1);
    expect(createExecutionQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: checksummed,
        refundTo: checksummed,
      }),
    );
    expect(createTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: checksummed,
        refundTo: checksummed,
      }),
    );
  });

  it("leaves a non-EVM address unchanged", async () => {
    const solana = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
    const stored = storedQuote("chain");
    (stored.request as Record<string, unknown>).recipient = solana;
    (stored.request as Record<string, unknown>).refundTo = solana;
    getQuoteMock.mockResolvedValue(stored);

    const res = await POST(
      new Request("http://localhost/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(claimBody(stored, solana, solana)),
      }),
    );

    expect(res.status).toBe(200);
    expect(createExecutionQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: solana,
        refundTo: solana,
      }),
    );
    expect(createTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: solana,
        refundTo: solana,
      }),
    );
  });
});
