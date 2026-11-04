import {
  recoverMessageAddress,
  verifyMessage as verifyEvmMessage,
} from "viem";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { JsonRpcProvider } from "near-api-js";
import { verifyMessage as verifyNearMessage } from "near-api-js/nep413";
import type { AuthChain } from "./challenge";

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("bad-hex");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function decodeNearSignature(input: string): Uint8Array {
  const clean = input.startsWith("0x") ? input.slice(2) : input;
  // Wallets have returned both hex and base64 for NEP-413 signatures.
  // Hex is 128 hex characters for 64 bytes; anything else is tried as base64.
  if (/^[0-9a-fA-F]{128}$/.test(clean)) return hexToBytes(clean);
  const asBase64 = new Uint8Array(Buffer.from(input, "base64"));
  if (asBase64.length === 64) return asBase64;
  // Last resort: try hex anyway so the verifier decides, not the decoder.
  try {
    return hexToBytes(clean);
  } catch {
    return asBase64;
  }
}

/**
 * Verifies a wallet message signature for the connected account.
 *
 * EVM recovers an ERC-191 personal signature, Solana checks a raw Ed25519
 * signature against the address (which is the base58 public key), and NEAR
 * verifies a NEP-413 envelope against the account's access key on RPC.
 * Throws on any failure; the caller decides the response.
 */
export async function verifyWalletSignature(args: {
  chain: AuthChain;
  address: string;
  message: string;
  signature: string;
  publicKey?: string;
  recipient?: string;
  nonce?: string;
}): Promise<void> {
  const { chain, address, message, signature } = args;

  if (chain === "evm") {
    // Recover first so a signature from another account reads as a wallet
    // change (reconnect and retry) rather than a generic rejection.
    let recovered: string;
    try {
      recovered = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      throw new Error("evm-verify");
    }
    if (recovered.toLowerCase() !== address.toLowerCase()) {
      throw new Error("evm-mismatch");
    }
    const ok = await verifyEvmMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    if (!ok) throw new Error("evm-verify");
    return;
  }

  if (chain === "solana") {
    // The address is the base58 public key; no separate key needs to travel.
    const keyBytes = args.publicKey ? hexToBytes(args.publicKey) : bs58.decode(address);
    if (keyBytes.length !== 32) throw new Error("solana-key");
    if (bs58.encode(keyBytes) !== address) throw new Error("solana-key");
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      hexToBytes(signature),
      keyBytes,
    );
    if (!ok) throw new Error("solana-verify");
    return;
  }

  if (!args.publicKey || !args.recipient || !args.nonce) {
    throw new Error("near-fields");
  }
  const provider = new JsonRpcProvider({
    url:
      process.env.NEXT_PUBLIC_NEAR_RPC_PRIMARY ?? "https://free.rpc.fastnear.com",
  });
  await verifyNearMessage({
    signerAccountId: address,
    signerPublicKey: args.publicKey,
    payload: {
      message,
      recipient: args.recipient,
      nonce: hexToBytes(args.nonce),
    },
    signature: decodeNearSignature(signature),
    provider,
  });
}
