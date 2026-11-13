/**
 * The WebSocket wire protocol: client frames in, price frames out.
 *
 * Everything here is pure. The Durable Object owns the sockets, the quotes and
 * the clock; this module only decides what a frame means, which ids a message
 * may add, and how a quote becomes a tuple on the wire. That keeps the whole
 * protocol testable without a Workers runtime.
 */

import { presentQuote, type LiveSource, type Quote } from "./prices";

/** One WebSocket frame may carry at most this many bytes. */
export const MAX_FRAME_BYTES = 4096;
/** One socket may subscribe to at most this many assets. */
export const MAX_SOCKET_ASSETS = 50;
/** One socket may send at most this many frames per minute. */
export const MAX_MESSAGES_PER_MINUTE = 60;
export const RATE_WINDOW_MS = 60_000;
/** An id longer than this is rejected before it can reach SQLite. */
export const MAX_ASSET_ID_LENGTH = 200;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * `[assetId, usd, asOf, source, stale]`. A tuple, not an object, because a
 * patch carries every changed asset and the field names would be most of it.
 */
export type PriceTuple = [string, number, number, LiveSource, boolean];

export type ServerErrorCode =
  | "unknown-asset"
  | "too-many"
  | "bad-frame"
  | "rate-limited";

export type ServerFrame =
  | { t: "snapshot"; prices: PriceTuple[] }
  | { t: "patch"; prices: PriceTuple[] }
  | {
      t: "error";
      code: ServerErrorCode;
      /** A single unknown id, kept for a one-asset error. */
      asset?: string;
      /** Every unknown id in one frame, capped at the socket limit. */
      assets?: string[];
    }
  | { t: "pong" };

export type ClientFrame =
  | { t: "sub"; assets: string[] }
  | { t: "unsub"; assets: string[] }
  | { t: "ping" };

export type FrameParse =
  | { ok: true; frame: ClientFrame }
  | { ok: false; code: "bad-frame" | "too-many" };

const BAD_FRAME: FrameParse = { ok: false, code: "bad-frame" };
const TOO_MANY: FrameParse = { ok: false, code: "too-many" };

/** UTF-8 bytes, which is what the frame limit is actually about. */
export function frameBytes(input: string | ArrayBuffer): number {
  return typeof input === "string"
    ? textEncoder.encode(input).byteLength
    : input.byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A client frame is JSON, at most 4KB, and either `sub`, `unsub` or `ping`.
 * Anything else — malformed JSON, a missing or unknown `t`, a non-array
 * `assets`, an id that is empty or over the length limit — is one `bad-frame`
 * error rather than a best-effort guess. Duplicate ids are folded here so a
 * repeated id never counts twice against the socket cap.
 *
 * More than 50 distinct ids is one `too-many` and no processing at all: the
 * cap applies to known and unknown ids alike, before the registry lookup, so a
 * single frame cannot turn into 120 error frames or 120 lookups.
 */
export function parseClientFrame(input: unknown): FrameParse {
  if (typeof input !== "string" && !(input instanceof ArrayBuffer)) {
    return BAD_FRAME;
  }
  if (frameBytes(input) > MAX_FRAME_BYTES) return BAD_FRAME;

  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = textDecoder.decode(input);
    } catch {
      return BAD_FRAME;
    }
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return BAD_FRAME;
  }

  if (!isRecord(value)) return BAD_FRAME;
  if (value.t === "ping") return { ok: true, frame: { t: "ping" } };
  if (value.t !== "sub" && value.t !== "unsub") return BAD_FRAME;
  if (!Array.isArray(value.assets)) return BAD_FRAME;

  const assets: string[] = [];
  const seen = new Set<string>();

  for (const entry of value.assets) {
    if (typeof entry !== "string") return BAD_FRAME;

    const assetId = entry.trim();
    if (assetId.length === 0 || assetId.length > MAX_ASSET_ID_LENGTH) {
      return BAD_FRAME;
    }
    if (seen.has(assetId)) continue;

    seen.add(assetId);
    assets.push(assetId);
  }

  if (assets.length > MAX_SOCKET_ASSETS) return TOO_MANY;

  return { ok: true, frame: { t: value.t, assets } };
}

export type SubscriptionPlan = {
  /** The socket's subscription set after this message. */
  assets: string[];
  /** Ids this message actually added, in request order. */
  added: string[];
  /** Requested ids the registry does not list; reported, never stored. */
  unknown: string[];
  /** The message would have crossed the cap, so nothing from it was applied. */
  tooMany: boolean;
};

/**
 * Fold a `sub` into a socket's set.
 *
 * - an id already subscribed is a no-op, not an error and not a second slot,
 * - an unknown id is reported and not stored,
 * - a message that would push the set past 50 adds nothing at all, so a
 *   client cannot creep up on the cap one id at a time and then be told that
 *   half its subscriptions worked.
 */
export function planSubscriptions(
  current: readonly string[],
  requested: readonly string[],
  known: ReadonlySet<string>,
): SubscriptionPlan {
  const present = new Set(current);
  const assets = [...present];
  const seen = new Set<string>();
  const added: string[] = [];
  const unknown: string[] = [];

  for (const raw of requested) {
    const assetId = raw.trim();
    if (assetId.length === 0 || present.has(assetId) || seen.has(assetId)) {
      continue;
    }

    seen.add(assetId);
    if (!known.has(assetId)) {
      unknown.push(assetId);
      continue;
    }
    added.push(assetId);
  }

  if (assets.length + added.length > MAX_SOCKET_ASSETS) {
    return { assets, added: [], unknown: [], tooMany: true };
  }

  return { assets: [...assets, ...added], added, unknown, tooMany: false };
}

export type UnsubscriptionPlan = {
  /** The socket's subscription set after this message. */
  assets: string[];
  /** Ids that were actually subscribed and are now gone. */
  removed: string[];
};

/** Unsubscribing an id that is not subscribed is ignored, not an error. */
export function planUnsubscriptions(
  current: readonly string[],
  requested: readonly string[],
): UnsubscriptionPlan {
  const drop = new Set<string>();

  for (const raw of requested) {
    const assetId = raw.trim();
    if (assetId.length > 0) drop.add(assetId);
  }

  return {
    assets: current.filter((assetId) => !drop.has(assetId)),
    removed: current.filter((assetId) => drop.has(assetId)),
  };
}

/**
 * Turn stored quotes into wire tuples. A quote that is missing or malformed is
 * skipped rather than sent as zero, and freshness is computed at send time so
 * an ageing value is marked stale without a rewrite.
 */
export function encodePrices(
  ids: readonly string[],
  quotes: ReadonlyMap<string, Quote>,
  now: number,
): PriceTuple[] {
  const prices: PriceTuple[] = [];

  for (const assetId of ids) {
    const quote = quotes.get(assetId);
    if (quote === undefined) continue;
    if (!Number.isFinite(quote.usd) || quote.usd < 0) continue;
    if (!Number.isFinite(quote.asOf) || quote.asOf <= 0) continue;

    const view = presentQuote(quote, now);
    prices.push([assetId, view.usd, view.asOf, view.source, view.stale]);
  }

  return prices;
}

export function encodeFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}

export function errorFrame(
  code: ServerErrorCode,
  asset?: string,
): ServerFrame {
  return asset === undefined
    ? { t: "error", code }
    : { t: "error", code, asset };
}

/**
 * One frame for every unknown id in a `sub`, rather than one frame per id.
 * The array is capped at the socket limit so a malformed client cannot turn a
 * single message into an unbounded response.
 */
export function unknownAssetsFrame(assets: readonly string[]): ServerFrame {
  return {
    t: "error",
    code: "unknown-asset",
    assets: assets.slice(0, MAX_SOCKET_ASSETS),
  };
}
