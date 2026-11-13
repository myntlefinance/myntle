import { DurableObject } from "cloudflare:workers";
import {
  CATALOGUE_BACKOFF_MS,
  CATALOGUE_TTL_MS,
  fetchCatalogue,
  shouldPruneAssets,
} from "./catalogue";
import type { Env } from "./env";
import {
  buildSeriesRow,
  decodeSeriesRow,
  encodeSeriesPoints,
  failedSeriesRow,
  isSeriesFresh,
  noHistory,
  presentHistory,
  seriesCacheKey,
  type HistoryResponse,
  type SeriesRange,
  type SeriesRow,
  type SeriesRowRecord,
} from "./history";
import {
  createBreaker,
  type Breaker,
  type BreakerSnapshot,
} from "./lib/breaker";
import { createSingleFlight, drainMisses } from "./lib/single-flight";
import {
  ACTIVE_INTERVAL_MS,
  catalogueDue,
  decodeSnapshot,
  deriveSources,
  encodeSnapshot,
  HOT_SYMBOLS,
  hotQuerySymbols,
  intervalMs,
  liveQuotes,
  mergeQuotes,
  needsRefresh,
  pickHotAssetIds,
  presentPrices,
  pruneRecent,
  scheduledAlarmAt,
  trackRecent,
  watchedAssets,
  type Quote,
  type QuoteView,
} from "./prices";
import {
  describeError,
  hasFullKlineSeries,
  KLINE_POINTS,
  parseColo,
  parseJson,
  parseKlines,
  parseTickerPrices,
} from "./probe";
import {
  encodeFrame,
  errorFrame,
  MAX_SOCKET_ASSETS,
  parseClientFrame,
  planSubscriptions,
  planUnsubscriptions,
  unknownAssetsFrame,
} from "./protocol";
import { buildRegistry, REGISTRY_VERSION, type PriceSource } from "./registry";
import { createSources } from "./sources";
import { withBreaker } from "./sources/guard";
import {
  createPriceResolver,
  type PriceResolver,
  type ResolverAsset,
} from "./sources/resolve";
import type { SourceConfig } from "./sources/types";
import {
  buildSnapshotFrame,
  decodeAttachment,
  encodeAttachment,
  fanOut,
  filterKnownAssets,
  noteMessage,
  publishIds,
  unionSocketAssets,
  type RateWindow,
} from "./ws";

export const SERVICE = "myntle-prices";
export const SCHEMA_VERSION = "4";

/**
 * One request, HTTP or socket, may ask for at most this many assets. The two
 * paths share the cap so a client cannot learn a bigger universe over one than
 * the other.
 */
export const MAX_ASSETS = MAX_SOCKET_ASSETS;
const MAX_ASSET_ID_LENGTH = 200;
const SNAPSHOT_ID = "current";
/** A cold object fills its hot set before a client has to ask for it. */
const FIRST_TICK_MS = 1_000;

/** The budget for future price fetches; the probe gets more room on purpose. */
const TIMEOUT_MS = 4_000;
// A cold isolate pays TLS setup before the first upstream byte, so the probe
// separates "slow to warm up" from "blocked" instead of reporting a timeout.
const PROBE_TIMEOUT_MS = 10_000;
// The catalogue refresh and the pair list are cold-path work, so they get the
// same tolerance as the probe rather than the hot-path budget.
const SYNC_TIMEOUT_MS = 8_000;
const BINANCE_US = "https://api.binance.us/api/v3";
const TRACE_URL = "https://cloudflare.com/cdn-cgi/trace";
const TICKER_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "NEARUSDT",
  "LINKUSDT",
];
const TICKER_URL = `${BINANCE_US}/ticker/price?symbols=${encodeURIComponent(
  JSON.stringify(TICKER_SYMBOLS),
)}`;
const ALL_PAIRS_URL = `${BINANCE_US}/ticker/price`;
const KLINES_URL = `${BINANCE_US}/klines?symbol=NEARUSDT&interval=30m&limit=${KLINE_POINTS}`;

type FetchResult = {
  status: number | null;
  ms: number;
  text: string;
  error?: string;
};

type Check = {
  ok: boolean;
  status: number | null;
  ms: number;
  slow: boolean;
  error?: string;
};

export type BinanceSymbolsStatus = "live" | "cached" | "empty";

export type CatalogueStats = {
  /** Number of asset rows, not distinct underlyings: one ticker can span chains. */
  total: number;
  /** Row counts by primary source, so they sum to `total`. */
  bySource: Record<PriceSource, number>;
  /** Distinct Binance.US pairs the registry maps to; rows may share one pair. */
  binanceDistinctPairs: number;
  /** Distinct Alchemy symbols the registry maps to; rows may share one symbol. */
  alchemyCandidates: number;
  /** Whether the last sync used a live pair fetch, the cached list, or neither. */
  binanceSymbols: BinanceSymbolsStatus;
  syncedAt: number | null;
  stale: boolean;
  registryVersion: string | null;
};

export type CatalogueSyncResult = CatalogueStats & {
  refreshed: boolean;
  error?: string;
};

export type RefreshSummary = {
  requested: number;
  fetched: number;
  /** Ids that were attempted and did not answer; their prior quote is stale. */
  failed: string[];
  skippedFresh: number;
  unknown: number;
  attempts: number;
  /**
   * Ids that received a new quote in this refresh, across every drain round.
   * The tick and a socket `sub` publish exactly these, so a client is never
   * sent a patch for an asset that did not move.
   */
  updated: string[];
};

export type PricesResponse = {
  prices: Record<string, QuoteView | null>;
  asOf: number;
};

/** The full shape health() expects; a schema-1 row must not report healthy. */
const EXPECTED_ASSETS_COLUMNS = [
  "asset_id",
  "symbol",
  "chain",
  "contract",
  "decimals",
  "coingecko_id",
  "binance_symbol",
  "alchemy_symbol",
  "alchemy_network",
  "alchemy_address",
  "primary_source",
  "catalogue_price",
  "catalogue_price_updated_at",
  "updated_at",
];

const EXPECTED_SNAPSHOT_COLUMNS = ["id", "payload", "as_of"];

const EXPECTED_SERIES_COLUMNS = [
  "asset_id",
  "range",
  "points",
  "change_pct",
  "source",
  "fetched_at",
];

type BatchOutcome = {
  summary: RefreshSummary;
  /** Every id this batch looked at or consciously skipped. */
  decided: Set<string>;
};

type AssetRow = {
  asset_id: string;
  symbol: string;
  coingecko_id: string | null;
  binance_symbol: string | null;
  alchemy_symbol: string | null;
  primary_source: string;
};

type Breakers = Record<
  "binance" | "alchemy" | "oneclick" | "coingecko",
  Breaker
>;

function toCheck(result: FetchResult, usable: boolean): Check {
  const check: Check = {
    ok: result.status === 200 && result.error === undefined && usable,
    status: result.status,
    ms: result.ms,
    slow: result.ms > TIMEOUT_MS,
  };
  if (result.error !== undefined) check.error = result.error;
  return check;
}

function primarySource(value: string): PriceSource | null {
  return value === "binance" || value === "alchemy" || value === "oneclick"
    ? value
    : null;
}

function normalizeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const wanted: string[] = [];
  for (const raw of ids) {
    const assetId = raw.trim();
    if (
      assetId.length === 0 ||
      assetId.length > MAX_ASSET_ID_LENGTH ||
      seen.has(assetId)
    ) {
      continue;
    }
    seen.add(assetId);
    wanted.push(assetId);
  }
  return wanted;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function emptySummary(): RefreshSummary {
  return {
    requested: 0,
    fetched: 0,
    failed: [],
    skippedFresh: 0,
    unknown: 0,
    attempts: 0,
    updated: [],
  };
}

export class PriceDesk extends DurableObject<Env> {
  /** The live map. A quote is never replaced with zero. */
  private current = new Map<string, Quote>();
  /** assetId → last HTTP request, the demand signal for the fast cadence. */
  private recent = new Map<string, number>();
  /** One refresh at a time, shared by the alarm and every HTTP request. */
  private readonly flight = createSingleFlight<BatchOutcome>();
  /**
   * One history fetch per (asset, range). A second card opening on the same
   * token joins the first fetch instead of spending the same upstream call
   * twice; different assets run in parallel.
   */
  private readonly seriesFlights = new Map<string, Promise<SeriesRow>>();
  private readonly resolver: PriceResolver;
  private readonly breakers: Breakers;
  private hotIds: string[] = [];
  private lastTickAt: number | null = null;
  private snapshotAsOf: number | null = null;
  private lastRefreshMs: number | null = null;
  private lastAttempts = 0;
  /** True when the in-memory map changed and the snapshot is behind it. */
  private dirty = false;
  /** A failed catalogue fetch is not retried on every tick. */
  private catalogueBackoffUntil = 0;
  /**
   * The per-socket rate window. This is deliberately not in the attachment:
   * the attachment is the subscription set that must survive hibernation, and
   * a capacity guard is allowed to reset when the object wakes.
   */
  private readonly socketWindows = new Map<WebSocket, RateWindow>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const config: SourceConfig = {
      alchemyKey: env.ALCHEMY_API_KEY,
      binanceUsKey: env.BINANCE_US_API_KEY,
      coingeckoKey: env.COINGECKO_API_KEY,
      coingeckoProKey: env.COINGECKO_PRO_API_KEY,
      binanceGlobal: env.BINANCE_GLOBAL === "1",
    };

    // One graph for the whole object: the Binance global-host cooldown and
    // the 1Click catalogue cache live in these instances, so the alarm and an
    // HTTP request share them rather than building their own.
    const sources = createSources(config);
    this.breakers = {
      binance: createBreaker({ failures: 3, openMs: 60_000 }),
      alchemy: createBreaker({ failures: 3, openMs: 60_000 }),
      oneclick: createBreaker({ failures: 3, openMs: 60_000 }),
      coingecko: createBreaker({ failures: 3, openMs: 60_000 }),
    };
    this.resolver = createPriceResolver(
      {
        binance: withBreaker(sources.binance, this.breakers.binance, "binance"),
        alchemy: withBreaker(sources.alchemy, this.breakers.alchemy, "alchemy"),
        oneclick: withBreaker(
          sources.oneclick,
          this.breakers.oneclick,
          "oneclick",
        ),
        coingecko: withBreaker(
          sources.coingecko,
          this.breakers.coingecko,
          "coingecko",
        ),
      },
      config,
    );

    // Storage setup only. No network here: an uncaught throw would leave the
    // object unusable instead of just failing one request.
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      // The registry is the catalogue plus the source decision. It is written
      // once per refresh and read on wake; no request touches 1Click.
      ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS assets (
          asset_id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          chain TEXT NOT NULL,
          contract TEXT,
          decimals INTEGER NOT NULL,
          coingecko_id TEXT,
          binance_symbol TEXT,
          alchemy_symbol TEXT,
          alchemy_network TEXT,
          alchemy_address TEXT,
          primary_source TEXT NOT NULL,
          catalogue_price REAL,
          catalogue_price_updated_at INTEGER,
          updated_at INTEGER NOT NULL
        )`,
      );
      // One row, not one per asset: a tick writes the whole map once.
      ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS snapshot (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          as_of INTEGER NOT NULL
        )`,
      );
      // One row per (asset, range). A schema-3 object has no table here, so
      // the IF NOT EXISTS creates it on the first wake and the version below
      // records the upgrade.
      ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS series (
          asset_id TEXT NOT NULL,
          range TEXT NOT NULL,
          points TEXT NOT NULL,
          change_pct REAL,
          source TEXT NOT NULL,
          fetched_at INTEGER NOT NULL,
          PRIMARY KEY (asset_id, range)
        )`,
      );
      // Upsert so a later version bump repairs an old row instead of leaving
      // /health stuck on 503.
      ctx.storage.sql.exec(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        SCHEMA_VERSION,
      );

      this.loadSnapshot();
      this.hotIds = this.resolveHotIds();
      // Exactly one alarm: leave a scheduled one alone, give a cold object a
      // quick first tick. The alarm is the only scheduler in this object.
      await this.ensureAlarm(FIRST_TICK_MS);
    });
  }

  /**
   * The socket entry point. The Worker has already checked the Origin and the
   * Upgrade header; this side only owns the connection. `ctx.acceptWebSocket`
   * is the hibernation API, so the socket survives eviction and its attachment
   * is restored by the runtime. `ws.accept()` is never used: it would bill the
   * object for the whole connection.
   */
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/ws") {
      return new Response("not found", { status: 404 });
    }

    const upgrade = request.headers.get("upgrade");
    if (upgrade === null || upgrade.toLowerCase() !== "websocket") {
      return new Response("upgrade required", {
        status: 426,
        headers: { upgrade: "websocket" },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(encodeAttachment([]));

    // A socket must get ticks even when no HTTP request ever arrives, and the
    // first one must not wait for an idle 30s alarm: pull the pending alarm
    // forward to the active cadence. `ensureAlarm` would be a no-op here
    // because the constructor already scheduled one.
    await this.tightenAlarm(ACTIVE_INTERVAL_MS);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    try {
      await this.onSocketMessage(ws, message);
    } catch (error) {
      // One bad message must never take the object down for every socket.
      console.error("[prices] socket message failed", describeError(error));
    }
  }

  /**
   * The runtime removes the socket from the object; there is no attachment to
   * clear. The reciprocal close completes the handshake, so the client sees
   * its own code rather than an abnormal 1006.
   */
  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    // `wasClean` is informational: the runtime owns the teardown either way.
    void wasClean;
    this.close(ws, code, reason);
    this.socketWindows.delete(ws);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    this.socketWindows.delete(ws);
    console.warn("[prices] socket error", describeError(error));
  }

  private async onSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const now = Date.now();
    const decision = noteMessage(this.socketWindows.get(ws), now);
    this.socketWindows.set(ws, decision.window);

    if (!decision.allowed) {
      this.send(ws, encodeFrame(errorFrame("rate-limited")));
      this.close(ws, 1008, "rate-limited");
      return;
    }

    const parsed = parseClientFrame(message);
    if (!parsed.ok) {
      // A frame over the 50-id cap is `too-many`; every other shape problem is
      // `bad-frame`. Either way it is one error and no processing.
      this.send(ws, encodeFrame(errorFrame(parsed.code)));
      return;
    }

    const frame = parsed.frame;
    if (frame.t === "ping") {
      this.send(ws, encodeFrame({ t: "pong" }));
      return;
    }

    const attachment = decodeAttachment(ws.deserializeAttachment());

    if (frame.t === "unsub") {
      const plan = planUnsubscriptions(attachment.assets, frame.assets);
      if (plan.removed.length > 0) {
        ws.serializeAttachment(encodeAttachment(plan.assets));
      }
      return;
    }

    // Validate before storing: an unknown id is reported and never becomes
    // part of the socket's set, so it cannot enter the watched set either.
    const known = this.loadAssets(frame.assets);
    const plan = planSubscriptions(
      attachment.assets,
      frame.assets,
      new Set(known.keys()),
    );

    if (plan.tooMany) {
      this.send(ws, encodeFrame(errorFrame("too-many")));
      return;
    }

    // One frame for every unknown id, not one frame per id.
    if (plan.unknown.length > 0) {
      this.send(ws, encodeFrame(unknownAssetsFrame(plan.unknown)));
    }

    // A socket can outlive a delisting. Drop any id the registry no longer
    // lists before it reaches the snapshot, and repair the attachment once.
    const live = this.loadAssets(plan.assets);
    const assets = filterKnownAssets(plan.assets, new Set(live.keys()));
    if (plan.added.length > 0 || assets.length !== plan.assets.length) {
      ws.serializeAttachment(encodeAttachment(assets));
    }

    // The cache first, so a known asset paints on this turn. Then refresh every
    // subscribed id that is missing, past its TTL, or already flagged stale,
    // and publish one patch for whatever answered or failed.
    this.send(ws, buildSnapshotFrame(assets, this.current, now));

    if (assets.length === 0) return;

    const summary = await this.refreshAssets(assets);
    // One write per message that actually moved the map, exactly like /prices.
    if (this.dirty) this.persistSnapshot();
    this.publish(publishIds(summary.updated, summary.failed));
  }

  private send(ws: WebSocket, frame: string): void {
    try {
      ws.send(frame);
    } catch (error) {
      console.warn("[prices] socket send failed", describeError(error));
      this.close(ws, 1011, "send-failed");
    }
  }

  private close(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed: the runtime owns the rest of the teardown.
    }
  }

  /**
   * One frame per socket per publish, carrying every changed asset that socket
   * is subscribed to. A socket with no overlap is skipped entirely, and a
   * failed send closes that one socket instead of breaking the tick.
   */
  private publish(ids: readonly string[]): void {
    if (ids.length === 0) return;

    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;

    for (const { socket, frame } of fanOut(
      this.liveSocketTargets(sockets),
      ids,
      this.current,
      Date.now(),
    )) {
      this.send(socket, frame);
    }
  }

  /**
   * The sockets with their attachments pruned to the current registry. One
   * SQL lookup for the union, not one per socket; a socket that outlives a
   * delisting is repaired in place, so an old cached quote can never be sent
   * from a stale attachment.
   */
  private liveSocketTargets(
    sockets: readonly WebSocket[],
  ): Array<{ socket: WebSocket; assets: string[] }> {
    const targets = sockets.map((socket) => ({
      socket,
      assets: decodeAttachment(socket.deserializeAttachment()).assets,
    }));

    const subscribed = unionSocketAssets(
      targets.map((target) => target.assets),
    );
    if (subscribed.length === 0) return targets;

    const known = new Set(this.loadAssets(subscribed).keys());
    return targets.map(({ socket, assets }) => {
      const kept = filterKnownAssets(assets, known);
      if (kept.length !== assets.length) {
        try {
          socket.serializeAttachment(encodeAttachment(kept));
        } catch (error) {
          // A closing socket must not break fan-out for everyone else; the
          // next pass repairs the attachment if it is still alive.
          console.warn(
            "[prices] socket attachment prune failed",
            describeError(error),
          );
        }
      }
      return { socket, assets: kept };
    });
  }

  /** The union of every live socket's subscriptions, for the watched set. */
  private socketAssets(): string[] {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return [];

    return unionSocketAssets(
      this.liveSocketTargets(sockets).map((target) => target.assets),
    );
  }

  async health() {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'schema_version'",
      )
      .toArray()[0];

    // The version alone cannot catch a half-built table, so the upgrade path
    // is only healthy when every column the registry and snapshot write is
    // present.
    const columns = new Set(
      this.ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(assets)")
        .toArray()
        .map((column) => column.name),
    );
    const snapshotColumns = new Set(
      this.ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(snapshot)")
        .toArray()
        .map((column) => column.name),
    );
    const seriesColumns = new Set(
      this.ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(series)")
        .toArray()
        .map((column) => column.name),
    );
    const schemaOk =
      EXPECTED_ASSETS_COLUMNS.every((column) => columns.has(column)) &&
      EXPECTED_SNAPSHOT_COLUMNS.every((column) =>
        snapshotColumns.has(column),
      ) &&
      EXPECTED_SERIES_COLUMNS.every((column) => seriesColumns.has(column));

    const now = Date.now();
    const summary = this.snapshotSummary(now);
    const nextAlarmAt = scheduledAlarmAt({
      alarmAt: await this.ctx.storage.getAlarm(),
      lastTickAt: this.lastTickAt,
      intervalMs: summary.intervalMs,
      now,
    });

    return {
      ok: row?.value === SCHEMA_VERSION && schemaOk,
      service: SERVICE,
      schemaVersion: row?.value ?? null,
      schemaOk,
      assets: this.count("SELECT COUNT(*) AS count FROM assets"),
      catalogueSyncedAt: this.readNumberMeta("catalogue_synced_at"),
      registryVersion: this.readMeta("registry_version"),
      now,
      nextAlarmAt,
      // Remaining time until the scheduled alarm, not the computed cadence.
      // A socket connection pulls this down to the 10s target.
      nextAlarmInMs: Math.max(0, nextAlarmAt - now),
      snapshotAssets: summary.assets,
      snapshotStale: summary.stale,
      seriesCached: this.count("SELECT COUNT(*) AS count FROM series"),
      seriesInflight: this.seriesFlights.size,
      lastTickAt: summary.lastTickAt,
      intervalMs: summary.intervalMs,
      watched: summary.watched,
      hot: summary.hot,
      sockets: summary.sockets,
      socketAssets: summary.socketAssets,
      lastRefreshMs: summary.lastRefreshMs,
      lastAttempts: summary.lastAttempts,
      breakers: this.breakerStates(),
    };
  }

  /**
   * The HTTP read path. Cached quotes are returned as they are; missing or
   * expired ones are fetched through the same single flight the alarm uses.
   * Unknown ids answer `null` rather than an error the caller has to decode.
   */
  async prices(ids: readonly string[]): Promise<PricesResponse> {
    // Sorted so the response keys are stable for a given set of ids.
    const wanted = normalizeIds(ids).sort().slice(0, MAX_ASSETS);
    if (wanted.length === 0) return { prices: {}, asOf: Date.now() };

    await this.refreshAssets(wanted);

    // A delisted asset must not keep serving its old cached quote.
    const known = this.loadAssets(wanted);

    // Only real demand tightens the cadence: random ids must not be able to
    // pin the alarm at ten seconds.
    if (known.size > 0) await this.tightenAlarm(ACTIVE_INTERVAL_MS);

    const view = presentPrices(
      wanted,
      this.current,
      new Set(known.keys()),
      Date.now(),
    );

    for (const assetId of view.removed) this.current.delete(assetId);

    // One snapshot row for this request, after the merge, never two.
    if (this.dirty || view.removed.length > 0) this.persistSnapshot();

    // The top-level asOf is the data watermark, not the response time: two
    // requests served from the same cache return the same number.
    return { prices: view.prices, asOf: view.asOf };
  }

  /**
   * The 24-hour history read path. A fresh row answers from SQLite; a stale or
   * missing one is fetched once per asset and stored. An unknown id, or a
   * known id whose source walk found no history, answers the empty shape
   * rather than an error the card has to interpret.
   */
  async history(
    assetId: string,
    range: SeriesRange,
  ): Promise<HistoryResponse> {
    const id = assetId.trim();
    if (id.length === 0) return noHistory(id, range);

    // A delisted asset is unknown even if an old series row is still cached,
    // exactly like `/prices` refusing a cached quote the registry dropped.
    const asset = this.loadAssets([id]).get(id);
    if (asset === undefined) return noHistory(id, range);

    const cached = this.readSeriesRow(id, range);
    if (cached !== null && isSeriesFresh(cached, Date.now())) {
      return presentHistory(cached);
    }

    return presentHistory(await this.seriesFlight(asset, range));
  }

  /**
   * Refresh the requested ids. `track` is true on the HTTP path, which feeds
   * the recent set, and false on the alarm, because the hot set is not demand
   * and must not pin the feed to the ten-second cadence forever.
   *
   * The drain loop is the fix for a shared-flight collision: a caller can
   * join a batch that was started for someone else's ids, so it must re-check
   * and run again until its own ids are decided, not just once.
   */
  async refreshAssets(
    ids: readonly string[],
    track = true,
  ): Promise<RefreshSummary> {
    const wanted = normalizeIds(ids);
    if (wanted.length === 0) return emptySummary();

    if (track) {
      // Only registry ids are demand: an unknown id has no price to keep warm
      // and must not be able to pin the alarm at the fast cadence.
      const known = this.loadAssets(wanted);
      this.recent = trackRecent(
        this.recent,
        wanted,
        new Set(known.keys()),
        Date.now(),
      );
    }

    // The drain can join a batch started for another caller, so both the
    // updated and the failed ids are collected from every round and filtered
    // to what this caller asked for: a joined hot-set batch must not turn a
    // one-asset sub into a patch for the whole hot set.
    const wantedSet = new Set(wanted);
    const updated = new Set<string>();
    const failed = new Set<string>();
    const { result } = await drainMisses(wanted, async (missing) => {
      const outcome = await this.flight.run(() => this.runBatch(missing));
      for (const assetId of outcome.summary.updated) {
        if (wantedSet.has(assetId)) updated.add(assetId);
      }
      for (const assetId of outcome.summary.failed) {
        if (wantedSet.has(assetId)) failed.add(assetId);
      }
      return outcome;
    });

    const summary = result?.summary ?? emptySummary();
    return { ...summary, updated: [...updated], failed: [...failed] };
  }

  /**
   * Diagnostics for the gated /snapshot route. It never refreshes a price; it
   * may prune a delisted id out of a socket attachment.
   */
  async snapshot() {
    const now = Date.now();
    const intervalMs = this.currentIntervalMs(now);
    const nextAlarmAt = scheduledAlarmAt({
      alarmAt: await this.ctx.storage.getAlarm(),
      lastTickAt: this.lastTickAt,
      intervalMs,
      now,
    });
    const { quotes } = this.snapshotQuotes(now);

    return {
      asOf: this.snapshotAsOf,
      lastTickAt: this.lastTickAt,
      intervalMs,
      nextAlarmAt,
      // Remaining time until the scheduled alarm, not the computed cadence.
      nextAlarmInMs: Math.max(0, nextAlarmAt - now),
      lastRefreshMs: this.lastRefreshMs,
      lastAttempts: this.lastAttempts,
      assets: Object.keys(quotes).length,
      hot: this.hotIds,
      sockets: this.ctx.getWebSockets().length,
      socketAssets: this.socketAssets().length,
      watched: this.watchedNow(now),
      seriesCached: this.count("SELECT COUNT(*) AS count FROM series"),
      breakers: this.breakerStates(),
      quotes,
    };
  }

  /**
   * The alarm is the only scheduler: no setTimeout, no setInterval. At-least-
   * once delivery is fine because a tick only fetches what is stale and the
   * snapshot write is idempotent.
   */
  async alarm(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      console.error("[prices] tick failed", describeError(error));
    } finally {
      // An uncaught error would stop the feed after the runtime's six retries,
      // so the reschedule happens no matter what the tick did.
      const interval = this.currentIntervalMs();
      try {
        await this.ctx.storage.setAlarm(Date.now() + interval);
      } catch (error) {
        console.error("[prices] alarm reschedule failed", describeError(error));
      }
    }
  }

  async tick(): Promise<RefreshSummary & { watched: number; ms: number }> {
    const startedAt = Date.now();
    this.lastTickAt = startedAt;

    this.recent = pruneRecent(this.recent, startedAt);
    this.hotIds = this.resolveHotIds();

    // A brand-new object has no rows to price, so the catalogue is the only
    // way to get them. That is the one case where it goes before the prices.
    if (this.hotIds.length === 0) await this.syncCatalogueWithBackoff();

    const watched = this.watchedNow(startedAt);
    const summary = await this.refreshAssets(watched, false);
    const ms = Date.now() - startedAt;

    // Exactly one snapshot row for this tick, written after the memory update
    // and before the catalogue work: a slow or failed catalogue must never
    // delay or erase a price.
    this.persistSnapshot();
    // After the write, so a socket that reconnects while the patch is in
    // flight still reads the same values from the snapshot. A failed refresh
    // is published too, with its prior value marked stale.
    this.publish(publishIds(summary.updated, summary.failed));
    this.logTick(watched.length, summary, ms);

    await this.syncCatalogueWithBackoff();

    return { ...summary, watched: watched.length, ms };
  }

  /**
   * The six-hour catalogue refresh, delivered by the tick after the prices.
   * A failed fetch backs off for a minute so a 1Click outage does not spend
   * the whole price budget on every tick. It never touches the quotes.
   */
  private async syncCatalogueWithBackoff(): Promise<void> {
    const due = catalogueDue({
      now: Date.now(),
      syncedAt: this.readNumberMeta("catalogue_synced_at"),
      backoffUntil: this.catalogueBackoffUntil,
      ttlMs: CATALOGUE_TTL_MS,
    });
    if (!due) return;

    try {
      const result = await this.syncCatalogue(false);
      if (result.error !== undefined) {
        this.catalogueBackoffUntil = Date.now() + CATALOGUE_BACKOFF_MS;
        console.error("[prices] catalogue refresh failed", result.error);
        return;
      }
      this.catalogueBackoffUntil = 0;
    } catch (error) {
      this.catalogueBackoffUntil = Date.now() + CATALOGUE_BACKOFF_MS;
      console.error("[prices] catalogue refresh failed", describeError(error));
    }
  }

  /**
   * Refresh the catalogue and recompute every source mapping. A refresh inside
   * the TTL is skipped unless forced; a failed fetch keeps the last registry
   * and reports the reason alongside its stats.
   */
  async syncCatalogue(force = false): Promise<CatalogueSyncResult> {
    const now = Date.now();
    if (!force) {
      const syncedAt = this.readNumberMeta("catalogue_synced_at");
      if (syncedAt !== null && now - syncedAt < CATALOGUE_TTL_MS) {
        return { ...this.catalogueStats(), refreshed: false };
      }
    }

    // Captured before this refresh writes anything: the shrink guard compares
    // the new registry against the rows that existed when it started.
    const previousCount = this.count("SELECT COUNT(*) AS count FROM assets");

    const raw = await fetchCatalogue();
    if (raw.length === 0) {
      return {
        ...this.catalogueStats(),
        refreshed: false,
        error: "catalogue-unavailable",
      };
    }

    const { symbols: binanceSymbols, status: binanceStatus } =
      await this.fetchBinanceSymbols();
    const registry = buildRegistry(raw, binanceSymbols);
    const syncStartedAt = Date.now();

    for (const asset of registry) {
      this.ctx.storage.sql.exec(
        `INSERT INTO assets (
          asset_id, symbol, chain, contract, decimals, coingecko_id,
          binance_symbol, alchemy_symbol, alchemy_network, alchemy_address,
          primary_source, catalogue_price, catalogue_price_updated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          symbol = excluded.symbol,
          chain = excluded.chain,
          contract = excluded.contract,
          decimals = excluded.decimals,
          coingecko_id = excluded.coingecko_id,
          binance_symbol = excluded.binance_symbol,
          alchemy_symbol = excluded.alchemy_symbol,
          alchemy_network = excluded.alchemy_network,
          alchemy_address = excluded.alchemy_address,
          primary_source = excluded.primary_source,
          catalogue_price = excluded.catalogue_price,
          catalogue_price_updated_at = excluded.catalogue_price_updated_at,
          updated_at = excluded.updated_at`,
        asset.assetId,
        asset.symbol,
        asset.chain,
        asset.contract,
        asset.decimals,
        asset.coingeckoId,
        asset.binanceSymbol,
        asset.alchemySymbol,
        asset.alchemyNetwork,
        asset.alchemyAddress,
        asset.primarySource,
        asset.cataloguePrice,
        asset.cataloguePriceUpdatedAt,
        syncStartedAt,
      );
    }

    // An asset 1Click no longer lists is dropped, so total and bySource always
    // describe the current catalogue rather than an ever-growing union of old
    // refreshes. A partial catalogue must not delete the healthy rows it
    // omitted, so the delete only runs when the new registry is at least 80%
    // of the previous count (or this is the first sync). The early return
    // above keeps a failed fetch from deleting anything at all.
    if (shouldPruneAssets(previousCount, registry.length)) {
      this.ctx.storage.sql.exec(
        "DELETE FROM assets WHERE updated_at < ?",
        syncStartedAt,
      );
    } else {
      console.warn(
        "[prices] catalogue shrink blocked",
        `previous=${previousCount} next=${registry.length}`,
      );
    }

    this.writeMeta("catalogue_synced_at", String(syncStartedAt));
    // A cached fallback is already in meta; only a live list (or the empty
    // signal from a failed lookup with no cache) needs a decision here. Never
    // persist an empty list that a later failure would mistake for a cache.
    if (binanceStatus !== "empty") {
      this.writeMeta(
        "binance_symbols",
        JSON.stringify([...binanceSymbols].sort()),
      );
    }
    this.writeMeta("binance_symbols_status", binanceStatus);
    this.writeMeta("registry_version", REGISTRY_VERSION);

    // The catalogue decides which rows the hot tickers map to.
    this.hotIds = this.resolveHotIds();

    return { ...this.catalogueStats(), refreshed: true };
  }

  /** Registry health from SQLite only: no upstream call, no catalogue price map. */
  catalogueStats(): CatalogueStats {
    const bySource: Record<PriceSource, number> = {
      binance: 0,
      alchemy: 0,
      oneclick: 0,
    };

    const rows = this.ctx.storage.sql
      .exec<{ primary_source: string; count: number }>(
        "SELECT primary_source, COUNT(*) AS count FROM assets GROUP BY primary_source",
      )
      .toArray();

    let total = 0;
    for (const row of rows) {
      total += row.count;
      if (Object.hasOwn(bySource, row.primary_source)) {
        bySource[row.primary_source as PriceSource] = row.count;
      }
    }

    const syncedAt = this.readNumberMeta("catalogue_synced_at");

    return {
      total,
      bySource,
      binanceDistinctPairs: this.count(
        "SELECT COUNT(DISTINCT binance_symbol) AS count FROM assets",
      ),
      alchemyCandidates: this.count(
        "SELECT COUNT(DISTINCT alchemy_symbol) AS count FROM assets",
      ),
      binanceSymbols: this.readBinanceStatus(),
      syncedAt,
      stale: syncedAt === null || Date.now() - syncedAt > CATALOGUE_TTL_MS,
      registryVersion: this.readMeta("registry_version"),
    };
  }

  /**
   * Upstream reachability measured from the object's own location, so the
   * reported colo and egress are the ones the price path will actually use.
   * Each check fails on its own; one dead host never hides the others.
   */
  async probe() {
    const [trace, ping, ticker, klines] = await Promise.all([
      this.fetchText(TRACE_URL, PROBE_TIMEOUT_MS),
      this.fetchText(`${BINANCE_US}/ping`, PROBE_TIMEOUT_MS),
      this.fetchText(TICKER_URL, PROBE_TIMEOUT_MS),
      this.fetchText(KLINES_URL, PROBE_TIMEOUT_MS),
    ]);

    const colo = trace.error === undefined ? parseColo(trace.text) : null;
    const prices = parseTickerPrices(parseJson(ticker.text));
    const points = parseKlines(parseJson(klines.text));

    const traceCheck = toCheck(trace, colo !== null);
    const pingCheck = toCheck(ping, true);
    const tickerCheck = {
      ...toCheck(ticker, prices.length === TICKER_SYMBOLS.length),
      symbols: prices.length,
    };
    const klineCheck = {
      ...toCheck(klines, hasFullKlineSeries(points)),
      points: points.length,
    };

    return {
      // The trace is informational: it reports where the object runs, it is
      // not a price dependency.
      ok: pingCheck.ok && tickerCheck.ok && klineCheck.ok,
      colo,
      timeoutMs: PROBE_TIMEOUT_MS,
      now: Date.now(),
      checks: {
        trace: traceCheck,
        ping: pingCheck,
        ticker: tickerCheck,
        klines: klineCheck,
      },
      // Read-only: a probe must never spend a catalogue or pairing call.
      catalogue: this.catalogueStats(),
      snapshot: this.snapshotSummary(),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Refresh and persistence                                             */
  /* ------------------------------------------------------------------ */

  private async runBatch(wanted: readonly string[]): Promise<BatchOutcome> {
    const startedAt = Date.now();
    const rows = this.loadAssets(wanted);
    const assets: ResolverAsset[] = [];
    const decided = new Set<string>();
    let skippedFresh = 0;
    let unknown = 0;

    for (const assetId of wanted) {
      const row = rows.get(assetId);
      if (row === undefined) {
        unknown += 1;
        decided.add(assetId);
        continue;
      }

      const quote = this.current.get(assetId);
      if (!needsRefresh(quote, startedAt)) {
        skippedFresh += 1;
        decided.add(assetId);
        continue;
      }

      assets.push(row);
    }

    const summary: RefreshSummary = {
      requested: wanted.length,
      fetched: 0,
      failed: [],
      skippedFresh,
      unknown,
      attempts: 0,
      updated: [],
    };

    if (assets.length === 0) {
      this.lastRefreshMs = Date.now() - startedAt;
      this.lastAttempts = 0;
      return { summary, decided };
    }

    const result = await this.resolver.currentBatch(assets);
    const failures = new Set(
      assets
        .map((asset) => asset.assetId)
        .filter((assetId) => !result.quotes.has(assetId)),
    );

    // Memory first; the caller owns the single snapshot write after the
    // merge, so a tick or a request never writes the row twice.
    this.current = mergeQuotes(this.current, {
      quotes: result.quotes,
      failures,
    });
    this.dirty = true;

    for (const asset of assets) decided.add(asset.assetId);

    summary.fetched = result.quotes.size;
    summary.failed = [...failures];
    summary.attempts = result.attempts.length;
    summary.updated = [...result.quotes.keys()];
    this.lastRefreshMs = Date.now() - startedAt;
    this.lastAttempts = result.attempts.length;

    return { summary, decided };
  }

  private persistSnapshot(): void {
    const at = Date.now();
    try {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO snapshot (id, payload, as_of) VALUES (?, ?, ?)",
        SNAPSHOT_ID,
        encodeSnapshot(this.current, this.lastTickAt),
        at,
      );
      this.snapshotAsOf = at;
      this.dirty = false;
    } catch (error) {
      // The next tick repairs it; memory keeps serving in the meantime.
      console.error("[prices] snapshot write failed", describeError(error));
    }
  }

  private loadSnapshot(): void {
    const row = this.ctx.storage.sql
      .exec<{ payload: string; as_of: number }>(
        "SELECT payload, as_of FROM snapshot WHERE id = ?",
        SNAPSHOT_ID,
      )
      .toArray()[0];

    const payload = decodeSnapshot(row?.payload);
    this.current = new Map(Object.entries(payload.quotes));
    this.lastTickAt = payload.lastTickAt;
    this.snapshotAsOf = row?.as_of ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* History                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * One fetch per (asset, range). The promise is cleared when it settles so a
   * later caller starts fresh work, exactly like the quote flight. Concurrent
   * requests for the same asset share the result; different assets run in
   * parallel because they hold different keys.
   */
  private seriesFlight(
    asset: ResolverAsset,
    range: SeriesRange,
  ): Promise<SeriesRow> {
    const key = seriesCacheKey(asset.assetId, range);
    const current = this.seriesFlights.get(key);
    if (current !== undefined) return current;

    const started = this.loadSeries(asset, range).finally(() => {
      if (this.seriesFlights.get(key) === started) {
        this.seriesFlights.delete(key);
      }
    });
    this.seriesFlights.set(key, started);
    return started;
  }

  /**
   * The source walk for one asset. A failure is a negative row, not an error:
   * the card keeps its empty state, and the short TTL retries a transient
   * outage a minute later instead of on every request.
   */
  private async loadSeries(
    asset: ResolverAsset,
    range: SeriesRange,
  ): Promise<SeriesRow> {
    const assetId = asset.assetId;
    const fetchedAt = Date.now();
    // The row this refetch replaces. A failure keeps these points rather than
    // overwriting a real line with a negative one.
    const previous = this.readSeriesRow(assetId, range);
    let row: SeriesRow;

    try {
      const result = await this.resolver.series(asset);
      if (result.ok) {
        row = buildSeriesRow({
          assetId,
          range,
          points: result.value.points,
          source: result.value.source,
          fetchedAt,
        });
      } else {
        console.warn(
          `[prices] history miss asset=${assetId} range=${range} error=${result.error}`,
        );
        const outcome = failedSeriesRow({
          assetId,
          range,
          previous,
          fetchedAt,
        });
        if (outcome.write) this.writeSeriesRow(outcome.row);
        return outcome.row;
      }
    } catch (error) {
      // A thrown adapter is the same outcome as a failed walk: keep the last
      // good points if there are any, otherwise cache the miss briefly.
      console.error("[prices] history fetch failed", describeError(error));
      const outcome = failedSeriesRow({
        assetId,
        range,
        previous,
        fetchedAt,
      });
      if (outcome.write) this.writeSeriesRow(outcome.row);
      return outcome.row;
    }

    this.writeSeriesRow(row);
    return row;
  }

  private readSeriesRow(assetId: string, range: SeriesRange): SeriesRow | null {
    const record = this.ctx.storage.sql
      .exec<SeriesRowRecord>(
        `SELECT asset_id, range, points, change_pct, source, fetched_at
         FROM series WHERE asset_id = ? AND range = ?`,
        assetId,
        range,
      )
      .toArray()[0];

    return decodeSeriesRow(record);
  }

  private writeSeriesRow(row: SeriesRow): void {
    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO series (asset_id, range, points, change_pct, source, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id, range) DO UPDATE SET
           points = excluded.points,
           change_pct = excluded.change_pct,
           source = excluded.source,
           fetched_at = excluded.fetched_at`,
        row.assetId,
        row.range,
        encodeSeriesPoints(row.points),
        row.changePct,
        row.source,
        row.fetchedAt,
      );
    } catch (error) {
      // The response is still useful; the next request retries the write.
      console.error("[prices] series write failed", describeError(error));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Assets and the watched set                                          */
  /* ------------------------------------------------------------------ */

  private loadAssets(ids: readonly string[]): Map<string, ResolverAsset> {
    const assets = new Map<string, ResolverAsset>();

    for (const chunk of chunks(ids, 90)) {
      if (chunk.length === 0) continue;

      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.ctx.storage.sql
        .exec<AssetRow>(
          `SELECT asset_id, symbol, coingecko_id, binance_symbol, alchemy_symbol, primary_source
           FROM assets WHERE asset_id IN (${placeholders})`,
          ...chunk,
        )
        .toArray();

      for (const row of rows) {
        const primary = primarySource(row.primary_source);
        if (primary === null) continue;

        assets.set(row.asset_id, {
          assetId: row.asset_id,
          symbol: row.symbol,
          sources: deriveSources({
            primarySource: primary,
            binanceSymbol: row.binance_symbol,
            alchemySymbol: row.alchemy_symbol,
          }),
          binanceSymbol: row.binance_symbol,
          alchemySymbol: row.alchemy_symbol,
          coingeckoId: row.coingecko_id,
        });
      }
    }

    return assets;
  }

  private resolveHotIds(): string[] {
    const symbols = hotQuerySymbols(HOT_SYMBOLS);
    if (symbols.length === 0) return [];

    const placeholders = symbols.map(() => "?").join(", ");
    const rows = this.ctx.storage.sql
      .exec<{ asset_id: string; symbol: string; chain: string }>(
        `SELECT asset_id, symbol, chain FROM assets WHERE UPPER(symbol) IN (${placeholders})`,
        ...symbols,
      )
      .toArray();

    return pickHotAssetIds(
      rows.map((row) => ({
        assetId: row.asset_id,
        symbol: row.symbol,
        chain: row.chain,
      })),
      HOT_SYMBOLS,
    );
  }

  private watchedNow(now: number): string[] {
    return watchedAssets({
      hot: this.hotIds,
      recent: this.recent,
      extra: this.socketAssets(),
      now,
    });
  }

  private currentIntervalMs(now = Date.now()): number {
    // A live socket is demand even when its assets are all in the hot set: the
    // client is watching them age, so the fast cadence applies.
    return intervalMs(
      pruneRecent(this.recent, now).size > 0 ||
        this.ctx.getWebSockets().length > 0,
    );
  }

  /**
   * Cached quotes the registry still lists. A delisted id can linger in the
   * in-memory map until the HTTP path deletes it, so diagnostics and the
   * snapshot count only what is still priceable.
   */
  private snapshotQuotes(now: number) {
    const known = this.loadAssets([...this.current.keys()]);
    return liveQuotes(this.current, new Set(known.keys()), now);
  }

  private snapshotSummary(now = Date.now()) {
    const { quotes, stale } = this.snapshotQuotes(now);
    const sockets = this.ctx.getWebSockets();
    // socketAssets() also prunes a delisted id out of an old attachment.
    const socketAssets = this.socketAssets();

    return {
      assets: Object.keys(quotes).length,
      stale,
      lastTickAt: this.lastTickAt,
      intervalMs: this.currentIntervalMs(now),
      watched: this.watchedNow(now).length,
      hot: this.hotIds.length,
      sockets: sockets.length,
      socketAssets: socketAssets.length,
      lastRefreshMs: this.lastRefreshMs,
      lastAttempts: this.lastAttempts,
    };
  }

  private breakerStates(): Record<keyof Breakers, BreakerSnapshot> {
    return {
      binance: this.breakers.binance.snapshot(),
      alchemy: this.breakers.alchemy.snapshot(),
      oneclick: this.breakers.oneclick.snapshot(),
      coingecko: this.breakers.coingecko.snapshot(),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Alarm                                                               */
  /* ------------------------------------------------------------------ */

  private async ensureAlarm(ms: number): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) await this.ctx.storage.setAlarm(Date.now() + ms);
  }

  /**
   * Move a pending alarm earlier, never later. The alarm handler owns the
   * steady schedule; a request only pulls the next tick forward so a reader
   * gets the ten-second cadence immediately.
   */
  private async tightenAlarm(ms: number): Promise<void> {
    try {
      const existing = await this.ctx.storage.getAlarm();
      const target = Date.now() + ms;
      if (existing === null || existing > target) {
        await this.ctx.storage.setAlarm(target);
      }
    } catch (error) {
      console.error("[prices] alarm tighten failed", describeError(error));
    }
  }

  private logTick(
    watched: number,
    summary: RefreshSummary,
    ms: number,
  ): void {
    console.log(
      `[prices] tick watched=${watched} fetched=${summary.fetched} failed=${summary.failed.length} skipped=${summary.skippedFresh} ms=${ms} binance=${this.breakers.binance.snapshot().state} alchemy=${this.breakers.alchemy.snapshot().state} oneclick=${this.breakers.oneclick.snapshot().state} coingecko=${this.breakers.coingecko.snapshot().state}`,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Storage helpers                                                     */
  /* ------------------------------------------------------------------ */

  private readMeta(key: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)
      .toArray()[0];
    return row?.value ?? null;
  }

  private readNumberMeta(key: string): number | null {
    const raw = this.readMeta(key);
    if (raw === null) return null;

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private readBinanceStatus(): BinanceSymbolsStatus {
    const raw = this.readMeta("binance_symbols_status");
    return raw === "live" || raw === "cached" ? raw : "empty";
  }

  private writeMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private count(query: string): number {
    const row = this.ctx.storage.sql.exec<{ count: number }>(query).toArray()[0];
    return row?.count ?? 0;
  }

  /**
   * The full pair list decides which assets can use Binance.US. A failed call
   * reuses the last list so a sync without it still writes a usable registry
   * instead of marking every pair unknown. The status is persisted with the
   * stats, so an operator can tell a live fetch from a fallback.
   */
  private async fetchBinanceSymbols(): Promise<{
    symbols: Set<string>;
    status: BinanceSymbolsStatus;
  }> {
    try {
      const response = await fetch(ALL_PAIRS_URL, {
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`status ${response.status}`);

      const prices = parseTickerPrices(parseJson(await response.text()));
      if (prices.length === 0) throw new Error("empty ticker list");

      return {
        symbols: new Set(prices.map((price) => price.symbol)),
        status: "live",
      };
    } catch (error) {
      console.error(
        "[prices] pair list unavailable during catalogue sync",
        describeError(error),
      );

      const cached = this.readMeta("binance_symbols");
      if (cached !== null) {
        try {
          const parsed: unknown = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            return {
              symbols: new Set(
                parsed.filter(
                  (symbol): symbol is string => typeof symbol === "string",
                ),
              ),
              status: "cached",
            };
          }
        } catch {
          // A corrupt cache is the same as no cache: fall through to empty.
        }
      }

      return { symbols: new Set(), status: "empty" };
    }
  }

  private async fetchText(
    url: string,
    timeoutMs: number,
  ): Promise<FetchResult> {
    const started = Date.now();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json, text/plain" },
      });
      const text = await response.text();
      return { status: response.status, ms: Date.now() - started, text };
    } catch (error) {
      return {
        status: null,
        ms: Date.now() - started,
        text: "",
        error: describeError(error),
      };
    }
  }
}
