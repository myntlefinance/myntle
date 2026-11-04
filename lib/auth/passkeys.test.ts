import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/p256";
import bs58 from "bs58";
import { bytesToHex, concat, hexToBytes, keccak256 } from "viem";
import {
  base64UrlDecode,
  base64UrlEncode,
  decodeP256PublicKey,
  decodeP256PublicKeyBase64,
  derToRawSignature,
  encodeP256PublicKey,
  encodeP256PublicKeyBase64,
  intentsAccountIdForPasskey,
  parseCoseP256PublicKey,
  payloadChallenge,
  payloadDigest,
  verifyP256Signature,
  webAuthnSignedMessage,
} from "./passkeys";

/**
 * Public test data only. `VERIFIER` is the `defuse_core::payload::webauthn`
 * fixture published with the verifier source; `DOCS_VECTOR` is the account
 * derivation printed in `plans/passkeys/02-crypto-and-standards.md`.
 */
const VERIFIER = {
  payload:
    '{"signer_id":"0x3602b546589a8fcafdce7fad64a46f91db0e4d50","verifying_contract":"defuse.test.near","deadline":"2025-03-30T00:00:00Z","nonce":"A3nsY1GMVjzyXL3mUzOOP3KT+5a0Ruy+QDNWPhchnxM=","intents":[{"intent":"transfer","receiver_id":"user1.test.near","tokens":{"nep141:ft1.poa-factory.test.near":"1000"}}]}',
  publicKey:
    "p256:2V8Np9vGqLiwVZ8qmMmpkxU7CTRqje4WtwFeLimSwuuyF1rddQK5fELiMgxUnYbVjbZHCNnGc6fAe4JeDcVxgj3Q",
  publicKeyBase58:
    "2V8Np9vGqLiwVZ8qmMmpkxU7CTRqje4WtwFeLimSwuuyF1rddQK5fELiMgxUnYbVjbZHCNnGc6fAe4JeDcVxgj3Q",
  signerId: "0x3602b546589a8fcafdce7fad64a46f91db0e4d50",
  signatureBase58:
    "3KBMZ72BHUiVfE1ey5dpi3KgbXvSEf9kuxgBEax7qLBQtidZExxxjjQk1hTTGFRrPvUoEStfrjoFNVVW4Abar94W",
  challenge: "4cveZsIe6p-WaEcL-Lhtzt3SZuXbYsjDdlFhLNrSjjk",
  clientDataJSON:
    '{"type":"webauthn.get","challenge":"4cveZsIe6p-WaEcL-Lhtzt3SZuXbYsjDdlFhLNrSjjk","origin":"https://defuse-widget-git-feat-passkeys-defuse-94bbc1b2.vercel.app"}',
  authenticatorData: "933cQogpBzE3RSAYSAkfWoNEcBd3X84PxE8iRrRVxMgdAAAAAA==",
} as const;

const DOCS_VECTOR = {
  publicKey:
    "p256:3aMVMxsoAnHUbweXMtdKaN1uJaNwsfKv7wnc97SDGjXhyK62VyJwhPUPLZefKVthcoUcuWK6cqkSU4M542ipNxS3",
  accountId: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
} as const;

/**
 * Canonical COSE_Key for the verifier's P-256 public key:
 * {1: 2, 3: -7, -1: 1, -2: x, -3: y}, definite-length CBOR.
 */
const COSE_P256 =
  "pQECAyYgASFYIEpF1pRr_YAUdvyQE3sB1rPJrMfTAyIyZKX1VizOf2mhIlgg31aDZW58VjFyBPMhawNTbyabL_kqM_W8BEgu1YYqrDs";

function bigintTo32(value: bigint): Uint8Array {
  return hexToBytes(`0x${value.toString(16).padStart(64, "0")}`);
}

function highSRawSignature(raw: Uint8Array): Uint8Array {
  const parsed = p256.Signature.fromBytes(raw, "compact");
  return concat([
    bigintTo32(parsed.r),
    bigintTo32(p256.CURVE.n - parsed.s),
  ]);
}

/** Encodes only the small integer values these fixtures use. */
function coseKey(
  overrides: {
    kty?: number;
    alg?: number;
    crv?: number;
    x?: Uint8Array;
    y?: Uint8Array;
  } = {},
): Uint8Array {
  const publicKey = decodeP256PublicKey(VERIFIER.publicKey);
  const x = overrides.x ?? publicKey.subarray(0, 32);
  const y = overrides.y ?? publicKey.subarray(32);
  const smallInt = (value: number): number => {
    if (value >= 0 && value < 24) return value;
    if (value < 0 && value >= -24) return 0x20 + (-value - 1);
    throw new Error("The test fixture only encodes small integers.");
  };

  return new Uint8Array([
    0xa5,
    0x01,
    smallInt(overrides.kty ?? 2),
    0x03,
    smallInt(overrides.alg ?? -7),
    0x20,
    smallInt(overrides.crv ?? 1),
    0x21,
    0x58,
    x.length,
    ...x,
    0x22,
    0x58,
    y.length,
    ...y,
  ]);
}

describe("intentsAccountIdForPasskey", () => {
  it("derives the verifier fixture account", () => {
    expect(intentsAccountIdForPasskey(VERIFIER.publicKey)).toBe(
      VERIFIER.signerId,
    );
    expect(intentsAccountIdForPasskey(VERIFIER.publicKeyBase58)).toBe(
      VERIFIER.signerId,
    );
  });

  it("derives the vector printed in the plan", () => {
    expect(intentsAccountIdForPasskey(DOCS_VECTOR.publicKey)).toBe(
      DOCS_VECTOR.accountId,
    );
    expect(
      intentsAccountIdForPasskey(decodeP256PublicKey(DOCS_VECTOR.publicKey)),
    ).toBe(DOCS_VECTOR.accountId);
  });

  it("is not the EVM derivation", () => {
    const publicKey = decodeP256PublicKey(VERIFIER.publicKey);
    const evmStyle = `0x${keccak256(publicKey).slice(2 + 24)}`;
    expect(intentsAccountIdForPasskey(publicKey)).not.toBe(evmStyle);
  });
});

describe("payloadChallenge", () => {
  it("hashes the exact payload bytes to the verifier vector", () => {
    expect(payloadChallenge(VERIFIER.payload)).toBe(VERIFIER.challenge);
  });

  it("is unpadded base64url and 32 bytes", () => {
    const challenge = payloadChallenge(VERIFIER.payload);
    expect(challenge).not.toContain("=");
    expect(challenge).not.toMatch(/[+/]/);
    expect(base64UrlDecode(challenge)).toHaveLength(32);
    expect(payloadDigest(VERIFIER.payload)).toHaveLength(32);
  });

  it("changes when one byte of the payload changes", () => {
    expect(payloadChallenge(VERIFIER.payload.replace("1000", "1001"))).not.toBe(
      VERIFIER.challenge,
    );
  });
});

describe("P256 public key encoding", () => {
  it("round-trips 64-byte x||y through base58 and the p256: prefix", () => {
    const publicKey = decodeP256PublicKey(VERIFIER.publicKey);
    expect(publicKey).toHaveLength(64);
    expect(encodeP256PublicKey(publicKey)).toBe(VERIFIER.publicKey);
    expect(encodeP256PublicKey(VERIFIER.publicKeyBase58)).toBe(
      VERIFIER.publicKey,
    );
    expect(bytesToHex(decodeP256PublicKey(VERIFIER.publicKey))).toBe(
      bytesToHex(publicKey),
    );
  });

  it("round-trips the base64 storage form", () => {
    const publicKey = decodeP256PublicKey(VERIFIER.publicKey);
    const stored = encodeP256PublicKeyBase64(publicKey);
    expect(stored).toBe(
      "SkXWlGv9gBR2/JATewHWs8msx9MDIjJkpfVWLM5/aaHfVoNlbnxWMXIE8yFrA1NvJpsv+Soz9bwESC7VhiqsOw==",
    );
    expect(bytesToHex(decodeP256PublicKeyBase64(stored))).toBe(
      bytesToHex(publicKey),
    );
    expect(decodeP256PublicKeyBase64(stored)).toHaveLength(64);
  });

  it("rejects a compressed 33-byte key", () => {
    const point = p256.ProjectivePoint.fromHex(
      `04${bytesToHex(decodeP256PublicKey(VERIFIER.publicKey)).slice(2)}`,
    );
    const compressed = point.toRawBytes(true);
    expect(compressed).toHaveLength(33);
    expect(() => decodeP256PublicKey(bs58.encode(compressed))).toThrow(
      /compressed/i,
    );
    expect(() => intentsAccountIdForPasskey(compressed)).toThrow(/compressed/i);
  });

  it("rejects a 65-byte SEC1 key instead of stripping the 0x04 prefix", () => {
    const point = p256.ProjectivePoint.fromHex(
      `04${bytesToHex(decodeP256PublicKey(VERIFIER.publicKey)).slice(2)}`,
    );
    const uncompressed = point.toRawBytes(false);
    expect(uncompressed).toHaveLength(65);
    expect(uncompressed[0]).toBe(0x04);
    expect(() => decodeP256PublicKey(bs58.encode(uncompressed))).toThrow(
      /0x04/,
    );
    expect(() => encodeP256PublicKey(uncompressed)).toThrow(/0x04/);
    expect(() => intentsAccountIdForPasskey(uncompressed)).toThrow(/0x04/);
  });
});

describe("derToRawSignature", () => {
  it("round-trips a real assertion and keeps it low-S", () => {
    const raw = bs58.decode(VERIFIER.signatureBase58);
    const der = p256.Signature.fromBytes(raw, "compact").toBytes("der");

    const converted = derToRawSignature(der);
    expect(converted).toHaveLength(64);
    expect(bytesToHex(converted)).toBe(bytesToHex(raw));
    expect(
      p256.Signature.fromBytes(converted, "compact").hasHighS(),
    ).toBe(false);
  });

  it("normalizes a high-S input rather than rejecting it", () => {
    const raw = bs58.decode(VERIFIER.signatureBase58);
    const high = highSRawSignature(raw);
    const highDer = p256.Signature.fromBytes(high, "compact").toBytes("der");
    expect(
      p256.Signature.fromBytes(high, "compact").hasHighS(),
    ).toBe(true);

    const normalized = derToRawSignature(highDer);
    expect(bytesToHex(normalized)).toBe(bytesToHex(raw));
    expect(
      p256.Signature.fromBytes(normalized, "compact").hasHighS(),
    ).toBe(false);
  });

  it("rejects malformed DER rather than returning a zero signature", () => {
    expect(() => derToRawSignature(new Uint8Array([0x30, 0x00]))).toThrow(
      /DER/,
    );
    expect(() => derToRawSignature(new Uint8Array(64))).toThrow(/DER/);
  });
});

describe("verifyP256Signature", () => {
  it("verifies the real WebAuthn assertion", () => {
    const authenticatorData = base64UrlDecode(VERIFIER.authenticatorData);
    const message = webAuthnSignedMessage({
      authenticatorData,
      clientDataJSON: VERIFIER.clientDataJSON,
    });
    expect(message).toHaveLength(authenticatorData.length + 32);

    expect(
      verifyP256Signature({
        publicKey: VERIFIER.publicKey,
        signature: VERIFIER.signatureBase58,
        message,
      }),
    ).toBe(true);
    expect(
      verifyP256Signature({
        publicKey: VERIFIER.publicKey,
        signature: `p256:${VERIFIER.signatureBase58}`,
        message,
      }),
    ).toBe(true);
  });

  it("rejects a tampered message and a high-S signature", () => {
    const authenticatorData = base64UrlDecode(VERIFIER.authenticatorData);
    const message = webAuthnSignedMessage({
      authenticatorData,
      clientDataJSON: VERIFIER.clientDataJSON,
    });
    const high = highSRawSignature(bs58.decode(VERIFIER.signatureBase58));

    expect(
      verifyP256Signature({
        publicKey: VERIFIER.publicKey,
        signature: VERIFIER.signatureBase58,
        message: concat([message, new Uint8Array([0])]),
      }),
    ).toBe(false);
    expect(
      verifyP256Signature({
        publicKey: VERIFIER.publicKey,
        signature: high,
        message,
      }),
    ).toBe(false);
  });

  it("returns false for a malformed key instead of throwing", () => {
    expect(
      verifyP256Signature({
        publicKey: new Uint8Array(33).fill(2),
        signature: bs58.decode(VERIFIER.signatureBase58),
        message: new Uint8Array([1]),
      }),
    ).toBe(false);
  });
});

describe("parseCoseP256PublicKey", () => {
  it("parses the canonical ES256 fixture", () => {
    expect(base64UrlEncode(coseKey())).toBe(COSE_P256);

    const parsed = parseCoseP256PublicKey(COSE_P256);
    expect(bytesToHex(parsed)).toBe(
      bytesToHex(bs58.decode(VERIFIER.publicKeyBase58)),
    );
    expect(intentsAccountIdForPasskey(parsed)).toBe(VERIFIER.signerId);
    expect(
      bytesToHex(parseCoseP256PublicKey(base64UrlDecode(COSE_P256))),
    ).toBe(bytesToHex(parsed));
  });

  it("rejects a key that is not EC2, ES256, and P-256", () => {
    expect(() => parseCoseP256PublicKey(coseKey({ kty: 1 }))).toThrow(/EC2/);
    expect(() => parseCoseP256PublicKey(coseKey({ alg: -8 }))).toThrow(
      /ES256/,
    );
    expect(() => parseCoseP256PublicKey(coseKey({ crv: 2 }))).toThrow(
      /P-256/,
    );
  });

  it("rejects coordinates that are not 32 bytes", () => {
    const publicKey = decodeP256PublicKey(VERIFIER.publicKey);
    expect(() =>
      parseCoseP256PublicKey(coseKey({ x: publicKey.subarray(0, 31) })),
    ).toThrow(/x coordinate/);
    expect(() =>
      parseCoseP256PublicKey(coseKey({ y: publicKey.subarray(0, 31) })),
    ).toThrow(/y coordinate/);
  });

  it("rejects data that is not CBOR", () => {
    expect(() => parseCoseP256PublicKey(new Uint8Array([0xff]))).toThrow(
      /COSE/,
    );
  });
});
