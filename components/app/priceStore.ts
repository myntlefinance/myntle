"use client";

import { isPricesLive } from "@/lib/prices/flags";

/* ─────────────────────────────────────────────────────────
 * PRICE STORE
 * One module store and one WebSocket per tab. Every surface that
 * shows a unit price reads from here, so a chip, a balance row, and
 * a token card never disagree. The socket is demand-driven: it opens
 * when the first asset is watched and closes when the last one is
 * released. When the socket cannot connect, the store falls back to
 * the batched HTTP endpoint instead of leaving the interface blank.
 * ───────────────────────────────────────────────────────── */

export type PriceSource = "binance" | "alchemy" | "oneclick";

export type LiveQuote = {
  assetId: string;
  usd: number;
  asOf: number;
  source: PriceSource;
  stale: boolean;
};

/** `[assetId, usd, asOf, source, stale]` on the wire. */
type PriceTuple = [string, number, number, PriceSource, boolean];

type SocketFrame =
  | { t: "snapshot"; prices?: unknown }
  | { t: "patch"; prices?: unknown }
  | { t: "error"; code?: unknown; asset?: unknown; assets?: unknown }
  | { t: "pong" };

type SeedEntry = [number, number, PriceSource, boolean];
type SeedPayload = { v: 1; quotes: Record<string, SeedEntry> };

type HttpPrice = {
  usd?: unknown;
  asOf?: unknown;
  source?: unknown;
  stale?: unknown;
};

const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_PRICES_WS_URL ||
  "wss://myntle-prices.myntle.workers.dev/ws";
const DEFAULT_HTTP_URL =
  process.env.NEXT_PUBLIC_PRICES_HTTP_URL ||
  "https://myntle-prices.myntle.workers.dev";

/** The seed key and its lifetime. A reload paints from it before the socket. */
const SEED_KEY = "myntle-prices-v1";
const SEED_MAX_AGE_MS = 60_000;
/** A quote older than twice this is presented as stale. */
const QUOTE_TTL_MS = 15_000;
const STALE_AFTER_MS = QUOTE_TTL_MS * 2;

const MAX_SOCKET_ASSETS = 50;
const MAX_HTTP_ASSETS = 50;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const FAILURES_BEFORE_FALLBACK = 3;
const FALLBACK_INTERVAL_MS = 15_000;
const FALLBACK_TIMEOUT_MS = 5_000;
const SOCKET_RETRY_MS = 5 * 60_000;
/** Idle sockets are free; keep one for a minute before closing it. */
const SOCKET_IDLE_MS = 60_000;

const SOURCES = new Set<PriceSource>(["binance", "alchemy", "oneclick"]);

let wsUrl = DEFAULT_WS_URL;
let httpUrl = DEFAULT_HTTP_URL.replace(/\/+$/, "");

const quotes = new Map<string, LiveQuote>();
const listeners = new Set<() => void>();
/** Reference counts per asset, so two chips watching one token are one sub. */
const refcounts = new Map<string, number>();
/** Assets currently sent on the open socket, capped by the server. */
const socketAssets = new Set<string>();

let version = 0;

let socket: WebSocket | null = null;
let socketOpen = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let socketRetryTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

let fallbackActive = false;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;
let fallbackInflight = false;

let lifecycleBound = false;
let hydrated = false;

let priceMapCache: {
  key: string;
  refs: Array<LiveQuote | undefined>;
  map: Map<string, LiveQuote>;
} | null = null;

/* ── helpers ─────────────────────────────────────────────── */

function getWebSocket(): typeof WebSocket | undefined {
  return (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
}

function browser(): boolean {
  return typeof window !== "undefined";
}

function storage(): Storage | null {
  if (!browser()) return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

function roundPrice(value: number): number {
  return Number.parseFloat(value.toFixed(12));
}

function isSource(value: unknown): value is PriceSource {
  return typeof value === "string" && SOURCES.has(value as PriceSource);
}

function isStale(asOf: number, stale: unknown): boolean {
  return stale === true || Date.now() - asOf > STALE_AFTER_MS;
}

function validQuote(
  usd: unknown,
  asOf: unknown,
): { usd: number; asOf: number } | null {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
    return null;
  }
  if (typeof asOf !== "number" || !Number.isFinite(asOf) || asOf <= 0) {
    return null;
  }
  return { usd: roundPrice(usd), asOf };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/* ── seed persistence ───────────────────────────────────── */

function hydrateSeed(): void {
  if (hydrated) return;
  hydrated = true;
  const store = storage();
  if (!store) return;

  try {
    const raw = store.getItem(SEED_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as SeedPayload | null;
    const entries = parsed?.quotes;
    if (!entries || typeof entries !== "object") return;

    const now = Date.now();
    for (const [assetId, entry] of Object.entries(entries)) {
      if (!assetId || !Array.isArray(entry) || entry.length < 3) continue;
      const [usd, asOf, source, stale] = entry;
      if (!isSource(source)) continue;
      const valid = validQuote(usd, asOf);
      if (!valid) continue;
      if (now - valid.asOf > SEED_MAX_AGE_MS) continue;
      quotes.set(assetId, {
        assetId,
        usd: valid.usd,
        asOf: valid.asOf,
        source,
        stale: isStale(valid.asOf, stale),
      });
    }
  } catch {
    // Corrupt or unavailable storage never breaks a price.
  }
}

function persistSeed(): void {
  const store = storage();
  if (!store) return;

  try {
    const now = Date.now();
    const entries: Record<string, SeedEntry> = {};
    let count = 0;
    for (const [assetId, quote] of quotes) {
      if (count >= 200) break;
      if (now - quote.asOf > SEED_MAX_AGE_MS) continue;
      entries[assetId] = [quote.usd, quote.asOf, quote.source, quote.stale];
      count += 1;
    }
    const payload: SeedPayload = { v: 1, quotes: entries };
    store.setItem(SEED_KEY, JSON.stringify(payload));
  } catch {
    // Quota or private mode. Memory still covers the session.
  }
}

/* ── merging ─────────────────────────────────────────────── */

function mergeQuote(
  assetId: string,
  usd: unknown,
  asOf: unknown,
  source: unknown,
  stale: unknown,
): boolean {
  const id = assetId.trim();
  if (!id || !isSource(source)) return false;
  const valid = validQuote(usd, asOf);
  if (!valid) return false;

  const nextStale = isStale(valid.asOf, stale);
  const existing = quotes.get(id);
  if (
    existing &&
    existing.usd === valid.usd &&
    existing.asOf === valid.asOf &&
    existing.source === source &&
    existing.stale === nextStale
  ) {
    return false;
  }

  quotes.set(id, {
    assetId: id,
    usd: valid.usd,
    asOf: valid.asOf,
    source,
    stale: nextStale,
  });
  return true;
}

function mergeTuples(prices: unknown): boolean {
  if (!Array.isArray(prices)) return false;
  let changed = false;

  for (const entry of prices) {
    if (!Array.isArray(entry) || entry.length !== 5) continue;
    const [assetId, usd, asOf, source, stale] = entry as PriceTuple;
    if (typeof assetId !== "string") continue;
    if (mergeQuote(assetId, usd, asOf, source, stale)) changed = true;
  }

  return changed;
}

function commit(changed: boolean): void {
  if (!changed) return;
  persistSeed();
  notify();
}

/* ── HTTP fallback ───────────────────────────────────────── */

function subscribedIds(): string[] {
  return [...refcounts.keys()];
}

function hasSubscribers(): boolean {
  return refcounts.size > 0;
}

async function fetchFallback(): Promise<void> {
  // The rollout flag owns the whole path: off means no Worker request at all,
  // not even the batched HTTP fallback.
  if (!isPricesLive()) {
    stopFallback();
    return;
  }
  if (fallbackInflight) return;
  const ids = subscribedIds();
  if (ids.length === 0) {
    stopFallback();
    return;
  }

  fallbackInflight = true;
  try {
    const results = await Promise.all(
      chunk(ids, MAX_HTTP_ASSETS).map(async (group) => {
        const query = group.map(encodeURIComponent).join(",");
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          FALLBACK_TIMEOUT_MS,
        );
        try {
          const res = await fetch(`${httpUrl}/prices?assets=${query}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!res.ok) return null;
          return (await res.json()) as { prices?: Record<string, HttpPrice> } | null;
        } catch {
          return null;
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    let changed = false;
    for (const body of results) {
      const prices = body?.prices;
      if (!prices || typeof prices !== "object") continue;
      for (const [assetId, quote] of Object.entries(prices)) {
        if (!quote || typeof quote !== "object") continue;
        if (
          mergeQuote(assetId, quote.usd, quote.asOf, quote.source, quote.stale)
        ) {
          changed = true;
        }
      }
    }
    commit(changed);
  } finally {
    fallbackInflight = false;
  }
}

function startFallbackTimer(): void {
  if (!fallbackActive || fallbackTimer || !browser()) return;
  fallbackTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    void fetchFallback();
  }, FALLBACK_INTERVAL_MS);
}

function startFallback(): void {
  if (!isPricesLive() || fallbackActive) return;
  fallbackActive = true;
  void fetchFallback();
  startFallbackTimer();
}

function stopFallback(): void {
  fallbackActive = false;
  if (fallbackTimer !== null) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

function pauseFallback(): void {
  if (fallbackTimer !== null) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

function resumeFallback(): void {
  if (!fallbackActive) return;
  void fetchFallback();
  startFallbackTimer();
}

/* ── socket lifecycle ────────────────────────────────────── */

function sendSubscribeFrame(ids: string[]): void {
  const ws = socket;
  if (!ws || ws.readyState !== 1) return;
  const fresh = ids.filter((id) => !socketAssets.has(id));
  const room = Math.max(0, MAX_SOCKET_ASSETS - socketAssets.size);
  const list = fresh.slice(0, room);
  if (list.length === 0) return;
  for (const id of list) socketAssets.add(id);
  try {
    ws.send(JSON.stringify({ t: "sub", assets: list }));
  } catch {
    // The close handler owns the reconnect.
  }
}

function sendUnsubscribeFrame(ids: string[]): void {
  const ws = socket;
  if (!ws || ws.readyState !== 1) return;
  const list = ids.filter((id) => socketAssets.has(id));
  if (list.length === 0) return;
  for (const id of list) socketAssets.delete(id);
  try {
    ws.send(JSON.stringify({ t: "unsub", assets: list }));
  } catch {
    // The close handler owns the reconnect.
  }
}

function handleFrame(data: unknown): void {
  if (typeof data !== "string") return;

  let frame: SocketFrame;
  try {
    frame = JSON.parse(data) as SocketFrame;
  } catch {
    return;
  }
  if (!frame || typeof frame !== "object") return;

  if (frame.t === "snapshot" || frame.t === "patch") {
    commit(mergeTuples(frame.prices));
  }
  // An `error` frame is deliberately ignored: an unknown asset simply keeps
  // the price it already had, and the interface shows "—" when there is none.
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearSocketRetryTimer(): void {
  if (socketRetryTimer !== null) {
    clearTimeout(socketRetryTimer);
    socketRetryTimer = null;
  }
}

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/** The last subscriber left: keep the socket for a minute, then close it. */
function scheduleIdleClose(): void {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!hasSubscribers()) shutdownSocket();
  }, SOCKET_IDLE_MS);
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  const attempt = Math.max(0, reconnectAttempt - 1);
  const base = Math.min(
    RECONNECT_BASE_MS * 2 ** attempt,
    RECONNECT_MAX_MS,
  );
  const jitter = base * 0.2 * Math.random();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket(true);
  }, base + jitter);
}

function scheduleSocketRetry(): void {
  if (socketRetryTimer !== null) return;
  socketRetryTimer = setTimeout(() => {
    socketRetryTimer = null;
    if (hasSubscribers()) openSocket(true);
  }, SOCKET_RETRY_MS);
}

function handleSocketDown(ws: WebSocket): void {
  if (socket !== ws) return;
  socket = null;
  socketOpen = false;
  socketAssets.clear();

  if (!hasSubscribers()) {
    clearIdleTimer();
    stopFallback();
    return;
  }

  reconnectAttempt += 1;
  if (reconnectAttempt >= FAILURES_BEFORE_FALLBACK) {
    startFallback();
    scheduleSocketRetry();
  } else {
    scheduleReconnect();
  }
}

function openSocket(force = false): void {
  // Off is the old catalogue path: no socket, no reconnect, no fallback.
  if (!isPricesLive()) return;
  if (!browser() || !hasSubscribers()) return;
  // A pending retry or an active fallback owns the next attempt. A new
  // subscription during that window must not open a socket ahead of it.
  if (
    !force &&
    (reconnectTimer !== null || socketRetryTimer !== null || fallbackActive)
  ) {
    return;
  }
  const WebSocketImpl = getWebSocket();
  if (!WebSocketImpl) return;
  if (socket) return;

  let ws: WebSocket;
  try {
    ws = new WebSocketImpl(wsUrl);
  } catch {
    reconnectAttempt += 1;
    if (reconnectAttempt >= FAILURES_BEFORE_FALLBACK) {
      startFallback();
      scheduleSocketRetry();
    } else {
      scheduleReconnect();
    }
    return;
  }

  socket = ws;
  socketOpen = false;
  let down = false;

  ws.onopen = () => {
    if (socket !== ws) return;
    socketOpen = true;
    reconnectAttempt = 0;
    clearSocketRetryTimer();
    stopFallback();
    socketAssets.clear();
    sendSubscribeFrame(subscribedIds());
  };

  ws.onmessage = (event: MessageEvent) => {
    if (socket !== ws) return;
    handleFrame(event.data);
  };

  const fail = () => {
    if (down) return;
    down = true;
    handleSocketDown(ws);
  };

  ws.onerror = fail;
  ws.onclose = fail;
}

function closeSocket(): void {
  const ws = socket;
  socket = null;
  socketOpen = false;
  socketAssets.clear();
  if (!ws) return;
  try {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
  } catch {
    // Already closed.
  }
}

function shutdownSocket(): void {
  clearReconnectTimer();
  clearSocketRetryTimer();
  clearIdleTimer();
  stopFallback();
  reconnectAttempt = 0;
  closeSocket();
}

function bindLifecycle(): void {
  if (lifecycleBound || !browser()) return;
  const target = window;
  if (typeof target.addEventListener !== "function") return;
  lifecycleBound = true;

  target.addEventListener("pagehide", () => {
    shutdownSocket();
  });

  target.addEventListener("pageshow", () => {
    if (hasSubscribers()) openSocket();
  });

  target.addEventListener("online", () => {
    const hidden =
      typeof document !== "undefined" && document.hidden === true;
    if (fallbackActive && !hidden) {
      void fetchFallback();
    }
    if (!socket && hasSubscribers()) {
      clearReconnectTimer();
      clearSocketRetryTimer();
      reconnectAttempt = 0;
      openSocket(true);
    }
  });

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pauseFallback();
      else resumeFallback();
    });
  }
}

/* ── public store ────────────────────────────────────────── */

/** Subscribe to every store change. Used by `useSyncExternalStore`. */
export function subscribeToPriceStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPriceVersion(): number {
  return version;
}

export function getQuote(assetId: string): LiveQuote | undefined {
  return quotes.get(assetId);
}

export function getQuotes(): ReadonlyMap<string, LiveQuote> {
  return quotes;
}

/**
 * A map for exactly the requested ids, rebuilt only when one of those
 * quotes changed. That keeps a portfolio overlay from recomputing on a
 * price the portfolio does not show.
 */
export function getPriceMap(ids: readonly string[]): Map<string, LiveQuote> {
  const unique = [...new Set(ids.filter((id) => id.length > 0))].sort();
  const key = unique.join("\n");
  const refs = unique.map((id) => quotes.get(id));

  if (
    priceMapCache &&
    priceMapCache.key === key &&
    priceMapCache.refs.length === refs.length &&
    refs.every((quote, index) => priceMapCache!.refs[index] === quote)
  ) {
    return priceMapCache.map;
  }

  const map = new Map<string, LiveQuote>();
  refs.forEach((quote, index) => {
    if (quote) map.set(unique[index], quote);
  });
  priceMapCache = { key, refs, map };
  return map;
}

/** Watch one asset. Reference counted, so two chips are still one sub. */
export function subscribe(assetId: string): void {
  subscribeAssets([assetId]);
}

/** Release one asset. The quote stays in the store after the sub ends. */
export function unsubscribe(assetId: string): void {
  unsubscribeAssets([assetId]);
}

/**
 * Watch several assets with one frame. The socket opens lazily on the
 * first call and sends the whole watched set once, not one frame per id.
 */
export function subscribeAssets(assetIds: readonly string[]): void {
  // Flag off restores the catalogue path exactly: watching an asset is inert,
  // so the hooks below never open a socket or start an HTTP poll.
  if (!isPricesLive()) return;

  const unique = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return;

  const added: string[] = [];
  for (const id of unique) {
    const count = refcounts.get(id) ?? 0;
    if (count === 0) added.push(id);
    refcounts.set(id, count + 1);
  }

  clearIdleTimer();
  bindLifecycle();
  openSocket();
  if (socketOpen && added.length > 0) {
    // Send the whole watched set, not just the new ids: an earlier frame
    // may have hit the 50-asset cap and left a tail waiting for room.
    sendSubscribeFrame(subscribedIds());
  }
  if (fallbackActive) void fetchFallback();
}

export function unsubscribeAssets(assetIds: readonly string[]): void {
  const unique = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return;

  const removed: string[] = [];
  for (const id of unique) {
    const count = refcounts.get(id) ?? 0;
    if (count <= 0) continue;
    if (count === 1) {
      refcounts.delete(id);
      removed.push(id);
    } else {
      refcounts.set(id, count - 1);
    }
  }

  if (removed.length > 0) sendUnsubscribeFrame(removed);
  if (socketOpen) sendSubscribeFrame(subscribedIds());
  if (!hasSubscribers()) {
    // Idle sockets are free: keep this one for a minute so a chip that
    // scrolls back does not reopen it. Pagehide closes it immediately.
    stopFallback();
    if (socket) scheduleIdleClose();
    else shutdownSocket();
  }
}

/**
 * Seed a quote that did not come from the socket, such as the catalogue
 * price in a portfolio snapshot. A live quote is never overwritten.
 */
export function seedQuote(
  assetId: string,
  usd: number,
  asOf: number = Date.now(),
  source: PriceSource = "oneclick",
  stale = true,
): void {
  seedQuotes([{ assetId, usd, asOf, source, stale }]);
}

export function seedQuotes(
  entries: ReadonlyArray<{
    assetId: string;
    usd: number;
    asOf?: number;
    source?: PriceSource;
    stale?: boolean;
  }>,
): void {
  // A catalogue seed is only useful to a live reader. With the flag off the
  // interface reads the metadata directly, so the store stays untouched.
  if (!isPricesLive()) return;

  let changed = false;
  for (const entry of entries) {
    const id = entry.assetId?.trim();
    if (!id || quotes.has(id)) continue;
    const observed = entry.asOf;
    const asOf =
      typeof observed === "number" &&
      Number.isFinite(observed) &&
      observed > 0
        ? observed
        : Date.now();
    const valid = validQuote(entry.usd, asOf);
    if (!valid) continue;
    const source = entry.source ?? "oneclick";
    if (!isSource(source)) continue;
    quotes.set(id, {
      assetId: id,
      usd: valid.usd,
      asOf: valid.asOf,
      source,
      stale: isStale(valid.asOf, entry.stale ?? true),
    });
    changed = true;
  }
  if (changed) {
    persistSeed();
    notify();
  }
}

/** Point the store at another Worker. Tests use this; production uses env. */
export function configurePriceStore(config: {
  wsUrl?: string;
  httpUrl?: string;
}): void {
  if (config.wsUrl) wsUrl = config.wsUrl;
  if (config.httpUrl) httpUrl = config.httpUrl.replace(/\/+$/, "");
}

/** Clears every module-level cache and timer. Never call this in the app. */
export function __resetPriceStoreForTests(): void {
  shutdownSocket();
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  if (socketRetryTimer !== null) clearTimeout(socketRetryTimer);
  if (idleTimer !== null) clearTimeout(idleTimer);
  reconnectTimer = null;
  socketRetryTimer = null;
  idleTimer = null;
  reconnectAttempt = 0;
  fallbackInflight = false;
  priceMapCache = null;
  quotes.clear();
  refcounts.clear();
  listeners.clear();
  socketAssets.clear();
  version = 0;
  hydrated = false;
  lifecycleBound = false;
  hydrateSeed();
}

// The seed paints the first frame after a reload, before the socket opens.
hydrateSeed();
