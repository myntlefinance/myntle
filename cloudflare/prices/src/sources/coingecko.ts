import { requestJson, type HttpFailure } from "../lib/http";
import { buildSeries } from "../series";
import {
  fail,
  fromHttp,
  type PriceSeries,
  type SeriesPoint,
  type SourceConfig,
  type SourceFailure,
  type SourceResult,
} from "./types";

/**
 * CoinGecko's OHLC endpoint is the last history fallback, reached only when
 * both Binance.US and Alchemy have no series for an asset. `ohlc?days=1`
 * returns exactly 48 half-hour candles. The free tier is rate-limited and
 * requires attribution, so this adapter never retries a 429 in a loop: the
 * card keeps its empty state and the caller comes back much later.
 *
 * There is no current-price path here on purpose. A quote must come from a
 * livelier source; CoinGecko only draws the line.
 */
const OHLC_URL = "https://api.coingecko.com/api/v3/coins";
const PRO_OHLC_URL = "https://pro-api.coingecko.com/api/v3/coins";

export type CoingeckoSource = {
  readonly name: "coingecko";
  readonly configured: true;
  fetchSeries(coingeckoId: string): Promise<SourceResult<PriceSeries>>;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Each row is `[time, open, high, low, close]` with millisecond time. The
 * close is the value the chart plots, so a malformed row is dropped instead
 * of closing a gap with an invented point.
 */
function parseOhlc(body: unknown): SeriesPoint[] | null {
  if (!Array.isArray(body)) return null;

  const points: SeriesPoint[] = [];
  for (const row of body) {
    if (!Array.isArray(row) || row.length < 5) continue;

    const time = toNumber(row[0]);
    const value = toNumber(row[4]);
    if (time === null || value === null || time <= 0 || value < 0) continue;

    points.push({ time, value });
  }
  return points;
}

/** A 404 is an unknown coin id; a 429 is the rate limit the plan warns about. */
function coingeckoFailure(result: HttpFailure): SourceFailure {
  if (result.status === 404) return fail("unsupported", { status: 404 });
  return fromHttp(result);
}

export function createCoingeckoSource(
  config: SourceConfig = {},
): CoingeckoSource {
  const now = config.now ?? Date.now;
  const fetchImpl = config.fetchImpl ?? fetch;

  const proKey = config.coingeckoProKey?.trim();
  const demoKey = config.coingeckoKey?.trim();

  // A pro key uses the pro host and header. Otherwise the optional demo key
  // raises the free tier's limit on the same public endpoint.
  const base =
    proKey === undefined || proKey.length === 0 ? OHLC_URL : PRO_OHLC_URL;
  const headers: Record<string, string> | undefined =
    proKey !== undefined && proKey.length > 0
      ? { "x-cg-pro-api-key": proKey }
      : demoKey !== undefined && demoKey.length > 0
        ? { "x-cg-demo-api-key": demoKey }
        : undefined;

  return {
    name: "coingecko",
    configured: true,

    /**
     * Requests one day of candles and keeps whatever parses. The measured
     * shape is 48, but a short answer is drawn honestly rather than padded;
     * only a body that is not an OHLC array is a failure.
     */
    async fetchSeries(coingeckoId: string): Promise<SourceResult<PriceSeries>> {
      const id = coingeckoId.trim();
      if (id.length === 0) return fail("invalid-symbol");

      const result = await requestJson({
        url: `${base}/${encodeURIComponent(
          id,
        )}/ohlc?vs_currency=usd&days=1`,
        headers,
        fetchImpl,
        now,
        // The free tier forbids an automatic retry; one 429 is the answer.
        retryOn429: false,
      });

      if (!result.ok) return coingeckoFailure(result);

      const points = parseOhlc(result.body);
      if (points === null) return fail("malformed-response");
      if (points.length === 0) return fail("malformed-response");

      return { ok: true, value: buildSeries(points, "coingecko", now()) };
    },
  };
}
