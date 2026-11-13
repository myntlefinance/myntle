import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

const {
  requireSessionMock,
  checkRateLimitMock,
  clientIpMock,
  getNearSetupStateMock,
  readSetupPublicKeyMock,
  countNearSetupGrantsSinceMock,
  createNearSetupGrantMock,
  updateNearSetupGrantMock,
  nearSetupConfiguredMock,
  nearSetupDailyGrantsMock,
  nearSetupFaucetReadyMock,
  nearSetupGrantYoctoMock,
  sendNearSetupGrantMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  clientIpMock: vi.fn(),
  getNearSetupStateMock: vi.fn(),
  readSetupPublicKeyMock: vi.fn(),
  countNearSetupGrantsSinceMock: vi.fn(),
  createNearSetupGrantMock: vi.fn(),
  updateNearSetupGrantMock: vi.fn(),
  nearSetupConfiguredMock: vi.fn(),
  nearSetupDailyGrantsMock: vi.fn(),
  nearSetupFaucetReadyMock: vi.fn(),
  nearSetupGrantYoctoMock: vi.fn(),
  sendNearSetupGrantMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  clientIp: clientIpMock,
}));

vi.mock("@/lib/intents/near-setup-server", () => ({
  getNearSetupState: getNearSetupStateMock,
  readSetupPublicKey: readSetupPublicKeyMock,
}));

vi.mock("@/lib/db/near-setup", () => ({
  countNearSetupGrantsSince: countNearSetupGrantsSinceMock,
  createNearSetupGrant: createNearSetupGrantMock,
  updateNearSetupGrant: updateNearSetupGrantMock,
}));

vi.mock("@/lib/near/intents-keys", () => ({
  nearSetupConfigured: nearSetupConfiguredMock,
  nearSetupDailyGrants: nearSetupDailyGrantsMock,
  nearSetupFaucetReady: nearSetupFaucetReadyMock,
  nearSetupGrantYocto: nearSetupGrantYoctoMock,
  sendNearSetupGrant: sendNearSetupGrantMock,
}));

import { POST } from "./route";

const KEY = "ed25519:C3jXhkGhEx88Gj7XKtUziJKXEBMRaJ67bWFkxJikVxZ2";
const AMOUNT = "1500000000000000000000";

const session: Session = {
  userId: "user-1",
  accountKind: "wallet",
  walletId: "wallet-1",
  passkeyId: null,
  intentsAccountId: "myntlefinance.near",
  publicKey: KEY,
  chain: "near",
  address: "myntlefinance.near",
  createdAt: Date.now() - 1000,
  expiresAt: Date.now() + 60_000,
};

function fundingState(overrides: Record<string, unknown> = {}) {
  return {
    needsSetup: true,
    registered: false,
    publicKey: KEY,
    amountNear: "0.0015",
    amountYocto: AMOUNT,
    balanceYocto: "1",
    hasGas: false,
    needsFunding: true,
    grant: null,
    ...overrides,
  };
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    userId: "user-1",
    accountId: "myntlefinance.near",
    publicKey: KEY,
    amount: AMOUNT,
    status: "pending",
    txHash: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function request(): Request {
  return new Request("http://localhost/api/near/setup/fund", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: KEY }),
  });
}

beforeEach(() => {
  requireSessionMock.mockReset().mockResolvedValue(session);
  checkRateLimitMock
    .mockReset()
    .mockReturnValue({ limited: false, retryAfterMs: 0 });
  clientIpMock.mockReset().mockReturnValue("127.0.0.1");
  getNearSetupStateMock.mockReset().mockResolvedValue(fundingState());
  readSetupPublicKeyMock.mockReset().mockResolvedValue(KEY);
  countNearSetupGrantsSinceMock.mockReset().mockResolvedValue(0);
  createNearSetupGrantMock
    .mockReset()
    .mockResolvedValue({ created: true, grant: grant() });
  updateNearSetupGrantMock.mockReset().mockResolvedValue(undefined);
  nearSetupConfiguredMock.mockReset().mockReturnValue(true);
  nearSetupDailyGrantsMock.mockReset().mockReturnValue(50);
  nearSetupFaucetReadyMock.mockReset().mockResolvedValue(true);
  nearSetupGrantYoctoMock.mockReset().mockReturnValue(AMOUNT);
  sendNearSetupGrantMock
    .mockReset()
    .mockResolvedValue({ hash: "tx-hash", faucetAccountId: "setup.myntle.near" });
});

describe("POST /api/near/setup/fund", () => {
  it("rejects a signed-out caller", async () => {
    requireSessionMock.mockResolvedValue(null);

    const res = await POST(request());

    expect(res.status).toBe(401);
  });

  it("rate limits before reading the chain or sending", async () => {
    checkRateLimitMock.mockReturnValue({ limited: true, retryAfterMs: 30_000 });

    const res = await POST(request());

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(getNearSetupStateMock).not.toHaveBeenCalled();
    expect(sendNearSetupGrantMock).not.toHaveBeenCalled();
  });

  it("does not send when a grant already exists", async () => {
    getNearSetupStateMock.mockResolvedValue(
      fundingState({
        needsFunding: false,
        grant: { status: "final", txHash: "tx-hash", error: null },
      }),
    );

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(sendNearSetupGrantMock).not.toHaveBeenCalled();
    expect(createNearSetupGrantMock).not.toHaveBeenCalled();
  });

  it("does not send when the key is already registered", async () => {
    getNearSetupStateMock.mockResolvedValue({
      needsSetup: false,
      registered: true,
      publicKey: KEY,
    });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(sendNearSetupGrantMock).not.toHaveBeenCalled();
  });

  it("returns 503 without a grant row when the faucet is not configured", async () => {
    nearSetupConfiguredMock.mockReturnValue(false);

    const res = await POST(request());

    expect(res.status).toBe(503);
    expect(createNearSetupGrantMock).not.toHaveBeenCalled();
    expect(sendNearSetupGrantMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the daily cap is reached", async () => {
    countNearSetupGrantsSinceMock.mockResolvedValue(50);

    const res = await POST(request());

    expect(res.status).toBe(503);
    expect(createNearSetupGrantMock).not.toHaveBeenCalled();
    expect(sendNearSetupGrantMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the faucet cannot cover the grant and its fee", async () => {
    nearSetupFaucetReadyMock.mockResolvedValue(false);

    const res = await POST(request());

    expect(res.status).toBe(503);
    expect(createNearSetupGrantMock).not.toHaveBeenCalled();
    expect(sendNearSetupGrantMock).not.toHaveBeenCalled();
  });

  it("does not send when another request won the grant row", async () => {
    createNearSetupGrantMock.mockResolvedValue({
      created: false,
      grant: grant({ status: "final", txHash: "other-tx" }),
    });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(sendNearSetupGrantMock).not.toHaveBeenCalled();
    expect(getNearSetupStateMock).toHaveBeenCalledTimes(2);
  });

  it("sends once, waits for finality, and marks the grant final", async () => {
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(createNearSetupGrantMock).toHaveBeenCalledWith({
      userId: "user-1",
      accountId: "myntlefinance.near",
      publicKey: KEY,
      amount: AMOUNT,
    });
    expect(sendNearSetupGrantMock).toHaveBeenCalledWith({
      receiverId: "myntlefinance.near",
      amountYocto: AMOUNT,
    });
    expect(updateNearSetupGrantMock).toHaveBeenCalledWith("grant-1", {
      status: "final",
      txHash: "tx-hash",
      error: null,
    });
    expect(await res.json()).toMatchObject({
      // The grant is final, so the dialog can register without another read.
      hasGas: true,
      needsFunding: false,
      grant: { status: "final", txHash: "tx-hash" },
    });
  });

  it("marks a failed transfer failed and never silently retries", async () => {
    sendNearSetupGrantMock.mockRejectedValue(new Error("rpc down"));

    const res = await POST(request());

    expect(res.status).toBe(502);
    expect(updateNearSetupGrantMock).toHaveBeenCalledWith("grant-1", {
      status: "failed",
      error: "The network-fee transfer could not be sent.",
    });
    expect(await res.json()).toMatchObject({
      needsFunding: false,
      grant: { status: "failed" },
    });
  });
});
