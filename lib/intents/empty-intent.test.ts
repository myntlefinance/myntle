import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P0.5 measured that the User-Session proof is addressed to `intents.near`
 * with the live public `current_salt` (`252812b3` on 2026-11-02). The
 * confidential generated-intent salt (`e110f317`) was rejected, so the test
 * pins both the contract and the salt bytes rather than merely checking that
 * a nonce exists.
 */

const LIVE_SALT = new Uint8Array([0x25, 0x28, 0x12, 0xb3]); // 252812b3
const CONFIDENTIAL_SALT = new Uint8Array([0xe1, 0x10, 0xf3, 0x17]); // e110f317

const salt = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./salt", () => ({
  getIntentsSalt: salt.get,
}));

import { buildPasskeyEmptyIntent } from "./empty-intent";

const ACCOUNT = "0x4f3a7c1d2e5b8a9c0d1e2f3a4b5c6d7e8f901234";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function nonceOf(payload: string): Uint8Array {
  const parsed = JSON.parse(payload) as { nonce: string };
  return base64ToBytes(parsed.nonce);
}

beforeEach(() => {
  salt.get.mockReset();
  salt.get.mockResolvedValue({ hex: "252812b3", bytes: LIVE_SALT });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildPasskeyEmptyIntent", () => {
  it("addresses the public verifier with an empty intent", async () => {
    const built = await buildPasskeyEmptyIntent(ACCOUNT);
    const parsed = JSON.parse(built.payload) as {
      signer_id: string;
      verifying_contract: string;
      deadline: string;
      nonce: string;
      intents: unknown[];
    };

    expect(built.standard).toBe("webauthn");
    expect(built.signerId).toBe(ACCOUNT);
    expect(parsed.signer_id).toBe(ACCOUNT);
    expect(parsed.verifying_contract).toBe("intents.near");
    expect(parsed.intents).toEqual([]);
    expect(parsed.deadline).toBe(built.deadline.toISOString());
  });

  it("writes the exact compact payload string in the documented key order", async () => {
    const built = await buildPasskeyEmptyIntent(ACCOUNT);
    const parsed = JSON.parse(built.payload) as { nonce: string };

    expect(Object.keys(parsed)).toEqual([
      "signer_id",
      "verifying_contract",
      "deadline",
      "nonce",
      "intents",
    ]);

    const expected = `{"signer_id":"${ACCOUNT}","verifying_contract":"intents.near","deadline":"${built.deadline.toISOString()}","nonce":"${parsed.nonce}","intents":[]}`;
    expect(built.payload).toBe(expected);
    expect(built.payload).toHaveLength(expected.length);
  });

  it("uses the live public salt, never the confidential one", async () => {
    const built = await buildPasskeyEmptyIntent(ACCOUNT);
    const nonce = nonceOf(built.payload);

    expect(salt.get).toHaveBeenCalledTimes(1);
    expect(nonce).toHaveLength(32);
    expect([...nonce.slice(0, 4)]).toEqual([86, 40, 246, 198]); // magic
    expect(nonce[4]).toBe(0); // version
    expect([...nonce.slice(5, 9)]).toEqual([...LIVE_SALT]);
    expect([...nonce.slice(5, 9)]).not.toEqual([...CONFIDENTIAL_SALT]);
    expect(built.nonceBytes).toEqual(nonce);
    expect(built.payload).not.toContain("4RDzFw"); // base64(e1 10 f3 17)
  });

  it("keeps the timestamped 15-byte tail and a five-minute deadline", async () => {
    const before = Date.now();
    const built = await buildPasskeyEmptyIntent(ACCOUNT);
    const nonce = nonceOf(built.payload);
    const view = new DataView(
      nonce.buffer,
      nonce.byteOffset,
      nonce.byteLength,
    );

    expect(view.getBigUint64(9, true)).toBe(
      BigInt(built.deadline.getTime()) * 1_000_000n,
    );
    expect(built.deadline.getTime() - before).toBeGreaterThanOrEqual(
      5 * 60_000 - 2_000,
    );
    expect(built.deadline.getTime() - before).toBeLessThanOrEqual(
      5 * 60_000 + 2_000,
    );

    // The auth endpoint checks this start time (P0.5): a ten-minute-old tail
    // returns `401 timestamp validation failed`.
    const startedAtNs = view.getBigUint64(17, true);
    const startedAtMs = Number(startedAtNs / 1_000_000n);
    expect(Math.abs(startedAtMs - Date.now())).toBeLessThan(2_000);
  });

  it("builds a fresh nonce for every call", async () => {
    const first = await buildPasskeyEmptyIntent(ACCOUNT);
    const second = await buildPasskeyEmptyIntent(ACCOUNT);

    expect(nonceOf(first.payload)).not.toEqual(nonceOf(second.payload));
  });
});
