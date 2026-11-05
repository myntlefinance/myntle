import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/p256";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  bytesToHex,
  concat,
  hexToBytes,
  sha256,
  stringToBytes,
} from "viem";
import {
  base64UrlEncode,
  encodeP256PublicKey,
  intentsAccountIdForPasskey,
  payloadChallenge,
  webAuthnSignedMessage,
} from "@/lib/auth/passkeys";
import {
  intentHashForPayload,
  verifyIntent,
  type VerifyIntentInput,
} from "./verify-intent";

/**
 * Everything here is generated locally: a P-256 key, a real ES256 assertion,
 * a real ERC-191 signature, and a real Ed25519 signature. No network, no
 * database, no funds, and no stored secret. The payload mirrors the measured
 * P0.3 shape (a single transfer to the quote's deposit address).
 */

const RP_ID = "localhost";
const ORIGIN = "http://localhost:3000";

const DEPOSIT_ADDRESS =
  "e0240dfbadb1bd03ec5f5e1c93899f59a80f1307354d534bd10563d566897a43";
const OTHER_DEPOSIT_ADDRESS = "f".repeat(64);
const ASSET_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const TOKEN_ID = `imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${ASSET_ID}`;
const AMOUNT_IN = "500000";
const DEADLINE = "2026-11-05T11:28:18.215Z";
const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const NONCE = "A3nsY1GMVjzyXL3mUzOOP3KT+5a0Ruy+QDNWPhchnxM=";

const PRIVATE_KEY = p256.utils.randomPrivateKey();
const PUBLIC_KEY_BYTES = p256.getPublicKey(PRIVATE_KEY, false).subarray(1);
const PUBLIC_KEY = encodeP256PublicKey(PUBLIC_KEY_BYTES);
const SIGNER_ID = intentsAccountIdForPasskey(PUBLIC_KEY_BYTES);

function intentPayload(
  overrides: {
    signerId?: string;
    contract?: string;
    deadline?: string;
    receiver?: string;
    amount?: string;
    tokenId?: string;
  } = {},
): string {
  return JSON.stringify({
    verifying_contract: overrides.contract ?? "intents.far",
    signer_id: overrides.signerId ?? SIGNER_ID,
    deadline: overrides.deadline ?? DEADLINE,
    nonce: NONCE,
    intents: [
      {
        intent: "transfer",
        receiver_id: overrides.receiver ?? DEPOSIT_ADDRESS,
        tokens: {
          [overrides.tokenId ?? TOKEN_ID]: overrides.amount ?? AMOUNT_IN,
        },
      },
    ],
  });
}

function clientDataJSON(
  payload: string,
  options: {
    challenge?: string;
    origin?: string;
    type?: string;
    crossOrigin?: boolean;
  } = {},
): string {
  const data: Record<string, unknown> = {
    type: options.type ?? "webauthn.get",
    challenge: options.challenge ?? payloadChallenge(payload),
    origin: options.origin ?? ORIGIN,
  };
  if (options.crossOrigin !== undefined) data.crossOrigin = options.crossOrigin;
  return JSON.stringify(data);
}

function authenticatorData(
  options: { rpId?: string; flags?: number } = {},
): Uint8Array {
  return concat([
    hexToBytes(sha256(stringToBytes(options.rpId ?? RP_ID))),
    new Uint8Array([options.flags ?? 0x1d]),
    new Uint8Array([0, 0, 0, 0]),
  ]);
}

/**
 * Signs exactly what WebAuthn signs. `@noble/curves` 1.x P-256 produces
 * high-S about half the time, so the helper pins the requested parity;
 * the high-S fixture is the one case the verifier must reject.
 */
function signAssertion(
  message: Uint8Array,
  privateKey: Uint8Array,
  highS: boolean,
): Uint8Array {
  const digest = hexToBytes(sha256(message));
  const signature = p256.sign(digest, privateKey);
  const flipped =
    signature.hasHighS() === highS
      ? signature
      : new p256.Signature(signature.r, p256.CURVE.n - signature.s);
  return flipped.toBytes("compact");
}

function assertion(options: {
  payload: string;
  clientData?: string;
  authData?: Uint8Array;
  privateKey?: Uint8Array;
  publicKey?: string;
  highS?: boolean;
}): Record<string, unknown> {
  const authData = options.authData ?? authenticatorData();
  const clientData = options.clientData ?? clientDataJSON(options.payload);
  const signature = signAssertion(
    webAuthnSignedMessage({ authenticatorData: authData, clientDataJSON: clientData }),
    options.privateKey ?? PRIVATE_KEY,
    options.highS === true,
  );

  return {
    standard: "webauthn",
    payload: options.payload,
    public_key: options.publicKey ?? PUBLIC_KEY,
    signature: `p256:${bs58.encode(signature)}`,
    client_data_json: clientData,
    authenticator_data: base64UrlEncode(authData),
  };
}

function baseInput(overrides: Partial<VerifyIntentInput> = {}): VerifyIntentInput {
  const payload = overrides.payload ?? intentPayload();
  const stringPayload = typeof payload === "string" ? payload : intentPayload();

  return {
    signedData: assertion({ payload: stringPayload }),
    payload,
    signerId: SIGNER_ID,
    standard: "webauthn",
    mode: "confidential",
    depositAddress: DEPOSIT_ADDRESS,
    amountIn: AMOUNT_IN,
    assetId: ASSET_ID,
    deadline: DEADLINE,
    accountKind: "passkey",
    chain: "near",
    passkeyPublicKey: PUBLIC_KEY,
    webauthn: { rpID: RP_ID, origins: [ORIGIN] },
    now: NOW,
    ...overrides,
  };
}

async function reasonFor(input: VerifyIntentInput): Promise<string> {
  const result = await verifyIntent(input);
  if (result.ok) throw new Error("expected a rejection, got a success");
  return result.reason;
}

describe("verifyIntent (WebAuthn)", () => {
  it("accepts a valid assertion and computes the intent hash", async () => {
    const payload = intentPayload();
    const result = await verifyIntent(baseInput());

    expect(result).toEqual({
      ok: true,
      standard: "webauthn",
      intentHash: intentHashForPayload(payload),
    });
    expect(result.ok && result.intentHash).toBe(
      bs58.encode(hexToBytes(sha256(stringToBytes(payload)))),
    );
  });

  it("accepts an intents.near payload on the public path", async () => {
    const payload = intentPayload({ contract: "intents.near" });
    const result = await verifyIntent(baseInput({ payload, mode: "public" }));
    expect(result.ok).toBe(true);
  });

  it("rejects a payload signed for the wrong challenge", async () => {
    const payload = intentPayload();
    const signedData = assertion({
      payload,
      clientData: clientDataJSON(payload, {
        challenge: payloadChallenge(`${payload}x`),
      }),
    });
    expect(await reasonFor(baseInput({ signedData }))).toBe("challenge-mismatch");
  });

  it("rejects an assertion from a foreign origin", async () => {
    const payload = intentPayload();
    const signedData = assertion({
      payload,
      clientData: clientDataJSON(payload, { origin: "https://evil.example" }),
    });
    expect(await reasonFor(baseInput({ signedData }))).toBe("origin-mismatch");
  });

  it("rejects an assertion flagged cross-origin", async () => {
    const payload = intentPayload();
    const signedData = assertion({
      payload,
      clientData: clientDataJSON(payload, { crossOrigin: true }),
    });
    expect(await reasonFor(baseInput({ signedData }))).toBe("cross-origin");
  });

  it("rejects a clientDataJSON that is not a webauthn.get", async () => {
    const payload = intentPayload();
    const signedData = assertion({
      payload,
      clientData: clientDataJSON(payload, { type: "webauthn.create" }),
    });
    expect(await reasonFor(baseInput({ signedData }))).toBe("client-data-type");
  });

  it("rejects an assertion without user verification", async () => {
    const payload = intentPayload();
    const signedData = assertion({
      payload,
      authData: authenticatorData({ flags: 0x19 }),
    });
    expect(await reasonFor(baseInput({ signedData }))).toBe(
      "user-verification-required",
    );
  });

  it("rejects an assertion without user presence", async () => {
    const payload = intentPayload();
    const signedData = assertion({
      payload,
      authData: authenticatorData({ flags: 0x1c }),
    });
    expect(await reasonFor(baseInput({ signedData }))).toBe(
      "user-presence-required",
    );
  });

  it("rejects a backup-state flag without backup eligibility", async () => {
    const payload = intentPayload();
    const signedData = assertion({
      payload,
      authData: authenticatorData({ flags: 0x15 }),
    });
    expect(await reasonFor(baseInput({ signedData }))).toBe(
      "backup-flags-invalid",
    );
  });

  it("rejects the wrong relying-party id", async () => {
    const payload = intentPayload();
    const signedData = assertion({
      payload,
      authData: authenticatorData({ rpId: "evil.example" }),
    });
    expect(await reasonFor(baseInput({ signedData }))).toBe("rp-id-mismatch");
  });

  it("rejects a high-S signature", async () => {
    const payload = intentPayload();
    const signedData = assertion({ payload, highS: true });
    expect(await reasonFor(baseInput({ signedData }))).toBe("signature-high-s");
  });

  it("rejects a signature from another key", async () => {
    const payload = intentPayload();
    const signedData = assertion({
      payload,
      privateKey: p256.utils.randomPrivateKey(),
    });
    expect(await reasonFor(baseInput({ signedData }))).toBe("signature-invalid");
  });

  it("rejects a public key that differs from the stored passkey", async () => {
    const payload = intentPayload();
    const otherKey = p256.getPublicKey(p256.utils.randomPrivateKey(), false).subarray(1);
    const signedData = assertion({
      payload,
      publicKey: encodeP256PublicKey(otherKey),
    });
    expect(await reasonFor(baseInput({ signedData }))).toBe("public-key-mismatch");
  });

  it("rejects malformed base64 authenticator data", async () => {
    const payload = intentPayload();
    const signedData = { ...assertion({ payload }), authenticator_data: "not base64 ###" };
    expect(await reasonFor(baseInput({ signedData }))).toBe(
      "authenticator-data-malformed",
    );
  });

  it("rejects a payload whose signer_id is another account", async () => {
    const payload = intentPayload({ signerId: `0x${"1".repeat(40)}` });
    expect(await reasonFor(baseInput({ payload }))).toBe("signer-mismatch");
  });

  it("rejects intents.near on the confidential swap path", async () => {
    const payload = intentPayload({ contract: "intents.near" });
    expect(await reasonFor(baseInput({ payload }))).toBe("contract-mismatch");
  });

  it("rejects a transfer to another deposit address", async () => {
    const payload = intentPayload({ receiver: OTHER_DEPOSIT_ADDRESS });
    expect(await reasonFor(baseInput({ payload }))).toBe("deposit-mismatch");
  });

  it("rejects a different amount", async () => {
    const payload = intentPayload({ amount: "1" });
    expect(await reasonFor(baseInput({ payload }))).toBe("amount-mismatch");
  });

  it("rejects a different token id", async () => {
    const payload = intentPayload({ tokenId: "imt:deadbeef:nep141:other.near" });
    expect(await reasonFor(baseInput({ payload }))).toBe("token-mismatch");
  });

  it("rejects a payload changed after signing", async () => {
    const input = baseInput();
    input.payload = `${intentPayload()} `;
    expect(await reasonFor(input)).toBe("payload-mismatch");
  });

  it("rejects a deadline that does not match the stored quote", async () => {
    const payload = intentPayload({ deadline: "2026-11-04T00:00:00.000Z" });
    expect(await reasonFor(baseInput({ payload }))).toBe("deadline-mismatch");
  });

  it("rejects an expired payload whose deadline matches the quote", async () => {
    const deadline = "2020-01-01T00:00:00.000Z";
    const payload = intentPayload({ deadline });
    expect(await reasonFor(baseInput({ payload, deadline }))).toBe(
      "deadline-expired",
    );
  });

  it("rejects a standard that differs from the pinned one", async () => {
    const payload = intentPayload();
    const signedData = { ...assertion({ payload }), standard: "erc191" };
    expect(await reasonFor(baseInput({ signedData }))).toBe("standard-mismatch");
  });

  it("rejects a wallet standard on a passkey account", async () => {
    const payload = intentPayload();
    const signedData = { ...assertion({ payload }), standard: "erc191" };
    expect(
      await reasonFor(baseInput({ signedData, standard: "erc191" })),
    ).toBe("account-kind-mismatch");
  });
});

describe("verifyIntent (wallet standards)", () => {
  function walletPayload(signerId: string): string {
    return JSON.stringify({
      verifying_contract: "intents.near",
      signer_id: signerId,
      deadline: DEADLINE,
      nonce: NONCE,
      intents: [
        {
          intent: "transfer",
          receiver_id: DEPOSIT_ADDRESS,
          tokens: { [TOKEN_ID]: AMOUNT_IN },
        },
      ],
    });
  }

  function walletInput(
    payload: string,
    overrides: Partial<VerifyIntentInput> = {},
  ): VerifyIntentInput {
    return {
      signedData: { standard: "erc191", payload, signature: "0x00" },
      payload,
      signerId: "",
      standard: "erc191",
      mode: "public",
      depositAddress: DEPOSIT_ADDRESS,
      amountIn: AMOUNT_IN,
      assetId: ASSET_ID,
      deadline: DEADLINE,
      accountKind: "wallet",
      chain: "evm",
      webauthn: { rpID: RP_ID, origins: [ORIGIN] },
      now: NOW,
      ...overrides,
    };
  }

  it("accepts a real erc191 signature", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const payload = walletPayload(account.address.toLowerCase());
    const signature = await account.signMessage({ message: payload });

    const result = await verifyIntent(
      walletInput(payload, {
        signedData: { standard: "erc191", payload, signature },
        signerId: account.address.toLowerCase(),
        address: account.address,
      }),
    );

    expect(result).toEqual({ ok: true, standard: "erc191" });
  });

  it("accepts the MultiPayload secp256k1 shape", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const payload = walletPayload(account.address.toLowerCase());
    const signature = await account.signMessage({ message: payload });
    const bytes = hexToBytes(signature);
    // The wire form is `secp256k1:<base58(65 bytes)>` with v normalized 0/1.
    if (bytes[64] === 27 || bytes[64] === 28) bytes[64] -= 27;

    const result = await verifyIntent(
      walletInput(payload, {
        signedData: {
          standard: "erc191",
          payload,
          signature: `secp256k1:${bs58.encode(bytes)}`,
        },
        signerId: account.address.toLowerCase(),
        address: account.address,
      }),
    );

    expect(result).toEqual({ ok: true, standard: "erc191" });
  });

  it("rejects a wallet standard that does not match the session chain", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const payload = walletPayload(account.address.toLowerCase());
    const signature = await account.signMessage({ message: payload });

    const input = walletInput(payload, {
      signedData: { standard: "erc191", payload, signature },
      signerId: account.address.toLowerCase(),
      address: account.address,
      chain: "solana",
    });

    expect(await reasonFor(input)).toBe("standard-chain-mismatch");
  });

  it("rejects a signature from another wallet", async () => {
    const sessionAccount = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const payload = walletPayload(sessionAccount.address.toLowerCase());
    const signature = await other.signMessage({ message: payload });

    const input = walletInput(payload, {
      signedData: { standard: "erc191", payload, signature },
      signerId: sessionAccount.address.toLowerCase(),
      address: sessionAccount.address,
    });

    expect(await reasonFor(input)).toBe("signature-invalid");
  });

  it("rejects a tampered wallet payload", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const payload = walletPayload(account.address.toLowerCase());
    const signature = await account.signMessage({ message: payload });

    const input = walletInput(`${payload} `, {
      signedData: { standard: "erc191", payload, signature },
      signerId: account.address.toLowerCase(),
      address: account.address,
    });

    expect(await reasonFor(input)).toBe("payload-mismatch");
  });

  it("accepts a real raw_ed25519 signature", async () => {
    const keyPair = nacl.sign.keyPair();
    const address = bs58.encode(keyPair.publicKey);
    const signerId = bytesToHex(keyPair.publicKey).slice(2);
    const payload = walletPayload(signerId);
    const signature = nacl.sign.detached(stringToBytes(payload), keyPair.secretKey);

    const result = await verifyIntent(
      walletInput(payload, {
        signedData: {
          standard: "raw_ed25519",
          payload,
          public_key: `ed25519:${address}`,
          signature: `ed25519:${bs58.encode(signature)}`,
        },
        standard: "raw_ed25519",
        chain: "solana",
        address,
      }),
    );

    expect(result).toEqual({ ok: true, standard: "raw_ed25519" });
  });

  it("rejects a raw_ed25519 signature from another key", async () => {
    const keyPair = nacl.sign.keyPair();
    const otherKeyPair = nacl.sign.keyPair();
    const address = bs58.encode(keyPair.publicKey);
    const payload = walletPayload(bytesToHex(keyPair.publicKey).slice(2));
    const signature = nacl.sign.detached(
      stringToBytes(payload),
      otherKeyPair.secretKey,
    );

    const input = walletInput(payload, {
      signedData: {
        standard: "raw_ed25519",
        payload,
        public_key: `ed25519:${address}`,
        signature: `ed25519:${bs58.encode(signature)}`,
      },
      standard: "raw_ed25519",
      chain: "solana",
      address,
    });

    expect(await reasonFor(input)).toBe("signature-invalid");
  });

  it("rejects a NEP-413 envelope that differs from the stored one", async () => {
    const message = JSON.stringify({
      signer_id: "someone.near",
      deadline: DEADLINE,
      intents: [],
    });
    const stored = { message, recipient: "intents.near", nonce: NONCE };
    const submitted = { ...stored, recipient: "intents.far" };

    const input = walletInput(message, {
      signedData: {
        standard: "nep413",
        payload: submitted,
        public_key: "ed25519:11111111111111111111111111111111",
        signature: `ed25519:${bs58.encode(new Uint8Array(64))}`,
      },
      payload: stored,
      standard: "nep413",
      chain: "near",
      address: "someone.near",
    });

    expect(await reasonFor(input)).toBe("envelope-mismatch");
  });
});
