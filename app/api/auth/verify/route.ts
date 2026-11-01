import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildMessage,
  consumeChallenge,
} from "@/lib/auth/challenge";
import { verifyWalletSignature } from "@/lib/auth/signatures";
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
    // The NEAR recipient must be the one issued with the challenge, so a
    // signature for another app cannot be replayed here.
    if (chain === "near" && (!pending.recipient || recipient !== pending.recipient)) {
      throw new Error("near-recipient");
    }
    await verifyWalletSignature({
      chain,
      address,
      message,
      signature,
      publicKey,
      recipient,
      nonce,
    });
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
