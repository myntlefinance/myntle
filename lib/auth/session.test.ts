import { describe, expect, it } from "vitest";
import {
  resolveIntentsAccountId,
  sessionFromRow,
  type SessionRow,
} from "./session";

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    user_id: "user-1",
    wallet_id: "wallet-1",
    chain: "evm",
    address: "0x3259ABCDEF12345678901073ABCDEF1234567890",
    created_at: new Date(NOW - 60_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    ...overrides,
  };
}

describe("resolveIntentsAccountId", () => {
  it("derives an EVM account from a legacy row without a stored value", () => {
    expect(
      resolveIntentsAccountId(
        "evm",
        "0x3259ABCDEF12345678901073ABCDEF1234567890",
        null,
      ),
    ).toBe("0x3259abcdef12345678901073abcdef1234567890");
  });

  it("derives a named NEAR account and a Solana implicit account", () => {
    expect(resolveIntentsAccountId("near", "alice.near")).toBe("alice.near");
    expect(
      resolveIntentsAccountId("solana", "11111111111111111111111111111111"),
    ).toBe("0".repeat(64));
  });

  it("prefers a stored value, which is how a passkey account keeps its id", () => {
    expect(
      resolveIntentsAccountId("near", "0xaccount", "0xstored-account"),
    ).toBe("0xstored-account");
  });

  it("falls back to the address when a legacy address cannot be decoded", () => {
    expect(resolveIntentsAccountId("solana", "not-an-address")).toBe(
      "not-an-address",
    );
  });
});

describe("sessionFromRow", () => {
  it("maps a legacy wallet row with no account columns to a wallet session", () => {
    const session = sessionFromRow(
      row({
        account_kind: null,
        passkey_id: null,
        intents_account_id: null,
      }),
      NOW,
    );

    expect(session).toEqual({
      userId: "user-1",
      accountKind: "wallet",
      walletId: "wallet-1",
      passkeyId: null,
      intentsAccountId: "0x3259abcdef12345678901073abcdef1234567890",
      chain: "evm",
      address: "0x3259ABCDEF12345678901073ABCDEF1234567890",
      createdAt: NOW - 60_000,
      expiresAt: NOW + 60_000,
    });
  });

  it("treats an absent account_kind as a wallet", () => {
    const session = sessionFromRow(
      row({
        chain: "near",
        address: "alice.near",
        wallet_id: "wallet-near",
        intents_account_id: null,
      }),
      NOW,
    );
    expect(session?.accountKind).toBe("wallet");
    expect(session?.intentsAccountId).toBe("alice.near");
  });

  it("derives the Solana implicit account for a legacy session", () => {
    const session = sessionFromRow(
      row({
        chain: "solana",
        address: "11111111111111111111111111111111",
        wallet_id: null,
      }),
      NOW,
    );
    expect(session?.intentsAccountId).toBe("0".repeat(64));
  });

  it("maps a passkey row with its stored signer and account", () => {
    const session = sessionFromRow(
      row({
        account_kind: "passkey",
        wallet_id: null,
        passkey_id: "passkey-1",
        intents_account_id: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
        chain: "near",
        address: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
      }),
      NOW,
    );

    expect(session?.accountKind).toBe("passkey");
    expect(session?.passkeyId).toBe("passkey-1");
    expect(session?.walletId).toBeNull();
    expect(session?.chain).toBe("near");
    expect(session?.intentsAccountId).toBe(
      "0x7edf07ede58238026db3f90fc8032633b69b8de5",
    );
  });

  it("rejects a passkey row with no passkey id", () => {
    expect(
      sessionFromRow(
        row({
          account_kind: "passkey",
          wallet_id: null,
          passkey_id: null,
          intents_account_id: "0xaccount",
          chain: "near",
          address: "0xaccount",
        }),
        NOW,
      ),
    ).toBeNull();
  });

  it("rejects revoked, expired, and unknowable rows", () => {
    expect(
      sessionFromRow(row({ revoked_at: new Date(NOW).toISOString() }), NOW),
    ).toBeNull();
    expect(
      sessionFromRow(row({ expires_at: new Date(NOW).toISOString() }), NOW),
    ).toBeNull();
    expect(sessionFromRow(row({ chain: "cosmos" }), NOW)).toBeNull();
    expect(sessionFromRow(row({ created_at: "not-a-date" }), NOW)).toBeNull();
  });
});
