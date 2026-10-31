import { NextResponse } from "next/server";
import { z } from "zod";
import { createChallenge } from "@/lib/auth/challenge";

const Body = z.object({
  chain: z.enum(["evm", "solana", "near"]),
  address: z.string().min(1).max(128),
  // NEP-413 recipient, which is the app origin the signature is bound to.
  // The wallet shows this as who is asking, so it must be recognisable.
  recipient: z.string().min(1).max(200).optional(),
});

function validAddress(chain: "evm" | "solana" | "near", address: string): boolean {
  if (chain === "evm") return /^0x[0-9a-fA-F]{40}$/.test(address);
  if (chain === "near") {
    if (/^[0-9a-f]{64}$/.test(address)) return true;
    return /^[a-z0-9][a-z0-9._-]{1,62}$/.test(address);
  }
  // Solana: base58, 32 bytes when decoded. Length check first, decode in verify.
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { chain, address, recipient } = parsed.data;
  if (!validAddress(chain, address)) {
    return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  }
  const challenge = createChallenge(chain, address, recipient);
  return NextResponse.json(challenge);
}
