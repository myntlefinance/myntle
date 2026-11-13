/**
 * Reads the current APY for each Earn vault from DefiLlama.
 *
 * 1Click prices a deposit but publishes no yield, so a rate has to come from an
 * aggregator. DefiLlama serves every pool in one large `/pools` document, so
 * the document is fetched once and each vault is looked up by pool id from the
 * parsed map. A rate that cannot be read stays null: the product never invents
 * a number the aggregator did not publish.
 */

import type { EarnVault } from "./catalogue";

const POOLS_URL = "https://yields.llama.fi/pools";

/** The aggregator refreshes far more slowly than this; ten minutes is plenty. */
const CACHE_TTL_MS = 10 * 60_000;

/** The whole read budget. A slow aggregator must not hold a tool open. */
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * The parsed pool id -> APY map, in percent, and when it was read.
 *
 * Module memory is the right scope: a warm server shares one document across
 * turns, while a fresh process simply reads it again.
 */
let cache: Map<string, number> | null = null;
let cacheFetchedAt = 0;

/**
 * The read that is already in flight.
 *
 * Parallel tool calls in one turn must share it, or the same multi-megabyte
 * document is downloaded several times at once.
 */
let pending: Promise<Map<string, number>> | null = null;

function warn(reason: string): void {
  // The status or a short reason is enough to diagnose the call. The response
  // body is never logged: it is a large third-party document and it is not
  // needed to know that no rate is available.
  console.warn(`[earn] DefiLlama pools unavailable (${reason})`);
}

/**
 * Builds the pool map from a response body.
 *
 * DefiLlama wraps the rows in `{ data: [...] }`, but a bare array has been
 * observed on other endpoints in the same family, so both shapes are read.
 * Rows without a string id or a finite numeric APY are skipped rather than
 * turned into zero, because zero is itself a published rate.
 */
function parsePools(body: unknown): Map<string, number> {
  const rows = Array.isArray(body)
    ? body
    : body &&
        typeof body === "object" &&
        Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];

  const pools = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const pool = (row as { pool?: unknown }).pool;
    const apy = (row as { apy?: unknown }).apy;
    if (typeof pool !== "string" || pool.length === 0) continue;
    if (typeof apy !== "number" || !Number.isFinite(apy)) continue;
    pools.set(pool, apy);
  }
  return pools;
}

/** One bounded read. Returns null on every failure, never a made-up rate. */
async function fetchPoolApys(): Promise<Map<string, number> | null> {
  try {
    const res = await fetch(POOLS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      warn(`HTTP ${res.status}`);
      return null;
    }
    return parsePools(await res.json());
  } catch (error) {
    // A timeout and a refused connection mean the same thing to a caller with
    // no rate to show. Only the short reason travels; no body and no URL.
    warn(
      error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "request failed",
    );
    return null;
  }
}

/** The cached map, or the one shared read that is already running. */
async function loadPoolApys(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cache !== null && now - cacheFetchedAt < CACHE_TTL_MS) return cache;
  if (pending !== null) return pending;

  pending = fetchPoolApys()
    .then((pools) => {
      // A failed read is deliberately not cached. A transient outage must not
      // pin every vault to null for the whole ten-minute window.
      if (pools !== null) {
        cache = pools;
        cacheFetchedAt = Date.now();
      }
      return pools ?? new Map<string, number>();
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/**
 * The APYs for many vaults from one fetch, keyed by vault id.
 *
 * A vault with no pool id is answered null without touching the network: TLO
 * has no aggregator listing, and a lookup for it cannot succeed.
 */
export async function readEarnApys(
  vaults: readonly EarnVault[],
): Promise<Map<string, number | null>> {
  const apys = new Map<string, number | null>();

  if (!vaults.some((vault) => Boolean(vault.apyPoolId))) {
    for (const vault of vaults) apys.set(vault.id, null);
    return apys;
  }

  const pools = await loadPoolApys();
  for (const vault of vaults) {
    apys.set(
      vault.id,
      vault.apyPoolId ? (pools.get(vault.apyPoolId) ?? null) : null,
    );
  }
  return apys;
}

/** The APY for one vault in percent, or null when none is published. */
export async function readEarnApy(vault: EarnVault): Promise<number | null> {
  const apys = await readEarnApys([vault]);
  return apys.get(vault.id) ?? null;
}
