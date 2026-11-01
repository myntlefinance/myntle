import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyMessage as verifyEvmMessage } from "viem";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { JsonRpcProvider } from "near-api-js";
import { verifyMessage as verifyNearMessage } from "near-api-js/nep413";
import {
  buildMessage,
  consumeChallenge,
} from "@/lib/auth/challenge";
import { createSession, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/session";

const Body = z.object({
  chain: z.enum(["evm", "solana", "near"]),
  address: z.string().min(1).max(128),
  message: z.string().min(1).max(2000),
  signature: z.string().min(1).max(2000),
  publicKey: z.string().max(200).optional(),
  recipient: z.string().max(200).optional(),
  nonce: z.string().max(128).optional(),
});

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

function base64ToBytes(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "base64"));
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

function nearProvider(): JsonRpcProvider {
  const url =
    process.env.NEXT_PUBLIC_NEAR_RPC_PRIMARY ?? "https://free.rpc.fastnear.com";
  return new JsonRpcProvider({ url });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { chain, address, message, signature, publicKey, recipient, nonce } =
    parsed.data;

  // The nonce identifies the pending challenge. It is consumed exactly once.
  if (!nonce) {
    return NextResponse.json(
      { error: "Verification expired. Please try again." },
      { status: 401 },
    );
  }
  const pending = await consumeChallenge(nonce, chain, address);
  if (!pending) {
    return NextResponse.json(
      { error: "Verification expired. Please try again." },
      { status: 401 },
    );
  }

  // The message must be the exact challenge text, so a signature from another
  // session or another application cannot be replayed here.
  const expected = buildMessage({
    chain,
    address,
    nonceHex: nonce,
    expiresAt: pending.expiresAt,
  });
  if (message !== expected) {
    return NextResponse.json(
      { error: "Verification failed. Please try again." },
      { status: 401 },
    );
  }

  try {
    if (chain === "evm") {
      const ok = await verifyEvmMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      if (!ok) throw new Error("evm-verify");
    } else if (chain === "solana") {
      if (!publicKey) throw new Error("solana-key");
      const keyBytes = hexToBytes(publicKey);
      if (keyBytes.length !== 32) throw new Error("solana-key");
      if (bs58.encode(keyBytes) !== address) throw new Error("solana-key");
      const ok = nacl.sign.detached.verify(
        new TextEncoder().encode(message),
        hexToBytes(signature),
        keyBytes,
      );
      if (!ok) throw new Error("solana-verify");
    } else {
      if (!publicKey || !recipient || !nonce) throw new Error("near-fields");
      // The recipient must be the one issued with the challenge, so a
      // signature for another app cannot be replayed here.
      if (!pending.recipient || recipient !== pending.recipient) {
        throw new Error("near-recipient");
      }
      await verifyNearMessage({
        signerAccountId: address,
        signerPublicKey: publicKey,
        payload: {
          message,
          recipient,
          nonce: hexToBytes(nonce),
        },
        signature: decodeNearSignature(signature),
        provider: nearProvider(),
      });
    }
  } catch {
    return NextResponse.json(
      { error: "Signature could not be verified. Please try again." },
      { status: 401 },
    );
  }

  const { id, expiresAt } = await createSession(chain, address);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    expires: new Date(expiresAt),
  });
  return res;
}
