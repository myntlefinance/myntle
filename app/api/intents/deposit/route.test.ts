import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  getAssetsMock,
  createExecutionQuoteMock,
  createQuoteMock,
  createApprovalMock,
  createTransactionMock,
  setTransactionRunIdMock,
  startMock,
  swapLifecycleStub,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  getAssetsMock: vi.fn(),
  createExecutionQuoteMock: vi.fn(),
  createQuoteMock: vi.fn(),
  createApprovalMock: vi.fn(),
  createTransactionMock: vi.fn(),
  setTransactionRunIdMock: vi.fn(),
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

vi.mock("@/lib/intents/service", () => ({
  getAssets: getAssetsMock,
  createExecutionQuote: createExecutionQuoteMock,
}));

vi.mock("@/lib/db/transactions", () => ({
  createQuote: createQuoteMock,
  createApproval: createApprovalMock,
  createTransaction: createTransactionMock,
  setTransactionRunId: setTransactionRunIdMock,
}));

vi.mock("workflow/api", () => ({ start: startMock }));
vi.mock("@/workflows/swap-lifecycle", () => ({
  swapLifecycle: swapLifecycleStub,
}));

import { POST } from "./route";

const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const TRANSACTION_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "0x7edf07ede58238026db3f90fc8032633b69b8de5";
const DEPOSIT =
  "e0240dfbadb1bd03ec5f5e1c93899f59a80f1307354d534bd10563d566897a43";
const ASSET_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
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

const execution = {
  engine: "intents" as const,
  fromAssetId: ASSET_ID,
  toAssetId: ASSET_ID,
  amountIn: "1000000",
  amountInFormatted: "1",
  amountOut: "1000000",
  amountOutFormatted: "1",
  minAmountOut: "0.99",
  minAmountOutRaw: "990000",
  amountOutUsd: "1",
  feeBps: 0,
  rate: 1,
  depositAddress: DEPOSIT,
  depositMemo: null,
  expiresAt: EXPIRES_AT,
  warnings: [],
};

function request(body: unknown) {
  return new Request("http://localhost/api/intents/deposit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/intents/deposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(session);
    getAssetsMock.mockResolvedValue([
      {
        assetId: ASSET_ID,
        symbol: "USDC",
        decimals: 6,
        chain: "near",
        price: 1,
        contractAddress: "usdc.near",
      },
    ]);
    createQuoteMock.mockResolvedValue("wet-quote-1");
    createApprovalMock.mockResolvedValue("approval-1");
    createTransactionMock.mockResolvedValue({
      id: TRANSACTION_ID,
      expected_out: execution.amountOutFormatted,
    });
    createExecutionQuoteMock.mockResolvedValue(execution);
    startMock.mockResolvedValue({ runId: "run-1" });
  });

  it("mints a same-asset external deposit for the session account", async () => {
    const res = await POST(
      request({
        assetId: ASSET_ID,
        amount: "1000000",
        conversationId: CONVERSATION_ID,
        approvalId: "aitxt-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      transactionId: TRANSACTION_ID,
      depositAddress: DEPOSIT,
      depositMemo: null,
      amountIn: "1000000",
      amountInRaw: "1000000",
      expiresAt: EXPIRES_AT,
      tokenContract: "usdc.near",
      chainId: null,
      chainName: null,
      chainSlug: "near",
      decimals: 6,
      symbol: "USDC",
      runId: "run-1",
    });

    // Same asset in and out, origin-chain deposit, confidential recipient
    // and refund. The browser names no address.
    expect(createExecutionQuoteMock).toHaveBeenCalledWith({
      fromAssetId: ASSET_ID,
      toAssetId: ASSET_ID,
      amount: "1000000",
      recipient: ACCOUNT,
      refundTo: ACCOUNT,
      mode: "confidential-external",
      confidentiality: "basic",
      swapType: "FLEX_INPUT",
    });

    expect(createTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "submitted",
        recipient: ACCOUNT,
        refundTo: ACCOUNT,
        originAsset: ASSET_ID,
        destinationAsset: ASSET_ID,
        depositAddress: DEPOSIT,
        refs: {
          mode: "confidential-external",
          assetId: ASSET_ID,
          amount: "1000000",
          approvalId: "aitxt-1",
          conversationId: CONVERSATION_ID,
          toolApprovalId: "aitxt-1",
          depositAddress: DEPOSIT,
          depositMemo: null,
          expiresAt: EXPIRES_AT,
          amountInRaw: "1000000",
          tokenContract: "usdc.near",
          chainId: null,
          chainName: null,
          chainSlug: "near",
          decimals: 6,
          symbol: "USDC",
        },
      }),
    );

    expect(startMock).toHaveBeenCalledWith(swapLifecycleStub, [
      {
        transactionId: TRANSACTION_ID,
        depositAddress: DEPOSIT,
        expectedOut: execution.amountOutFormatted,
      },
    ]);
    expect(setTransactionRunIdMock).toHaveBeenCalledWith(
      TRANSACTION_ID,
      "run-1",
    );

    // No signed intent exists on this path, so there is no payload to store.
    const created = createTransactionMock.mock.calls[0][0] as {
      refs: Record<string, unknown>;
    };
    expect(created.refs).not.toHaveProperty("intentPayload");
    expect(created.refs).not.toHaveProperty("standard");
  });

  it("records the token, chain, and raw amount the QR needs", async () => {
    const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
    const ARB_ASSET = `nep141:arb-${ARB_USDC.toLowerCase()}.omft.near`;
    getAssetsMock.mockResolvedValue([
      {
        assetId: ARB_ASSET,
        symbol: "USDC",
        decimals: 6,
        chain: "arb",
        price: 1,
        contractAddress: ARB_USDC,
      },
    ]);
    createExecutionQuoteMock.mockResolvedValue({
      ...execution,
      fromAssetId: ARB_ASSET,
      toAssetId: ARB_ASSET,
      amountIn: "2000000",
      depositAddress: "0x1111111111111111111111111111111111111111",
    });

    const res = await POST(
      request({ assetId: ARB_ASSET, amount: "2000000", approvalId: "aitxt-1" }),
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      depositAddress: "0x1111111111111111111111111111111111111111",
      amountInRaw: "2000000",
      tokenContract: ARB_USDC,
      chainId: 42161,
      chainName: "Arbitrum One",
      chainSlug: "arb",
      decimals: 6,
      symbol: "USDC",
      expiresAt: EXPIRES_AT,
    });

    const created = createTransactionMock.mock.calls[0][0] as {
      refs: Record<string, unknown>;
    };
    expect(created.refs).toMatchObject({
      mode: "confidential-external",
      depositAddress: "0x1111111111111111111111111111111111111111",
      amountInRaw: "2000000",
      tokenContract: ARB_USDC,
      chainId: 42161,
      chainName: "Arbitrum One",
      chainSlug: "arb",
      decimals: 6,
      symbol: "USDC",
    });
  });

  it("rejects an asset that is not in the catalogue", async () => {
    getAssetsMock.mockResolvedValue([]);

    const res = await POST(
      request({ assetId: "nep141:not-a-real-asset", amount: "1000000" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "An error occurred." });
    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
  });

  it("rejects zero and non-integer amounts before pricing", async () => {
    for (const amount of ["0", "1.5", "-1", "01", "1e6"]) {
      const res = await POST(request({ assetId: ASSET_ID, amount }));
      expect(res.status, amount).toBe(400);
    }
    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
  });

  it("rejects a browser-supplied recipient instead of forwarding it", async () => {
    const res = await POST(
      request({
        assetId: ASSET_ID,
        amount: "1000000",
        recipient: "0x3602b546589a8fcafdce7fad64a46f91db0e4d50",
      }),
    );

    expect(res.status).toBe(400);
    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    requireSessionMock.mockResolvedValue(null);

    const res = await POST(
      request({ assetId: ASSET_ID, amount: "1000000" }),
    );

    expect(res.status).toBe(401);
    expect(createExecutionQuoteMock).not.toHaveBeenCalled();
  });

  it("starts nothing when the quote cannot be priced", async () => {
    createExecutionQuoteMock.mockRejectedValue(new Error("masked"));

    const res = await POST(
      request({ assetId: ASSET_ID, amount: "1000000" }),
    );

    expect(res.status).toBe(502);
    expect(createTransactionMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });
});
