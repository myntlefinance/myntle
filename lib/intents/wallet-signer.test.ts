import { describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  generatePrivateKey,
  privateKeyToAccount,
} from "viem/accounts";
import {
  hexToBytes,
  stringToBytes,
} from "viem";
import { base64UrlEncode } from "@/lib/auth/passkeys";
import { verifyIntent } from "./verify-intent";
import { signIntentWithWallet, type WalletIntentSigner } from "./wallet-signer";

const PAYLOAD =
  '{"verifying_contract":"intents.far","signer_id":"0xabc","deadline":"2099-01-01T00:00:00.000Z","nonce":"fixture","intents":[]}';
const DEPOSIT = "842f1341554c97d5eb5a3f5587294eeccc49780fd61df806ae4b2eeed9727ae7";
const ASSET =
  "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";
const DEADLINE = "2099-01-01T00:00:00.000Z";

function unavailableNep413(): WalletIntentSigner["signNEP413"] {
  return async () => {
    throw new Error("nep413 must not be used here");
  };
}

function webauthn() {
  return { rpID: "", origins: [] as string[] };
}

describe("signIntentWithWallet", () => {
  it("round-trips an ERC-191 signature through verifyIntent", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signature = await account.signMessage({
      message: { raw: stringToBytes(PAYLOAD) },
    });
    const signMessage = vi.fn(async () => hexToBytes(signature));
    const canonical = Uint8Array.from(hexToBytes(signature));
    const v = canonical[64];
    if (v === 27 || v === 28) canonical[64] = v - 27;

    const signed = await signIntentWithWallet({
      standard: "erc191",
      payload: PAYLOAD,
      signer: { signMessage, signNEP413: unavailableNep413() },
    });

    expect(signed).toEqual({
      standard: "erc191",
      payload: PAYLOAD,
      signature: `secp256k1:${bs58.encode(canonical)}`,
    });
    expect(signed.signature).toMatch(/^secp256k1:[1-9A-HJ-NP-Za-km-z]+$/);
    expect(bs58.decode(signed.signature.slice("secp256k1:".length))).toHaveLength(65);
    expect(canonical[64]).toBeLessThanOrEqual(1);
    expect(new TextDecoder().decode(await payloadBytes(signMessage))).toBe(
      PAYLOAD,
    );

    const verified = await verifyIntent({
      signedData: signed,
      payload: PAYLOAD,
      signerId: account.address,
      standard: "erc191",
      mode: "confidential",
      depositAddress: DEPOSIT,
      amountIn: "500000",
      assetId: ASSET,
      deadline: DEADLINE,
      accountKind: "wallet",
      chain: "evm",
      address: account.address,
      webauthn: webauthn(),
    });
    expect(verified).toEqual({ ok: true, standard: "erc191" });
  });

  it("round-trips a raw Ed25519 signature through verifyIntent", async () => {
    const keypair = nacl.sign.keyPair();
    const address = bs58.encode(keypair.publicKey);
    const signature = nacl.sign.detached(
      stringToBytes(PAYLOAD),
      keypair.secretKey,
    );

    const signed = await signIntentWithWallet({
      standard: "raw_ed25519",
      payload: PAYLOAD,
      signer: {
        signMessage: async () => signature,
        signNEP413: unavailableNep413(),
      },
      publicKey: `ed25519:${address}`,
    });

    expect(signed).toEqual({
      standard: "raw_ed25519",
      payload: PAYLOAD,
      signature: `ed25519:${bs58.encode(signature)}`,
      public_key: `ed25519:${address}`,
    });

    const verified = await verifyIntent({
      signedData: signed,
      payload: PAYLOAD,
      signerId: address,
      standard: "raw_ed25519",
      mode: "confidential",
      depositAddress: DEPOSIT,
      amountIn: "500000",
      assetId: ASSET,
      deadline: DEADLINE,
      accountKind: "wallet",
      chain: "solana",
      address,
      webauthn: webauthn(),
    });
    expect(verified).toEqual({ ok: true, standard: "raw_ed25519" });
  });

  it("signs the exact NEP-413 envelope the server stored", async () => {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const envelope = {
      message: PAYLOAD,
      recipient: "intents.far",
      nonce: base64UrlEncode(nonce),
    };
    const signNEP413 = vi.fn(
      async (input: {
        message: string;
        recipient: string;
        nonce: Uint8Array;
      }) => {
        expect(input.message).toBe(PAYLOAD);
        expect(input.recipient).toBe("intents.far");
        expect(input.nonce).toHaveLength(32);
        return {
          signature: "ed25519:fixture-signature",
          publicKey: "ed25519:fixture-public-key",
        };
      },
    );
    const signMessage = vi.fn(async () => new Uint8Array());

    const signed = await signIntentWithWallet({
      standard: "nep413",
      payload: envelope,
      signer: { signMessage, signNEP413 },
    });

    expect(signMessage).not.toHaveBeenCalled();
    expect(signNEP413).toHaveBeenCalledTimes(1);
    const call = signNEP413.mock.calls[0][0];
    expect(call.message).toBe(PAYLOAD);
    expect(call.recipient).toBe("intents.far");
    expect([...call.nonce]).toEqual([...nonce]);

    expect(signed).toMatchObject({
      standard: "nep413",
      signature: "ed25519:fixture-signature",
      public_key: "ed25519:fixture-public-key",
    });
    expect(signed.payload).toBe(envelope);
  });

  it("accepts a hex NEP-413 nonce", async () => {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const hex = Buffer.from(nonce).toString("hex");
    const signNEP413 = vi.fn(
      async (input: {
        message: string;
        recipient: string;
        nonce: Uint8Array;
      }) => {
        expect(input.nonce).toHaveLength(32);
        return {
          signature: "ed25519:fixture-signature",
          publicKey: "ed25519:fixture-public-key",
        };
      },
    );

    await signIntentWithWallet({
      standard: "nep413",
      payload: {
        message: PAYLOAD,
        recipient: "intents.far",
        nonce: `0x${hex}`,
      },
      signer: { signMessage: async () => new Uint8Array(), signNEP413 },
    });

    const call = signNEP413.mock.calls[0][0];
    expect([...call.nonce]).toEqual([...nonce]);
  });

  it("refuses a malformed envelope and a mismatched payload shape", async () => {
    const signer: WalletIntentSigner = {
      signMessage: async () => new Uint8Array([1, 2, 3]),
      signNEP413: unavailableNep413(),
    };

    await expect(
      signIntentWithWallet({
        standard: "nep413",
        payload: PAYLOAD,
        signer,
      }),
    ).rejects.toThrow("The wallet did not sign this transfer.");

    await expect(
      signIntentWithWallet({
        standard: "erc191",
        payload: { message: "x" },
        signer,
      }),
    ).rejects.toThrow("The wallet did not sign this transfer.");

    await expect(
      signIntentWithWallet({
        standard: "nep413",
        payload: {
          message: PAYLOAD,
          recipient: "intents.far",
          nonce: base64UrlEncode(new Uint8Array(16)),
        },
        signer,
      }),
    ).rejects.toThrow("The wallet did not sign this transfer.");
  });

  it("masks a wallet rejection", async () => {
    await expect(
      signIntentWithWallet({
        standard: "erc191",
        payload: PAYLOAD,
        signer: {
          signMessage: async () => {
            throw new Error("User rejected");
          },
          signNEP413: unavailableNep413(),
        },
      }),
    ).rejects.toThrow("The wallet did not sign this transfer. Nothing was moved.");
  });
});

/** Reads the bytes the signer was asked to sign. */
async function payloadBytes(
  signMessage: ReturnType<typeof vi.fn>,
): Promise<Uint8Array> {
  const call = signMessage.mock.calls[0] as unknown as [Uint8Array];
  return call[0];
}
