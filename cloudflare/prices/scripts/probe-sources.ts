/**
 * Live probe for the source adapters. Development only: it makes real network
 * calls and reads keys from the environment (Bun loads `.env.local` when run
 * from the repo root, and the fallback below covers any other cwd).
 *
 * It never prints a key or an upstream body. Every row reports the source, the
 * outcome, the item count, the elapsed time, and whether a key was present.
 *
 *   bun run prices:probe-sources
 */
import { readFile } from "node:fs/promises";
import { createSources } from "../src/sources/index";
import type { SourceResult } from "../src/sources/types";

const ENV_FILE = new URL("../../../.env.local", import.meta.url);
/** Sample prices and changePct are opt-in: the default view is counts only. */
const VERBOSE = process.env.PRICES_PROBE_VERBOSE === "1";
const PAIRS = ["BTCUSDT", "ETHUSDT", "NEARUSDT", "LINKUSDT"];
const SYMBOLS = ["BTC", "ETH", "NEAR", "LINK"];
/** Three catalogue identities: the wrapped NEAR, bridged ETH, and native BTC. */
const ASSET_IDS = [
  "nep141:wrap.near",
  "nep141:eth.bridge.near",
  "nep141:btc.omft.near",
];

async function loadEnvLocal(): Promise<void> {
  if (process.env.ALCHEMY_API_KEY !== undefined) return;

  try {
    const text = await readFile(ENV_FILE, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match === null) continue;

      const name = match[1];
      const raw = match[2];
      if (name === undefined || raw === undefined) continue;
      if (process.env[name] !== undefined) continue;

      process.env[name] = raw.trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // No file is fine: the keys may already be in the environment.
  }
}

function countOf(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object" && value !== null) {
    const points = (value as { points?: unknown }).points;
    if (Array.isArray(points)) return points.length;
  }
  return 0;
}

type Row = {
  label: string;
  ok: boolean;
  status: number | null;
  count: number;
  ms: number;
  keyPresent: boolean;
  error?: string;
  detail?: string;
};

async function run<T>(
  label: string,
  call: () => Promise<SourceResult<T>>,
  keyPresent: boolean,
  detail?: (value: T) => string,
): Promise<Row> {
  const started = performance.now();
  const result = await call();
  const ms = Math.round(performance.now() - started);

  return {
    label,
    ok: result.ok,
    status: result.ok ? 200 : (result.status ?? null),
    count: result.ok ? countOf(result.value) : 0,
    ms,
    keyPresent,
    ...(result.ok ? {} : { error: result.error }),
    ...(result.ok && detail !== undefined ? { detail: detail(result.value) } : {}),
  };
}

function quoteDetail(quotes: { symbol: string; usd: number }[]): string {
  return quotes
    .slice(0, 3)
    .map((quote) => `${quote.symbol}=${quote.usd}`)
    .join(" ");
}

function print(row: Row): void {
  const outcome = row.ok ? "ok" : "FAIL";
  const status = row.status === null ? "-" : String(row.status);
  const line = [
    row.label.padEnd(20),
    outcome.padEnd(4),
    `status=${status.padEnd(4)}`,
    `count=${String(row.count).padEnd(4)}`,
    `ms=${String(row.ms).padEnd(5)}`,
    `key=${row.keyPresent ? "present" : "absent"}`,
    row.error === undefined ? "" : `error=${row.error}`,
    VERBOSE ? (row.detail ?? "") : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
  console.log(line);
}

await loadEnvLocal();

const alchemyKey = process.env.ALCHEMY_API_KEY;
const coingeckoKey = process.env.COINGECKO_API_KEY;
const binanceUsKey = process.env.BINANCE_US_API_KEY;
const binanceGlobal =
  process.env.BINANCE_GLOBAL === "1" || process.env.BINANCE_GLOBAL === "true";

const sources = createSources({
  alchemyKey,
  coingeckoKey,
  binanceUsKey,
  binanceGlobal,
});

console.log(
  `sources: binanceGlobal=${binanceGlobal ? "on" : "off"} alchemyKey=${alchemyKey ? "present" : "absent"} coingeckoKey=${coingeckoKey ? "present" : "absent"}`,
);

const rows: Row[] = [];

rows.push(
  await run(
    "binance.current",
    () => sources.binance.fetchCurrent(PAIRS),
    Boolean(binanceUsKey),
    quoteDetail,
  ),
);

rows.push(
  await run(
    "binance.series",
    () => sources.binance.fetchSeries("NEARUSDT"),
    Boolean(binanceUsKey),
    (series) => `points=${series.points.length} changePct=${series.changePct}`,
  ),
);

rows.push(
  await run(
    "alchemy.current",
    () => sources.alchemy.fetchCurrent(SYMBOLS),
    Boolean(alchemyKey),
    quoteDetail,
  ),
);

rows.push(
  await run(
    "alchemy.series",
    () => sources.alchemy.fetchSeries("NEAR"),
    Boolean(alchemyKey),
    (series) => `points=${series.points.length} changePct=${series.changePct}`,
  ),
);

rows.push(
  await run(
    "coingecko.series",
    () => sources.coingecko.fetchSeries("near"),
    Boolean(coingeckoKey),
    (series) => `points=${series.points.length} changePct=${series.changePct}`,
  ),
);

rows.push(
  await run(
    "oneclick.current",
    () => sources.oneclick.fetchCurrent(),
    false,
    (quotes) =>
      ASSET_IDS.map((assetId) => {
        const quote = quotes.find((entry) => entry.assetId === assetId);
        return `${assetId}=${quote === undefined ? "missing" : quote.usd}`;
      }).join(" "),
  ),
);

for (const row of rows) print(row);

if (!VERBOSE) {
  console.log(
    "hint: set PRICES_PROBE_VERBOSE=1 for sample prices and changePct",
  );
}

const failed = rows.filter((row) => !row.ok).length;
console.log(`checks=${rows.length} ok=${rows.length - failed} failed=${failed}`);

// A probe that cannot reach the primary or the always-available fallback is a
// real outage. A single missing key or a CoinGecko rate limit is not.
const binance = rows.find((row) => row.label === "binance.current");
const oneclick = rows.find((row) => row.label === "oneclick.current");
if (binance?.ok === false && oneclick?.ok === false) {
  process.exitCode = 1;
}
