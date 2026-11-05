import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  getQuoteMock,
  verifyWalletSignatureMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  getQuoteMock: vi.fn(),
  verifyWalletSignatureMock: vi.fn(),
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
  createApproval: vi.fn(),
  createQuote: vi.fn(),
  createTransaction: vi.fn(),
  setTransactionRunId: vi.fn(),
}));

vi.mock("workflow/api", () => ({ start: vi.fn() }));
vi.mock("@/workflows/swap-lifecycle", () => ({ swapLifecycle: vi.fn() }));

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
      expect(await res.json(), mode).toEqual({
        error: "confidential",
        message:
          "This quote belongs to the confidential account. Use the confidential route.",
      });
    }

    expect(verifyWalletSignatureMock).not.toHaveBeenCalled();
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
