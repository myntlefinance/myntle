import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

const { requireSessionMock, getNearSetupStateMock, readSetupPublicKeyMock } =
  vi.hoisted(() => ({
    requireSessionMock: vi.fn(),
    getNearSetupStateMock: vi.fn(),
    readSetupPublicKeyMock: vi.fn(),
  }));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/intents/near-setup-server", () => ({
  getNearSetupState: getNearSetupStateMock,
  readSetupPublicKey: readSetupPublicKeyMock,
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
  return new Request("http://localhost/api/near/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

beforeEach(() => {
  requireSessionMock.mockReset();
  getNearSetupStateMock.mockReset();
  readSetupPublicKeyMock.mockReset().mockResolvedValue(null);
});

describe("POST /api/near/setup", () => {
  it("rejects a signed-out caller", async () => {
    requireSessionMock.mockResolvedValue(null);

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Log in to set up your super account.",
    });
  });

  it("never asks a non-NEAR session to set up", async () => {
    requireSessionMock.mockResolvedValue({ ...session, chain: "evm" });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      needsSetup: false,
      registered: false,
    });
    expect(getNearSetupStateMock).not.toHaveBeenCalled();
  });

  it("returns the server state for a named NEAR wallet", async () => {
    requireSessionMock.mockResolvedValue(session);
    readSetupPublicKeyMock.mockResolvedValue(KEY);
    const state = {
      needsSetup: true,
      registered: false,
      publicKey: KEY,
      amountNear: "0.0015",
      needsFunding: true,
      hasGas: false,
      grant: null,
    };
    getNearSetupStateMock.mockResolvedValue(state);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(state);
    expect(getNearSetupStateMock).toHaveBeenCalledWith(session, KEY);
  });

  it("masks a chain read failure", async () => {
    requireSessionMock.mockResolvedValue(session);
    getNearSetupStateMock.mockRejectedValue(new Error("rpc down"));

    const res = await POST(request());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "NEAR setup is unavailable right now. Try again later.",
    });
  });
});
