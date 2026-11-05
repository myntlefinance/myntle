/**
 * The verifier's current salt, cached.
 *
 * Every intent nonce is encoded with the live salt from `intents.near`
 * (`current_salt` view, no signature needed). The SDK caches it for five
 * minutes; this module does the same with a single in-flight request, so
 * concurrent callers share one fetch. Docs quote a stale value — the
 * contract is authoritative, never a constant.
 */

const SALT_TTL_MS = 5 * 60_000;

let cached: { hex: string; bytes: Uint8Array; at: number } | null = null;
let inflight: Promise<{ hex: string; bytes: Uint8Array }> | null = null;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function loadSalt(): Promise<{ hex: string; bytes: Uint8Array }> {
  const rpc =
    process.env.NEAR_RPC_PRIMARY ??
    process.env.NEXT_PUBLIC_NEAR_RPC_PRIMARY ??
    "https://free.rpc.fastnear.com";
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "intents-salt",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: "intents.near",
        method_name: "current_salt",
        args_base64: "e30=",
      },
    }),
  });
  if (!res.ok) throw new Error("The salt could not be read.");
  const data = (await res.json()) as { result?: { result?: number[] } };
  const chars = (data.result?.result ?? [])
    .map((b) => String.fromCharCode(b))
    .join("");
  const hex = JSON.parse(chars) as string;
  const bytes = hexToBytes(hex);
  if (bytes.length !== 4) throw new Error("The salt had an unexpected shape.");
  return { hex, bytes };
}

/** Live salt, served from the 5-minute cache when fresh. */
export async function getIntentsSalt(now = Date.now()): Promise<{
  hex: string;
  bytes: Uint8Array;
}> {
  if (cached && now - cached.at < SALT_TTL_MS) {
    return { hex: cached.hex, bytes: cached.bytes };
  }
  if (!inflight) {
    inflight = loadSalt().finally(() => {
      inflight = null;
    });
  }
  const fresh = await inflight;
  cached = { ...fresh, at: now };
  return fresh;
}

/** Warms the cache in the background. Never throws. */
export function prefetchIntentsSalt(): void {
  getIntentsSalt().catch(() => {});
}
