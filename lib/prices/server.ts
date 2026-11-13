/**
 * Server-to-server price client for the public price Worker.
 *
 * The Worker is a display feed, never an execution price: a swap quote keeps
 * 1Click's own `amountOutUsd`. A tool or a page reads this and falls back to
 * the five-minute catalogue when the Worker is slow or down, so a price
 * outage can never break a balance read.
 *
 * Server-only. The Worker is public and knows nothing about wallets; never
 * send an address, a session, a balance, or any user identifier in a request.
 */

import { isPricesLive } from "./flags";

export type LivePrice = {
  /** Whole US dollars per unit, as the Worker reports it. */
  usd: number;
  /** When the source observed the price, in milliseconds. */
  asOf: number;
  /** The source that produced the number: binance, alchemy, or oneclick. */
  source: string;
  /** True when the quote is older than twice its source TTL. */
  stale: boolean;
};

const DEFAULT_PRICES_HTTP_URL =
  "https://myntle-prices.myntle.workers.dev";

/** The whole server-side budget. A slow Worker must not hold a tool open. */
const PRICE_TIMEOUT_MS = 1_500;

/** The Worker rejects more than 50 ids per request. */
const MAX_ASSETS_PER_REQUEST = 50;

function baseUrl(): string {
  return (process.env.PRICES_HTTP_URL || DEFAULT_PRICES_HTTP_URL).replace(
    /\/+$/,
    "",
  );
}

function parseQuote(value: unknown): LivePrice | null {
  if (!value || typeof value !== "object") return null;
  const quote = value as {
    usd?: unknown;
    asOf?: unknown;
    source?: unknown;
    stale?: unknown;
  };
  if (
    typeof quote.usd !== "number" ||
    !Number.isFinite(quote.usd) ||
    quote.usd <= 0
  ) {
    return null;
  }
  if (
    typeof quote.asOf !== "number" ||
    !Number.isFinite(quote.asOf) ||
    quote.asOf <= 0
  ) {
    return null;
  }
  return {
    usd: quote.usd,
    asOf: quote.asOf,
    source: typeof quote.source === "string" ? quote.source : "unknown",
    stale: quote.stale === true,
  };
}

/**
 * One request, bounded by the server budget. Every failure — a timeout, a
 * non-2xx, a malformed body — is an empty map rather than a thrown error:
 * the caller always has the catalogue to fall back to.
 */
async function fetchChunk(ids: string[]): Promise<Map<string, LivePrice>> {
  const prices = new Map<string, LivePrice>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRICE_TIMEOUT_MS);

  try {
    const query = ids.map(encodeURIComponent).join(",");
    const res = await fetch(`${baseUrl()}/prices?assets=${query}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return prices;

    const body = (await res.json()) as {
      prices?: Record<string, unknown>;
    } | null;
    const quoted = body?.prices;
    if (!quoted || typeof quoted !== "object") return prices;

    for (const id of ids) {
      const quote = parseQuote(quoted[id]);
      if (quote) prices.set(id, quote);
    }
    return prices;
  } catch {
    return prices;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads live quotes for a set of catalogue asset ids.
 *
 * Ids are deduped, trimmed, and chunked to the Worker's 50-id cap. A chunk
 * that fails contributes nothing; the chunks that answered still do. The
 * returned map only contains ids the Worker priced.
 */
export async function getLivePrices(
  assetIds: readonly string[],
): Promise<Map<string, LivePrice>> {
  // Flag off restores the old path byte for byte: no Worker request, and the
  // caller's catalogue or Alchemy value is the only price it sees.
  if (!isPricesLive()) return new Map();

  const unique = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += MAX_ASSETS_PER_REQUEST) {
    chunks.push(unique.slice(i, i + MAX_ASSETS_PER_REQUEST));
  }

  const settled = await Promise.all(chunks.map((chunk) => fetchChunk(chunk)));
  const prices = new Map<string, LivePrice>();
  for (const chunk of settled) {
    for (const [id, quote] of chunk) prices.set(id, quote);
  }
  return prices;
}

/** One asset, for a caller that does not need a map. */
export async function getLivePrice(
  assetId: string,
): Promise<LivePrice | undefined> {
  const id = assetId.trim();
  if (!id) return undefined;
  return (await getLivePrices([id])).get(id);
}
