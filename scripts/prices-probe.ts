/**
 * Live probe for the price service. Run it before every deploy and after
 * every source change.
 *
 *   bun run prices:probe
 *   PRICES_BASE_URL=http://127.0.0.1:8818 PRICES_PROBE_KEY=<key> bun run prices:probe
 *
 * Environment:
 *   PRICES_BASE_URL    default https://myntle-prices.myntle.workers.dev
 *   PRICES_PROBE_KEY   the Worker's PROBE_KEY secret. Falls back to PROBE_KEY.
 *   PRICES_ASSET_ID    default nep141:wrap.near
 *   PRICES_MAX_AGE_MS  maximum quote age, and the freshness floor for the
 *                      last tick. Default 15000.
 *
 * The output never prints a key and never prints an upstream body, only the
 * fields the checks need. Exit code 1 means at least one check failed.
 */

import process from "node:process";

const BASE_URL = (
  process.env.PRICES_BASE_URL?.trim() ||
  "https://myntle-prices.myntle.workers.dev"
).replace(/\/+$/, "");
const PROBE_KEY =
  process.env.PRICES_PROBE_KEY?.trim() ||
  process.env.PROBE_KEY?.trim() ||
  "";
const ASSET_ID =
  process.env.PRICES_ASSET_ID?.trim() || "nep141:wrap.near";

/** A quote older than this is not a live quote, whatever its source says. */
const MAX_AGE_MS = positiveIntEnv("PRICES_MAX_AGE_MS", 15_000);
/** A cold object may need its first alarm tick before /health is green. */
const READY_WAIT_MS = 20_000;
const READY_POLL_MS = 1_000;
/**
 * A health read that lands during a tick can briefly report a `nextAlarmAt`
 * that is already past (the handler has not rescheduled yet). Re-sample for a
 * few seconds so a transient does not fail a healthy feed; a feed that is
 * genuinely stale never becomes fresh and still fails.
 */
const STABLE_WAIT_MS = 5_000;
const STABLE_POLL_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;
/** The service promises exactly 48 half-hour points for a 24h series. */
const EXPECTED_POINTS = 48;
/** The schema-4 upgrade is the first version with the series table. */
const MIN_SCHEMA_VERSION = 4;

type Json = Record<string, unknown>;

type Reply = {
  status: number;
  ms: number;
  body: Json | null;
  error: string | null;
};

type Check = {
  name: string;
  ok: boolean;
  ms: number;
  detail: string;
};

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} must be a positive number, got "${raw}"`);
    process.exit(2);
  }
  return Math.floor(value);
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Json | null {
  return isRecord(value) ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Wire points must carry real numbers, not numeric strings. */
function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? "timeout" : error.message;
  }
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function request(
  path: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const started = Date.now();

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let body: Json | null = null;
    try {
      body = asRecord(JSON.parse(text));
    } catch {
      body = null;
    }

    return {
      status: response.status,
      ms: Date.now() - started,
      body,
      error: null,
    };
  } catch (error) {
    return {
      status: 0,
      ms: Date.now() - started,
      body: null,
      error: describeError(error),
    };
  }
}

function ready(reply: Reply): boolean {
  const body = asRecord(reply.body);
  const tick = asNumber(body?.lastTickAt);
  const snapshot = asNumber(body?.snapshotAssets) ?? 0;
  return reply.status === 200 && tick !== null && tick > 0 && snapshot > 0;
}

/** The freshness fields the tick/feed checks will accept. */
function feedFresh(reply: Reply): boolean {
  if (!ready(reply)) return false;

  const body = asRecord(reply.body);
  const serverNow = asNumber(body?.now) ?? Date.now();
  const lastTickAt = asNumber(body?.lastTickAt);
  const intervalMs = asNumber(body?.intervalMs);
  const nextAlarmAt = asNumber(body?.nextAlarmAt);
  const snapshotAssets = asNumber(body?.snapshotAssets) ?? 0;
  const snapshotStale = asNumber(body?.snapshotStale);

  if (lastTickAt === null) return false;
  if (intervalMs === null || intervalMs <= 0) return false;
  if (nextAlarmAt === null || nextAlarmAt <= serverNow) return false;
  if (snapshotStale === null || snapshotStale >= snapshotAssets) return false;

  const maxTickAgeMs = Math.max(2 * intervalMs + 5_000, MAX_AGE_MS);
  return serverNow - lastTickAt <= maxTickAgeMs;
}

/**
 * A fresh local Durable Object has no catalogue and no tick yet. Wait for the
 * first one rather than failing the probe on a cold but healthy service, then
 * re-sample briefly if the read landed inside a tick. The last reply is
 * returned even after the deadlines so the table shows why.
 */
async function readHealth(): Promise<Reply> {
  const deadline = Date.now() + READY_WAIT_MS;
  let reply = await request("/health");

  while (!ready(reply) && Date.now() < deadline) {
    await sleep(READY_POLL_MS);
    reply = await request("/health");
  }

  const stableDeadline = Date.now() + STABLE_WAIT_MS;
  while (
    ready(reply) &&
    !feedFresh(reply) &&
    Date.now() < stableDeadline
  ) {
    await sleep(STABLE_POLL_MS);
    reply = await request("/health");
  }

  return reply;
}

function connectionDetail(reply: Reply): string {
  if (reply.error !== null) return `error=${reply.error}`;
  return `http=${reply.status}`;
}

function pushConnections(checks: Check[], reply: Reply): void {
  checks.push({
    name: "health",
    ok: reply.status === 200 && reply.body !== null,
    ms: reply.ms,
    detail: connectionDetail(reply),
  });
}

function pushHealthFields(checks: Check[], reply: Reply): void {
  const body = asRecord(reply.body);
  const schemaVersion = asNumber(body?.schemaVersion);
  const schemaOk = body?.schemaOk === true;
  const assets = asNumber(body?.assets) ?? 0;
  const snapshotAssets = asNumber(body?.snapshotAssets) ?? 0;
  const snapshotStale = asNumber(body?.snapshotStale);
  const lastTickAt = asNumber(body?.lastTickAt);
  const intervalMs = asNumber(body?.intervalMs);
  const nextAlarmAt = asNumber(body?.nextAlarmAt);
  const serverNow = asNumber(body?.now) ?? Date.now();
  const breakers = asRecord(body?.breakers);
  const breakerRows = breakers ? Object.entries(breakers) : [];
  const breakersClosed =
    breakerRows.length > 0 &&
    breakerRows.every(([, value]) => asRecord(value)?.state === "closed");
  const breakersDetail =
    breakerRows.length === 0
      ? "missing"
      : breakerRows
          .map(([name, value]) => {
            const state = asRecord(value)?.state;
            return `${name}=${typeof state === "string" ? state : "unknown"}`;
          })
          .join(" ");

  checks.push({
    name: "health.schema",
    ok:
      schemaVersion !== null &&
      schemaVersion >= MIN_SCHEMA_VERSION &&
      schemaOk,
    ms: 0,
    detail: `version=${schemaVersion ?? "-"} ok=${schemaOk}`,
  });

  // The snapshot can be warm from a restart, but it must not be a feed whose
  // prices have all aged out. A full stale snapshot is the failure this check
  // exists for.
  checks.push({
    name: "health.feed",
    ok:
      assets > 0 &&
      snapshotAssets > 0 &&
      snapshotStale !== null &&
      snapshotStale >= 0 &&
      snapshotStale < snapshotAssets,
    ms: 0,
    detail: `assets=${assets} snapshot=${snapshotAssets} stale=${snapshotStale ?? "-"}`,
  });

  const lastTickAge =
    lastTickAt !== null ? serverNow - lastTickAt : null;
  // Two ticks plus five seconds of delivery slack, never below the configured
  // quote age. `intervalMs` comes from the service, not from this script.
  const maxTickAgeMs =
    intervalMs !== null && intervalMs > 0
      ? Math.max(2 * intervalMs + 5_000, MAX_AGE_MS)
      : null;
  const nextAlarmIn =
    nextAlarmAt !== null ? nextAlarmAt - serverNow : null;

  checks.push({
    name: "health.tick",
    ok:
      lastTickAge !== null &&
      lastTickAge >= 0 &&
      maxTickAgeMs !== null &&
      lastTickAge <= maxTickAgeMs &&
      nextAlarmIn !== null &&
      nextAlarmIn > 0,
    ms: 0,
    detail: `age=${lastTickAge ?? "-"}ms max_age=${maxTickAgeMs ?? "-"}ms interval=${intervalMs ?? "-"}ms next_alarm_in=${nextAlarmIn ?? "-"}ms`,
  });

  checks.push({
    name: "health.breakers",
    ok: breakersClosed,
    ms: 0,
    detail: breakersDetail,
  });
}

function pushPrices(checks: Check[], reply: Reply): void {
  const prices = asRecord(asRecord(reply.body)?.prices);
  const quote = asRecord(prices?.[ASSET_ID]);
  const usd = asNumber(quote?.usd);
  const asOf = asNumber(quote?.asOf);
  const stale = quote?.stale;
  const source = quote?.source;
  const ageMs = asOf !== null ? Date.now() - asOf : null;
  const ok =
    reply.status === 200 &&
    usd !== null &&
    usd > 0 &&
    asOf !== null &&
    asOf > 0 &&
    stale === false &&
    ageMs !== null &&
    ageMs <= MAX_AGE_MS &&
    typeof source === "string" &&
    source.length > 0;

  checks.push({
    name: "prices",
    ok,
    ms: reply.ms,
    detail:
      reply.error !== null
        ? `error=${reply.error}`
        : quote === null
          ? `http=${reply.status} missing=${ASSET_ID}`
          : `usd=${usd ?? "-"} age=${ageMs ?? "-"}ms max_age=${MAX_AGE_MS}ms stale=${String(stale)} source=${typeof source === "string" ? source : "-"}`,
  });
}

function pushHistory(checks: Check[], reply: Reply): void {
  const body = asRecord(reply.body);
  const points = Array.isArray(body?.points) ? body.points : null;
  const changePct = asNumber(body?.changePct);
  const source = body?.source;

  let invalid = 0;
  let sorted = true;
  let previous = Number.NEGATIVE_INFINITY;

  if (points !== null) {
    for (const entry of points) {
      const record = asRecord(entry);
      const time = finiteNumber(record?.time);
      const value = finiteNumber(record?.value);
      if (time === null || value === null) {
        invalid += 1;
        continue;
      }
      if (time < previous) sorted = false;
      previous = time;
    }
  }

  const ok =
    reply.status === 200 &&
    points !== null &&
    points.length === EXPECTED_POINTS &&
    invalid === 0 &&
    sorted &&
    changePct !== null;

  checks.push({
    name: "history",
    ok,
    ms: reply.ms,
    detail:
      reply.error !== null
        ? `error=${reply.error}`
        : `http=${reply.status} points=${points?.length ?? "-"} invalid=${invalid} sorted=${sorted} changePct=${changePct ?? "-"} source=${typeof source === "string" ? source : "-"}`,
  });
}

function pushProbe(checks: Check[], reply: Reply): void {
  const body = asRecord(reply.body);
  const checksBody = asRecord(body?.checks);
  const klines = asRecord(checksBody?.klines);
  const points = asNumber(klines?.points);
  const colo = body?.colo;
  const ok = reply.status === 200 && points === EXPECTED_POINTS;

  checks.push({
    name: "probe",
    ok,
    ms: reply.ms,
    detail:
      PROBE_KEY.length === 0
        ? "PRICES_PROBE_KEY is not set"
        : reply.error !== null
          ? `error=${reply.error}`
          : `http=${reply.status} colo=${typeof colo === "string" ? colo : "-"} klines=${points ?? "-"}`,
  });
}

function printTable(checks: Check[]): void {
  const nameWidth = Math.max(15, ...checks.map((check) => check.name.length));
  const statusWidth = 6;

  console.log(
    `${"check".padEnd(nameWidth)}  ${"status".padEnd(statusWidth)}  ${"ms".padStart(5)}  detail`,
  );
  console.log(
    `${"-".repeat(nameWidth)}  ${"-".repeat(statusWidth)}  ${"-".repeat(5)}  ${"-".repeat(30)}`,
  );

  for (const check of checks) {
    console.log(
      `${check.name.padEnd(nameWidth)}  ${(check.ok ? "ok" : "FAIL").padEnd(statusWidth)}  ${String(check.ms).padStart(5)}  ${check.detail}`,
    );
  }
}

const health = await readHealth();
const checks: Check[] = [];

pushConnections(checks, health);
pushHealthFields(checks, health);
pushPrices(
  checks,
  await request(`/prices?assets=${encodeURIComponent(ASSET_ID)}`),
);
pushHistory(
  checks,
  await request(
    `/history?asset=${encodeURIComponent(ASSET_ID)}&range=24h`,
  ),
);
pushProbe(
  checks,
  await request("/probe", {
    ...(PROBE_KEY.length > 0 ? { "x-probe-key": PROBE_KEY } : {}),
  }),
);

printTable(checks);

const failed = checks.filter((check) => !check.ok).length;
console.log(
  `checks=${checks.length} ok=${checks.length - failed} failed=${failed}`,
);

process.exit(failed === 0 ? 0 : 1);
