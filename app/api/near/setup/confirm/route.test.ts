import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

const {
  requireSessionMock,
  checkRateLimitMock,
  readSetupPublicKeyMock,
  resolveNearSetupKeyMock,
  isIntentsKeyRegisteredMock,
  getNearSetupGrantMock,
  updateNearSetupGrantMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  readSetupPublicKeyMock: vi.fn(),
  resolveNearSetupKeyMock: vi.fn(),
  isIntentsKeyRegisteredMock: vi.fn(),
  getNearSetupGrantMock: vi.fn(),
  updateNearSetupGrantMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock("@/lib/intents/near-setup-server", () => ({
  readSetupPublicKey: readSetupPublicKeyMock,
  resolveNearSetupKey: resolveNearSetupKeyMock,
}));

vi.mock("@/lib/db/near-setup", () => ({
  getNearSetupGrant: getNearSetupGrantMock,
  updateNearSetupGrant: updateNearSetupGrantMock,
}));

vi.mock("@/lib/near/intents-keys", () => ({
  isIntentsKeyRegistered: isIntentsKeyRegisteredMock,
}));

import { POST } from "./route";

const KEY = "ed25519:C3jXhkGhEx88Gj7XKtUziJKXEBMRaJ67bWFkxJikVxZ2";

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

function request(): Request {
  return new Request("http://localhost/api/near/setup/confirm", {
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
  readSetupPublicKeyMock.mockReset().mockResolvedValue(KEY);
  resolveNearSetupKeyMock.mockReset().mockResolvedValue({ key: KEY });
  isIntentsKeyRegisteredMock.mockReset().mockResolvedValue(true);
  getNearSetupGrantMock.mockReset().mockResolvedValue({
    id: "grant-1",
    userId: "user-1",
    accountId: "myntlefinance.near",
    publicKey: KEY,
    amount: "1500000000000000000000",
    status: "final",
    txHash: "tx-hash",
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  updateNearSetupGrantMock.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/near/setup/confirm", () => {
  it("rejects a signed-out caller", async () => {
    requireSessionMock.mockResolvedValue(null);

    const res = await POST(request());

    expect(res.status).toBe(401);
  });

  it("confirms from the chain and marks the grant registered", async () => {
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      pending: false,
      publicKey: KEY,
    });
    expect(isIntentsKeyRegisteredMock).toHaveBeenCalledWith(
      "myntlefinance.near",
      KEY,
    );
    expect(updateNearSetupGrantMock).toHaveBeenCalledWith("grant-1", {
      status: "registered",
      error: null,
    });
  });

  it("asks the client to retry while the registration is not on chain", async () => {
    isIntentsKeyRegisteredMock.mockResolvedValue(false);

    const res = await POST(request());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, pending: true });
    expect(updateNearSetupGrantMock).not.toHaveBeenCalled();
  });

  it("reports a missing signer key instead of confirming", async () => {
    resolveNearSetupKeyMock.mockResolvedValue({ needsKey: true });

    const res = await POST(request());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      pending: false,
      needsKey: true,
    });
    expect(isIntentsKeyRegisteredMock).not.toHaveBeenCalled();
  });

  it("rate limits repeated confirmation attempts", async () => {
    checkRateLimitMock.mockReturnValue({ limited: true, retryAfterMs: 2_000 });

    const res = await POST(request());

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(isIntentsKeyRegisteredMock).not.toHaveBeenCalled();
  });
});
