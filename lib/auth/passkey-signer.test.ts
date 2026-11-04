import { afterEach, describe, expect, it, vi } from "vitest";
import { p256 } from "@noble/curves/p256";
import bs58 from "bs58";
import { concat, hexToBytes, sha256, stringToBytes } from "viem";
import {
  base64UrlDecode,
  base64UrlEncode,
  encodeP256PublicKey,
  payloadChallenge,
  payloadDigest,
  verifyP256Signature,
  webAuthnSignedMessage,
} from "./passkeys";
import { PasskeyError } from "./passkey-client";
import { signIntentWithPasskey } from "./passkey-signer";

/**
 * The signer is exercised against a local P-256 key and a mocked ceremony.
 * The assertion is built the way a browser builds one: `clientDataJSON`
 * carries base64url(SHA-256(payload)), the authenticator data carries the
 * RP ID hash and the UP/UV flags, and the signature is DER over
 * `authenticatorData || SHA-256(clientDataJSON)`.
 */

const PRIVATE_KEY = p256.utils.randomPrivateKey();
const PUBLIC_KEY_BYTES = p256.getPublicKey(PRIVATE_KEY, false).subarray(1);
const PUBLIC_KEY = encodeP256PublicKey(PUBLIC_KEY_BYTES);
const CREDENTIAL_ID = new Uint8Array([
  0x21, 0x42, 0x00, 0x9f, 0x11, 0xa3, 0x7c, 0x55, 0xde, 0x01, 0x38, 0xb0,
  0x66, 0x14, 0xc9, 0x7a,
]);
const RP_ID = "myntle.xyz";
const ORIGIN = "https://myntle.xyz";

// Deliberately irregular whitespace: the signed bytes are the exact string,
// never a parse-and-restringify round trip.
const PAYLOAD =
  ' { "verifying_contract" : "intents.far", "signer_id": "0x4f3a", "deadline": "2026-11-05T11:28:18.215Z" } ';

type CeremonyFixture = {
  challenge?: Uint8Array;
  origin?: string;
  type?: string;
  highS?: boolean;
};

function authenticatorData(): Uint8Array {
  return concat([
    hexToBytes(sha256(stringToBytes(RP_ID))),
    new Uint8Array([0x05]), // UP | UV
    new Uint8Array([0, 0, 0, 1]),
  ]);
}

/** The assertion a well-behaved authenticator returns for these options. */
function assertion(fixture: CeremonyFixture = {}): Credential {
  const challenge = fixture.challenge ?? payloadDigest(PAYLOAD);
  const clientDataJSON = JSON.stringify({
    type: fixture.type ?? "webauthn.get",
    challenge: base64UrlEncode(challenge),
    origin: fixture.origin ?? ORIGIN,
    crossOrigin: false,
  });
  const authData = authenticatorData();
  const digest = hexToBytes(
    sha256(webAuthnSignedMessage({ authenticatorData: authData, clientDataJSON })),
  );

  const signature = p256.sign(digest, PRIVATE_KEY);
  // Half of noble's signatures are high-S. The fixture is pinned high-S so
  // the test proves the client normalizes rather than gets lucky.
  const high =
    fixture.highS === false
      ? signature
      : signature.hasHighS()
        ? signature
        : new p256.Signature(signature.r, p256.CURVE.n - signature.s);

  return {
    id: base64UrlEncode(CREDENTIAL_ID),
    type: "public-key",
    rawId: CREDENTIAL_ID,
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({}),
    response: {
      clientDataJSON: stringToBytes(clientDataJSON),
      authenticatorData: authData,
      signature: high.toBytes("der"),
      userHandle: null,
    },
  } as unknown as Credential;
}

function ceremony(assertion: Credential | Error) {
  const get = vi.fn<
    (options?: CredentialRequestOptions) => Promise<Credential>
  >(async () => {
    if (assertion instanceof Error) throw assertion;
    return assertion;
  });
  vi.stubGlobal("navigator", { credentials: { get } });
  return get;
}

function optionsOf(
  get: ReturnType<typeof ceremony>,
): PublicKeyCredentialRequestOptions {
  return (get.mock.calls[0]?.[0] as CredentialRequestOptions)
    .publicKey as PublicKeyCredentialRequestOptions;
}

const key = {
  credentialId: base64UrlEncode(CREDENTIAL_ID),
  publicKey: PUBLIC_KEY,
  rpId: RP_ID,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signIntentWithPasskey", () => {
  it("challenges SHA-256(payload) and pins the credential and relying party", async () => {
    const get = ceremony(assertion());
    await signIntentWithPasskey(PAYLOAD, key);

    const options = optionsOf(get);
    const challenge = new Uint8Array(options.challenge as ArrayBuffer);
    expect(challenge).toEqual(payloadDigest(PAYLOAD));
    expect(challenge).toHaveLength(32);
    expect(options.rpId).toBe(RP_ID);
    expect(options.userVerification).toBe("required");
    expect(options.timeout).toBe(60_000);
    expect(options.allowCredentials).toHaveLength(1);
    expect(options.allowCredentials?.[0]?.type).toBe("public-key");
    expect(new Uint8Array(options.allowCredentials![0]!.id as ArrayBuffer)).toEqual(
      CREDENTIAL_ID,
    );
  });

  it("returns the six exact signed-data fields with the payload untouched", async () => {
    ceremony(assertion());
    const signed = await signIntentWithPasskey(PAYLOAD, key);

    expect(Object.keys(signed).sort()).toEqual([
      "authenticator_data",
      "client_data_json",
      "payload",
      "public_key",
      "signature",
      "standard",
    ]);
    expect(signed.standard).toBe("webauthn");
    expect(signed.payload).toBe(PAYLOAD);
    expect(signed.public_key).toBe(PUBLIC_KEY);
  });

  it("converts DER to a 64-byte low-S signature the verifier accepts", async () => {
    ceremony(assertion({ highS: true }));
    const signed = await signIntentWithPasskey(PAYLOAD, key);

    expect(signed.signature.startsWith("p256:")).toBe(true);
    const raw = bs58.decode(signed.signature.slice("p256:".length));
    expect(raw).toHaveLength(64);
    expect(p256.Signature.fromBytes(raw, "compact").hasHighS()).toBe(false);

    const clientDataJSON = signed.client_data_json;
    const authenticatorData = base64UrlDecode(signed.authenticator_data);
    expect(
      verifyP256Signature({
        publicKey: PUBLIC_KEY_BYTES,
        signature: raw,
        message: webAuthnSignedMessage({ authenticatorData, clientDataJSON }),
      }),
    ).toBe(true);
  });

  it("carries the raw clientDataJSON and base64url authenticator data", async () => {
    ceremony(assertion());
    const signed = await signIntentWithPasskey(PAYLOAD, key);

    const clientData = JSON.parse(signed.client_data_json) as {
      type: string;
      challenge: string;
      origin: string;
    };
    expect(clientData.type).toBe("webauthn.get");
    expect(clientData.challenge).toBe(payloadChallenge(PAYLOAD));
    expect(clientData.origin).toBe(ORIGIN);

    const authData = base64UrlDecode(signed.authenticator_data);
    expect(authData).toHaveLength(37);
    expect(authData.subarray(0, 32)).toEqual(
      hexToBytes(sha256(stringToBytes(RP_ID))),
    );
    expect(authData[32] & 0x01).toBe(1); // UP
    expect(authData[32] & 0x04).toBe(4); // UV
  });

  it("refuses an assertion whose challenge is not this payload", async () => {
    ceremony(
      assertion({ challenge: new Uint8Array(32).fill(9), type: "webauthn.create" }),
    );
    await expect(signIntentWithPasskey(PAYLOAD, key)).rejects.toThrow(
      /did not sign this trade/i,
    );
  });

  it("maps a cancelled prompt to plain copy and signs nothing", async () => {
    const cancelled = Object.assign(new Error("The operation was aborted."), {
      name: "NotAllowedError",
    });
    ceremony(cancelled);

    await expect(signIntentWithPasskey(PAYLOAD, key)).rejects.toBeInstanceOf(
      PasskeyError,
    );
    await expect(signIntentWithPasskey(PAYLOAD, key)).rejects.toThrow(
      "The passkey prompt was cancelled. Nothing was moved.",
    );
  });

  it("maps a missing WebAuthn implementation to a plain refusal", async () => {
    vi.stubGlobal("navigator", {});
    await expect(signIntentWithPasskey(PAYLOAD, key)).rejects.toThrow(
      "This browser cannot use a passkey. Nothing was moved.",
    );
  });

  it("rejects a malformed identity key before opening a prompt", async () => {
    const get = ceremony(assertion());
    await expect(
      signIntentWithPasskey(PAYLOAD, { ...key, publicKey: "p256:not-base58" }),
    ).rejects.toBeInstanceOf(PasskeyError);
    expect(get).not.toHaveBeenCalled();
  });
});
