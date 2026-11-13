/**
 * SNS reads: on-chain primary, REST proxy (v2 envelope) fallback. This
 * directory is the only place (besides the registry) that may hold a
 * provider key, URL, or SDK import — see the boundary test in
 * `lib/ports/boundary.test.ts`.
 *
 * The proxy URL never leaves this directory: `lib/names/` calls
 * `resolveSnsAddress` and maps the taxonomy, but never sees the host.
 * The Solana endpoint is not hardcoded here either — the on-chain read
 * uses the caller-passed `rpcEndpoint` override when present and the
 * endpoint adapter's value otherwise, so one setting moves every Solana
 * read at once and this module never owns a URL. A key-bearing endpoint
 * URL must never be passed as `rpcEndpoint` — it would travel to the
 * proxy inside the query string; the on-chain read POSTs to it
 * server-side instead, so the key never leaves the server.
 *
 * Failover order: the on-chain read runs first. `NotFound` (well-formed
 * but unregistered) and `InvalidInput` (local validation) are definitive
 * and propagate unchanged so the frozen taxonomy cannot shift; any other
 * on-chain failure (RPC down, parse failure, timeout, missing endpoint
 * config) falls back to the proxy, which maps to the existing taxonomy
 * exactly as before.
 *
 * Live evidence (2026-11-09, recorded in the step-04 report): the bare
 * proxy path resolves `bonfida.sns` (HTTP 200), while
 * `?rpc=https://api.mainnet-beta.solana.com` is rejected proxy-side
 * (HTTP 500 `Internal error`). The override therefore stays explicit
 * opt-in: omitted means the proxy serves reads from its own RPC, and a
 * deployment that configures its own Solana endpoint passes it in.
 *
 * Mapping at the edge: a 404 / "Domain not found" envelope throws
 * `NotFound` (the name layer turns that into its `null` return); every
 * other failure — proxy rejection, HTTP 5xx, network error, timeout —
 * throws `ProviderUnavailable` with a generic message. Provider detail
 * goes to the server log, never to the caller.
 *
 * Server-side only.
 */

import bs58 from "bs58";
import { InvalidInput, NotFound, ProviderUnavailable } from "@/lib/ports";
import { getSolanaEndpoint } from "./endpoint";
import { resolveSnsOnchain } from "./onchain";

export const SNS_PROXY_BASE = "https://sdk-proxy-v2.sns.id";

/** Generic caller-facing message: no provider names reach the client. */
const UNAVAILABLE_MESSAGE = "Name lookup is unavailable. Try again shortly.";

/**
 * Outer cap around the proxy read. The fetch also carries an abort
 * signal; the race is the backstop for transports that ignore it.
 */
const SNS_TIMEOUT_MS = 20_000;

function unavailable(detail: string): ProviderUnavailable {
  console.error(`[sns-proxy] ${detail}`);
  return new ProviderUnavailable(UNAVAILABLE_MESSAGE);
}

function withTimeout<T>(
  ms: number,
  run: () => Promise<T>,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([run(), timeout]).finally(() => {
    clearTimeout(timer);
  });
}

export type SnsResolution = {
  /** Canonical base58 (round-tripped, so odd encodings cannot leak out). */
  address: string;
};

function canonicalBase58(raw: string): string {
  return bs58.encode(bs58.decode(raw));
}

function envelopeText(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const record = body as Record<string, unknown>;
  const candidates = [record.error, record.message, record.result];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return "";
}

function readBodySafely(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/**
 * Resolves one `.sns` name through the proxy. The name must already be
 * normalized (lowercased, validated); validation belongs to `lib/names/`.
 * Returns the canonical address, or throws `NotFound` when the name is
 * well-formed but unregistered. Exported for the differential corpus
 * (`sns-corpus.test.ts`); product callers use `resolveSnsAddress`.
 */
export async function resolveSnsViaProxy(
  name: string,
  options?: {
    /**
     * Explicit `rpc` override, sourced from the endpoint adapter by the
     * caller. Omitted means the proxy serves the read from its own RPC
     * (see the module header for why the default public endpoint is not
     * sent). Never a key-bearing URL.
     */
    rpcEndpoint?: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<SnsResolution> {
  const timeoutMs = options?.timeoutMs ?? SNS_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const baseUrl = options?.baseUrl ?? SNS_PROXY_BASE;
  const override = options?.rpcEndpoint;
  const url =
    override !== undefined && override.length > 0
      ? `${baseUrl}/resolve/${encodeURIComponent(name)}?rpc=${encodeURIComponent(override)}`
      : `${baseUrl}/resolve/${encodeURIComponent(name)}`;

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await withTimeout(
        timeoutMs,
        () =>
          fetchImpl(url, {
            signal: controller.signal,
            headers: { accept: "application/json" },
          }),
        () => unavailable(`sns read timed out after ${timeoutMs}ms`),
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw error;
    throw unavailable(error instanceof Error ? error.message : "unknown failure");
  }

  if (res.status === 404) {
    throw new NotFound("No name record matches that request.");
  }

  const body = await readBodySafely(res);
  if (!res.ok) {
    throw unavailable(
      `proxy rejected the read: status ${res.status} ${envelopeText(body).slice(0, 120)}`,
    );
  }

  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.result === "string" && record.result.length > 0) {
      try {
        return { address: canonicalBase58(record.result) };
      } catch {
        throw unavailable("proxy returned an address outside the encoding.");
      }
    }
    const text = envelopeText(body);
    if (/domain not found/i.test(text)) {
      throw new NotFound("No name record matches that request.");
    }
    if (/unsupported tld/i.test(text)) {
      throw unavailable(`proxy refused the suffix: ${text.slice(0, 120)}`);
    }
    throw unavailable(`proxy answered without an address: ${text.slice(0, 120)}`);
  }

  throw unavailable("proxy answered outside the envelope.");
}

/**
 * Resolves one `.sns` name: on-chain primary, proxy fallback. Same
 * signature and taxonomy as the proxy read it replaces, so callers are
 * untouched. `NotFound` and `InvalidInput` from the on-chain read are
 * definitive and propagate; anything else (RPC down, parse failure,
 * timeout, missing endpoint config) falls back to the proxy.
 */
export async function resolveSnsAddress(
  name: string,
  options?: {
    rpcEndpoint?: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<SnsResolution> {
  const timeoutMs = options?.timeoutMs ?? SNS_TIMEOUT_MS;
  try {
    const endpoint = options?.rpcEndpoint ?? getSolanaEndpoint();
    return await resolveSnsOnchain(name, {
      endpoint,
      fetchImpl: options?.fetchImpl,
      timeoutMs,
      overallTimeoutMs: timeoutMs,
    });
  } catch (error) {
    if (error instanceof NotFound) throw error;
    if (error instanceof InvalidInput) throw error;
    console.error(
      `[sns] on-chain read failed, falling back to proxy: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
    return resolveSnsViaProxy(name, options);
  }
}
