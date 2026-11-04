import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, supabaseMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  supabaseMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, getSession: getSessionMock };
});

vi.mock("@/lib/db/client", () => ({
  getSupabaseAdmin: () => supabaseMock(),
}));

// The relying party is deployment configuration, never the request's host.
vi.mock("@/lib/auth/webauthn-config", () => ({
  getWebAuthnConfig: () => ({
    rpID: "myntle.xyz",
    rpName: "Myntle",
    origin: ["https://myntle.xyz"],
  }),
}));

import { NextRequest } from "next/server";
import {
  encodeP256PublicKey,
  encodeP256PublicKeyBase64,
} from "@/lib/auth/passkeys";
import { GET } from "./route";

const PASSKEY_BYTES = new Uint8Array(64).fill(0x11);
const PASSKEY_KEY = encodeP256PublicKey(PASSKEY_BYTES);
const ACCOUNT_ID = "0x7edf07ede58238026db3f90fc8032633b69b8de5";

function request(url = "http://localhost/api/auth/session") {
  return new NextRequest(url, {
    headers: { cookie: "myntle_session=session-id" },
  });
}

/** The one read the passkey branch makes: a single row by id. */
function passkeyTable(row: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: row, error: row ? null : {} }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  getSessionMock.mockReset();
  supabaseMock.mockReset();
  supabaseMock.mockImplementation(() => {
    throw new Error("a wallet session must not read the passkey table");
  });
});

describe("/api/auth/session for a wallet", () => {
  it("keeps chain and address and adds accountKind and intentsAccountId", async () => {
    getSessionMock.mockResolvedValue({
      userId: "user-1",
      accountKind: "wallet",
      walletId: "wallet-1",
      passkeyId: null,
      intentsAccountId: "0x3259abcdef12345678901073abcdef1234567890",
      chain: "evm",
      address: "0x3259ABCDEF12345678901073ABCDEF1234567890",
      createdAt: Date.now() - 1_000,
      expiresAt: Date.now() + 1_000,
    });

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      authenticated: true,
      accountKind: "wallet",
      intentsAccountId: "0x3259abcdef12345678901073abcdef1234567890",
      chain: "evm",
      address: "0x3259ABCDEF12345678901073ABCDEF1234567890",
    });
    // The relying party belongs to the passkey signer only.
    expect(body.rpId).toBeUndefined();
    expect(supabaseMock).not.toHaveBeenCalled();
  });

  it("stays signed out when no session row exists", async () => {
    getSessionMock.mockResolvedValue(null);

    const res = await GET(request());

    expect(await res.json()).toEqual({ authenticated: false });
  });
});

describe("/api/auth/session for a passkey", () => {
  function passkeySession() {
    getSessionMock.mockResolvedValue({
      userId: "user-2",
      accountKind: "passkey",
      walletId: null,
      passkeyId: "passkey-1",
      intentsAccountId: ACCOUNT_ID,
      chain: "near",
      address: ACCOUNT_ID,
      createdAt: Date.now() - 1_000,
      expiresAt: Date.now() + 1_000,
    });
    supabaseMock.mockReturnValue(
      passkeyTable({
        credential_id: "credential-1",
        p256_public_key: encodeP256PublicKeyBase64(PASSKEY_BYTES),
        account_id: ACCOUNT_ID,
        revoked_at: null,
      }),
    );
  }

  it("returns the configured rpId with the credential and public key", async () => {
    passkeySession();

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: true,
      accountKind: "passkey",
      accountId: ACCOUNT_ID,
      intentsAccountId: ACCOUNT_ID,
      credentialId: "credential-1",
      publicKey: PASSKEY_KEY,
      rpId: "myntle.xyz",
      chain: "near",
      address: ACCOUNT_ID,
    });
  });

  it("takes the rpId from configuration, never from the request host", async () => {
    passkeySession();

    const res = await GET(
      request("https://some-preview.vercel.app/api/auth/session"),
    );

    const body = await res.json();
    expect(body.rpId).toBe("myntle.xyz");
  });

  it("stays signed out when the passkey row cannot sign", async () => {
    getSessionMock.mockResolvedValue({
      userId: "user-2",
      accountKind: "passkey",
      walletId: null,
      passkeyId: "passkey-1",
      intentsAccountId: ACCOUNT_ID,
      chain: "near",
      address: ACCOUNT_ID,
      createdAt: Date.now() - 1_000,
      expiresAt: Date.now() + 1_000,
    });
    supabaseMock.mockReturnValue(
      passkeyTable({
        credential_id: "credential-1",
        p256_public_key: "short",
        account_id: ACCOUNT_ID,
        revoked_at: null,
      }),
    );

    const res = await GET(request());

    expect(await res.json()).toEqual({ authenticated: false });
  });
});
