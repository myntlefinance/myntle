import { randomBytes } from "node:crypto";

export type AuthChain = "evm" | "solana" | "near";

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type PendingChallenge = {
  chain: AuthChain;
  /** Normalised address (EVM lower-cased, others as sent). */
  address: string;
  expiresAt: number;
  /** NEP-413 recipient the signature is bound to (NEAR only). */
  recipient?: string;
};

const globalStore = globalThis as unknown as {
  __myntle_challenges?: Map<string, PendingChallenge>;
};

function store(): Map<string, PendingChallenge> {
  if (!globalStore.__myntle_challenges) {
    globalStore.__myntle_challenges = new Map();
  }
  return globalStore.__myntle_challenges;
}

function purgeExpired(now: number): void {
  for (const [nonce, pending] of store()) {
    if (pending.expiresAt <= now) store().delete(nonce);
  }
}

export function normalizeAddress(chain: AuthChain, address: string): string {
  return chain === "evm" ? address.toLowerCase() : address;
}

export function buildMessage(args: {
  chain: AuthChain;
  address: string;
  nonceHex: string;
  expiresAt: number;
}): string {
  return (
    `Sign in to Myntle\n` +
    `\n` +
    `Chain: ${args.chain}\n` +
    `Address: ${args.address}\n` +
    `Nonce: ${args.nonceHex}\n` +
    `Expires: ${new Date(args.expiresAt).toISOString()}`
  );
}

export function createChallenge(
  chain: AuthChain,
  address: string,
  recipient?: string,
): { message: string; nonce: string; expiresAt: number; recipient?: string } {
  const now = Date.now();
  purgeExpired(now);
  const nonceHex = randomBytes(32).toString("hex");
  const expiresAt = now + CHALLENGE_TTL_MS;
  store().set(nonceHex, {
    chain,
    address: normalizeAddress(chain, address),
    expiresAt,
    ...(chain === "near" && recipient ? { recipient } : {}),
  });
  return {
    message: buildMessage({ chain, address, nonceHex, expiresAt }),
    nonce: nonceHex,
    expiresAt,
    ...(chain === "near" && recipient ? { recipient } : {}),
  };
}

export function consumeChallenge(
  nonceHex: string,
  chain: AuthChain,
  address: string,
): { expiresAt: number; recipient?: string } | null {
  purgeExpired(Date.now());
  const pending = store().get(nonceHex);
  if (!pending) return null;
  store().delete(nonceHex);
  if (pending.chain !== chain) return null;
  if (pending.address !== normalizeAddress(chain, address)) return null;
  if (pending.expiresAt <= Date.now()) return null;
  return { expiresAt: pending.expiresAt, recipient: pending.recipient };
}
