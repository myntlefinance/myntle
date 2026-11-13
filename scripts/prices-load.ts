/**
 * WebSocket load test for the price service.
 *
 *   bun run prices:load
 *   PRICES_WS_URL=ws://127.0.0.1:8818/ws SOCKETS=100 SECONDS=30 bun run prices:load
 *
 * Production gate:
 *   ulimit -n 4096
 *   PRICES_WS_URL=wss://myntle-prices.myntle.workers.dev/ws \
 *     SOCKETS=500 SECONDS=600 bun run prices:load
 *
 * Environment / arguments (arguments win):
 *   PRICES_WS_URL        | --ws                   default ws://127.0.0.1:8787/ws
 *   SOCKETS              | --sockets              default 500
 *   SECONDS              | --seconds              default 600
 *   ASSET_ID             | --asset                default nep141:wrap.near
 *   RAMP_MS              | --ramp                 default 5000
 *   MIN_PATCH_COVERAGE   | --min-patch-coverage   default 1 (100%)
 *
 * Uses Node 22's global WebSocket, so there is no `ws` dependency. Every
 * socket subscribes to one asset. A snapshot or patch only counts when its
 * frame carries that asset with a finite `usd > 0` and `asOf > 0`.
 *
 * Metrics:
 *   interval  gap between patches on one socket. It includes the immediate
 *             on-demand refresh and duplicate frames, so it is informational
 *             and never part of pass/fail. The feed cadence is ~10s.
 *   age       the quote's `asOf` at receipt. Informational: it includes the
 *             upstream fetch and is not a socket-load measurement.
 *   fanout    receipt minus the earliest receipt of an approximate batch
 *             grouped by (asOf, usd). This is the delivery latency the
 *             Durable Object adds under load, so the 1s budget applies here.
 *
 * Pass/fail: 100% of opened sockets got a valid snapshot, per-socket patch
 * coverage is at least MIN_PATCH_COVERAGE, zero drops, and p95 fan-out is
 * below 1000ms. Every requested socket must also have opened.
 */

import process from "node:process";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DEFAULTS = {
  ws: "ws://127.0.0.1:8787/ws",
  sockets: 500,
  seconds: 600,
  asset: "nep141:wrap.near",
  rampMs: 5_000,
  minPatchCoverage: 1,
} as const;

const FANOUT_BUDGET_MS = 1_000;
const FD_MARGIN = 100;
const CLOSE_GRACE_MS = 500;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (value === undefined) continue;
    if (value === `--${name}`) return process.argv[index + 1];
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return undefined;
}

function positiveInt(
  raw: string | undefined,
  fallback: number,
  label: string,
): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${label} must be a positive number, got "${raw}"`);
    process.exit(2);
  }
  return Math.floor(value);
}

function nonNegativeInt(
  raw: string | undefined,
  fallback: number,
  label: string,
): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    console.error(`${label} must be zero or a positive number, got "${raw}"`);
    process.exit(2);
  }
  return Math.floor(value);
}

function coverage(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    console.error(
      `MIN_PATCH_COVERAGE must be between 0 and 1, got "${raw}"`,
    );
    process.exit(2);
  }
  return value;
}

const WS_URL = (
  argument("ws") ??
  process.env.PRICES_WS_URL ??
  DEFAULTS.ws
).trim();
const SOCKETS = positiveInt(
  argument("sockets") ?? process.env.SOCKETS,
  DEFAULTS.sockets,
  "SOCKETS",
);
const SECONDS = positiveInt(
  argument("seconds") ?? process.env.SECONDS,
  DEFAULTS.seconds,
  "SECONDS",
);
const ASSET_ID = (
  argument("asset") ??
  process.env.ASSET_ID ??
  DEFAULTS.asset
).trim();
const RAMP_MS = nonNegativeInt(
  argument("ramp") ?? process.env.RAMP_MS,
  DEFAULTS.rampMs,
  "RAMP_MS",
);
const MIN_PATCH_COVERAGE = coverage(
  argument("min-patch-coverage") ?? process.env.MIN_PATCH_COVERAGE,
  DEFAULTS.minPatchCoverage,
);

if (RAMP_MS >= SECONDS * 1_000) {
  console.error(
    `RAMP_MS (${RAMP_MS}) must be less than SECONDS (${SECONDS}) in milliseconds.`,
  );
  process.exit(2);
}

if (typeof WebSocket === "undefined") {
  console.error(
    "This script needs Node 22's global WebSocket (or Bun). No ws dependency is used.",
  );
  process.exit(2);
}

/**
 * The open-file limit belongs to the process, not the runtime API: Node has
 * no `process.getrlimit`. Linux exposes it in /proc; elsewhere a POSIX shell
 * inherits the limit and can report it with `ulimit -n`.
 */
function readFdLimit(): number | null {
  if (process.platform === "linux") {
    try {
      const text = readFileSync("/proc/self/limits", "utf8");
      const match = /^Max open files\s+(\S+)/m.exec(text);
      if (match?.[1] !== undefined) {
        if (match[1] === "unlimited") return Number.POSITIVE_INFINITY;
        const value = Number(match[1]);
        if (Number.isFinite(value)) return value;
      }
    } catch {
      // Fall through to the shell.
    }
  }

  try {
    const raw = execFileSync("/bin/sh", ["-c", "ulimit -n"], {
      encoding: "utf8",
    }).trim();
    if (raw === "unlimited") return Number.POSITIVE_INFINITY;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function formatLimit(value: number | null): string {
  if (value === null) return "unknown";
  if (!Number.isFinite(value)) return "unlimited";
  return String(value);
}

const requiredFds = SOCKETS + FD_MARGIN;
const fdLimit = readFdLimit();

console.log(
  `fd_limit=${formatLimit(fdLimit)} required=${requiredFds} (SOCKETS + ${FD_MARGIN})`,
);

if (fdLimit === null) {
  console.error(
    "Could not read the open-file limit. On Unix, run `ulimit -n 4096` before this script.",
  );
  process.exit(1);
}

if (fdLimit < requiredFds) {
  console.error(
    `Open-file limit ${formatLimit(fdLimit)} is below ${requiredFds}; run "ulimit -n ${Math.max(4096, requiredFds)}" and retry.`,
  );
  process.exit(1);
}

const WebSocketImpl = WebSocket;

type AssetQuote = {
  usd: number;
  asOf: number;
};

type PatchRecord = {
  asOf: number;
  usd: number;
  receivedAt: number;
};

type SocketState = {
  index: number;
  socket: WebSocket | null;
  opened: boolean;
  snapshotted: boolean;
  snapshotFrames: number;
  patched: boolean;
  patchFrames: number;
  lastPatchAt: number | null;
  gaps: number[];
  records: PatchRecord[];
  errors: number;
  dropped: boolean;
  closing: boolean;
};

const states: SocketState[] = Array.from({ length: SOCKETS }, (_, index) => ({
  index,
  socket: null,
  opened: false,
  snapshotted: false,
  snapshotFrames: 0,
  patched: false,
  patchFrames: 0,
  lastPatchAt: null,
  gaps: [],
  records: [],
  errors: 0,
  dropped: false,
  closing: false,
}));

/**
 * The asset's tuple, but only when it is a usable quote. A frame that lacks
 * ASSET_ID, or carries a broken number, is not a delivered frame for this
 * test and must not count toward coverage.
 */
function assetQuote(prices: unknown): AssetQuote | null {
  if (!Array.isArray(prices)) return null;

  for (const entry of prices) {
    if (!Array.isArray(entry) || entry.length < 5) continue;
    if (entry[0] !== ASSET_ID) continue;

    const usd = entry[1];
    const asOf = entry[2];
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
      return null;
    }
    if (typeof asOf !== "number" || !Number.isFinite(asOf) || asOf <= 0) {
      return null;
    }
    return { usd, asOf };
  }

  return null;
}

function recordPatch(state: SocketState, frame: unknown): void {
  const receivedAt = Date.now();
  const body = frame as { prices?: unknown } | null;
  const quote = assetQuote(body?.prices);
  if (quote === null) return;

  state.patched = true;
  state.patchFrames += 1;
  state.records.push({
    asOf: quote.asOf,
    usd: quote.usd,
    receivedAt,
  });

  if (state.lastPatchAt !== null) {
    state.gaps.push(receivedAt - state.lastPatchAt);
  }
  state.lastPatchAt = receivedAt;
}

function recordFrame(state: SocketState, data: unknown): void {
  if (typeof data !== "string") return;

  let frame: { t?: unknown; prices?: unknown } | null = null;
  try {
    frame = JSON.parse(data) as { t?: unknown; prices?: unknown };
  } catch {
    return;
  }
  if (frame === null || typeof frame !== "object") return;

  if (frame.t === "snapshot") {
    if (assetQuote(frame.prices) === null) return;
    state.snapshotted = true;
    state.snapshotFrames += 1;
    return;
  }
  if (frame.t === "patch") recordPatch(state, frame);
}

function openSocket(state: SocketState): void {
  let socket: WebSocket;
  try {
    socket = new WebSocketImpl(WS_URL);
  } catch {
    state.errors += 1;
    state.dropped = true;
    return;
  }

  state.socket = socket;

  socket.onopen = () => {
    state.opened = true;
    try {
      socket.send(JSON.stringify({ t: "sub", assets: [ASSET_ID] }));
    } catch {
      state.errors += 1;
      state.dropped = true;
    }
  };

  socket.onmessage = (event: MessageEvent) => {
    recordFrame(state, event.data);
  };

  socket.onerror = () => {
    state.errors += 1;
    state.dropped = true;
  };

  socket.onclose = () => {
    if (!state.closing) state.dropped = true;
  };
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * fraction;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low] ?? null;
  const lower = sorted[low] ?? 0;
  const upper = sorted[high] ?? lower;
  return lower + (upper - lower) * (rank - low);
}

function formatMs(value: number | null): string {
  return value === null ? "-" : String(Math.round(value));
}

function closeAll(): void {
  for (const state of states) {
    const socket = state.socket;
    if (socket === null) continue;
    state.closing = true;
    try {
      socket.close(1000, "load-test-done");
    } catch {
      // A socket still connecting may refuse the close call; it is gone when
      // the process exits, and it is not counted as a drop.
    }
  }
}

function finish(): void {
  closeAll();

  setTimeout(() => {
    const opened = states.filter((state) => state.opened).length;
    const snapshotSockets = states.filter(
      (state) => state.opened && state.snapshotted,
    ).length;
    const snapshotFrames = states.reduce(
      (sum, state) => sum + state.snapshotFrames,
      0,
    );
    const patchedSockets = states.filter(
      (state) => state.opened && state.patched,
    ).length;
    const patchFrames = states.reduce(
      (sum, state) => sum + state.patchFrames,
      0,
    );
    const errors = states.reduce((sum, state) => sum + state.errors, 0);
    const drops = states.reduce(
      (sum, state) => sum + (state.dropped ? 1 : 0),
      0,
    );

    const gaps = states.flatMap((state) => state.gaps);
    const records = states.flatMap((state) => state.records);
    const ages = records.map((record) =>
      Math.max(0, record.receivedAt - record.asOf),
    );

    // (asOf, usd) is an approximate batch key. A tick publishes one usd per
    // asset, so equal observations with different values are different
    // batches. A single-record group is an on-demand refresh, not fan-out.
    const batches = new Map<string, PatchRecord[]>();
    for (const record of records) {
      const key = `${record.asOf}:${record.usd}`;
      const batch = batches.get(key);
      if (batch === undefined) batches.set(key, [record]);
      else batch.push(record);
    }
    const fanouts: number[] = [];
    let fanoutBatches = 0;
    for (const batch of batches.values()) {
      if (batch.length < 2) continue;
      fanoutBatches += 1;
      const earliest = Math.min(...batch.map((record) => record.receivedAt));
      for (const record of batch) {
        fanouts.push(Math.max(0, record.receivedAt - earliest));
      }
    }

    const gap50 = percentile(gaps, 0.5);
    const gap95 = percentile(gaps, 0.95);
    const gap99 = percentile(gaps, 0.99);
    const age50 = percentile(ages, 0.5);
    const age95 = percentile(ages, 0.95);
    const age99 = percentile(ages, 0.99);
    const fanout50 = percentile(fanouts, 0.5);
    const fanout95 = percentile(fanouts, 0.95);
    const fanout99 = percentile(fanouts, 0.99);

    const openedOk = opened === SOCKETS;
    const snapshotOk = opened === SOCKETS && snapshotSockets === opened;
    const patchCoverage =
      opened > 0 ? patchedSockets / opened : 0;
    const coverageOk = patchCoverage >= MIN_PATCH_COVERAGE;
    const dropsOk = drops === 0;
    const fanoutOk =
      fanout95 !== null && fanout95 < FANOUT_BUDGET_MS;
    const everySocketPatched = patchedSockets === SOCKETS;
    const passed =
      openedOk && snapshotOk && coverageOk && dropsOk && fanoutOk;

    console.log(
      `prices load  ws=${WS_URL} asset=${ASSET_ID} sockets=${SOCKETS} seconds=${SECONDS} ramp=${RAMP_MS}ms`,
    );
    console.log(
      `opened=${opened}/${SOCKETS} snapshots=${snapshotFrames} snapshot_sockets=${snapshotSockets}/${opened}`,
    );
    console.log(
      `patches=${patchFrames} patched_sockets=${patchedSockets}/${opened} coverage=${(patchCoverage * 100).toFixed(2)}% min=${(MIN_PATCH_COVERAGE * 100).toFixed(2)}%`,
    );
    console.log(`every_socket_patched=${everySocketPatched}`);
    console.log(
      `interval_ms  p50=${formatMs(gap50)} p95=${formatMs(gap95)} p99=${formatMs(gap99)} (all frames, informational; includes on-demand)`,
    );
    console.log(
      `age_ms       p50=${formatMs(age50)} p95=${formatMs(age95)} p99=${formatMs(age99)} (asOf to receipt, informational)`,
    );
    console.log(
      `fanout_ms    p50=${formatMs(fanout50)} p95=${formatMs(fanout95)} p99=${formatMs(fanout99)} (budget p95<${FANOUT_BUDGET_MS}) batches=${fanoutBatches} (approx. asOf+usd)`,
    );
    console.log(`errors=${errors} drops=${drops}`);
    console.log(
      `checks opened_ok=${openedOk} snapshot_ok=${snapshotOk} coverage_ok=${coverageOk} drops_ok=${dropsOk} fanout_ok=${fanoutOk}`,
    );

    if (!passed) {
      const reasons: string[] = [];
      if (!openedOk) {
        reasons.push(`${opened}/${SOCKETS} socket(s) opened`);
      }
      if (!snapshotOk) {
        reasons.push(
          `${snapshotSockets}/${opened} opened socket(s) received a valid snapshot`,
        );
      }
      if (!coverageOk) {
        reasons.push(
          `patch coverage ${(patchCoverage * 100).toFixed(2)}% < ${(MIN_PATCH_COVERAGE * 100).toFixed(2)}%`,
        );
      }
      if (!dropsOk) reasons.push(`${drops} dropped socket(s)`);
      if (!fanoutOk) {
        reasons.push(
          fanouts.length === 0
            ? "no batched patches received"
            : `p95 fan-out ${formatMs(fanout95)}ms >= ${FANOUT_BUDGET_MS}ms`,
        );
      }
      console.log(`result  FAIL (${reasons.join("; ")})`);
    } else {
      console.log("result  PASS");
    }

    process.exit(passed ? 0 : 1);
  }, CLOSE_GRACE_MS);
}

console.log(
  `opening ${SOCKETS} socket(s) over ${RAMP_MS}ms, holding for ${SECONDS}s`,
);

const rampStep = SOCKETS <= 1 ? 0 : RAMP_MS / (SOCKETS - 1);
for (const state of states) {
  const delay = Math.round(state.index * rampStep);
  setTimeout(() => {
    openSocket(state);
  }, delay);
}

setTimeout(finish, SECONDS * 1_000);
