/**
 * The per-socket half of the WebSocket layer: the attachment shape, the
 * fan-out, and the rate window. Pure, so the unit suite can prove that one
 * publish produces exactly one frame per socket and never one per asset.
 */

import {
  encodeFrame,
  encodePrices,
  MAX_ASSET_ID_LENGTH,
  MAX_MESSAGES_PER_MINUTE,
  MAX_SOCKET_ASSETS,
  RATE_WINDOW_MS,
} from "./protocol";
import type { Quote } from "./prices";

/**
 * The only per-connection state that is persisted. It survives hibernation,
 * and it is read back with `deserializeAttachment` rather than kept in a map
 * that a restart would lose.
 */
export type SocketAttachment = { assets: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Trim, drop blanks, dedupe, bound the length, cap at 50. The same normalizer
 * runs on the way in and on the way out, so a corrupt or over-full attachment
 * can never widen a socket's set past what the protocol allows.
 */
function normalizeAssets(assets: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of assets) {
    if (typeof entry !== "string") continue;

    const assetId = entry.trim();
    if (assetId.length === 0 || assetId.length > MAX_ASSET_ID_LENGTH) continue;
    if (seen.has(assetId)) continue;

    seen.add(assetId);
    out.push(assetId);
    if (out.length >= MAX_SOCKET_ASSETS) break;
  }

  return out;
}

export function encodeAttachment(
  assets: readonly string[],
): SocketAttachment {
  return { assets: normalizeAssets(assets) };
}

/** A missing, corrupt or wrong-shaped attachment is an empty subscription. */
export function decodeAttachment(raw: unknown): SocketAttachment {
  if (!isRecord(raw) || !Array.isArray(raw.assets)) return { assets: [] };
  return { assets: normalizeAssets(raw.assets) };
}

/** The subscribed ids a publish actually touches, in subscription order. */
export function overlapAssets(
  subscribed: readonly string[],
  changed: ReadonlySet<string>,
): string[] {
  return subscribed.filter((assetId) => changed.has(assetId));
}

/** The union of every socket's assets, for the alarm's watched set. */
export function unionSocketAssets(
  subscriptions: Iterable<readonly string[]>,
): string[] {
  const ids = new Set<string>();
  for (const assets of subscriptions) {
    for (const assetId of assets) ids.add(assetId);
  }
  return [...ids].sort();
}

/**
 * Drop ids the registry no longer lists, preserving order. A socket that
 * outlives a delisting must not keep receiving the cached quote, and the
 * caller prunes the attachment at the same time.
 */
export function filterKnownAssets(
  assets: readonly string[],
  known: ReadonlySet<string>,
): string[] {
  return assets.filter((assetId) => known.has(assetId));
}

/**
 * The ids a publish should consider: the ones that answered and the ones that
 * failed while a prior quote exists. A failure is published so the client
 * learns the value is now stale instead of presenting it as fresh.
 */
export function publishIds(
  updated: Iterable<string>,
  failed: Iterable<string>,
): string[] {
  const ids = new Set<string>();
  for (const assetId of updated) ids.add(assetId);
  for (const assetId of failed) ids.add(assetId);
  return [...ids];
}

/**
 * The immediate answer to a `sub`: everything the desk already holds for this
 * socket, including an empty list. The client can treat the frame as the
 * acknowledgement that the subscription was accepted, and a later patch fills
 * in anything that had to be fetched.
 */
export function buildSnapshotFrame(
  assets: readonly string[],
  quotes: ReadonlyMap<string, Quote>,
  now: number,
): string {
  return encodeFrame({
    t: "snapshot",
    prices: encodePrices(assets, quotes, now),
  });
}

/**
 * One socket's patch for one publish: only the overlapping ids, only when
 * there is at least one usable quote. Null means "send nothing", which is how
 * a socket with no overlap is skipped instead of receiving an empty frame.
 */
export function buildPatchFrame(
  subscribed: readonly string[],
  changed: ReadonlySet<string>,
  quotes: ReadonlyMap<string, Quote>,
  now: number,
): string | null {
  const overlap = overlapAssets(subscribed, changed);
  if (overlap.length === 0) return null;

  const prices = encodePrices(overlap, quotes, now);
  if (prices.length === 0) return null;

  return encodeFrame({ t: "patch", prices });
}

export type FanOutTarget<T> = { socket: T; assets: readonly string[] };
export type FanOutFrame<T> = { socket: T; frame: string };

/**
 * The whole fan-out for one publish: each socket gets at most one frame, and
 * that frame carries every changed asset it is subscribed to. A socket with no
 * overlap is absent from the result, so the caller never sends it anything.
 */
export function fanOut<T>(
  sockets: Iterable<FanOutTarget<T>>,
  changed: readonly string[],
  quotes: ReadonlyMap<string, Quote>,
  now: number,
): FanOutFrame<T>[] {
  const changedSet = new Set(changed);
  const frames: FanOutFrame<T>[] = [];

  for (const { socket, assets } of sockets) {
    const frame = buildPatchFrame(assets, changedSet, quotes, now);
    if (frame !== null) frames.push({ socket, frame });
  }

  return frames;
}

export type RateWindow = { startedAt: number; count: number };
export type RateDecision = { allowed: boolean; window: RateWindow };

/**
 * A fixed one-minute window per socket. The 61st frame is refused and the
 * socket is closed; a clock that moves backwards starts a fresh window rather
 * than refusing every frame until it catches up.
 */
export function noteMessage(
  window: RateWindow | undefined,
  now: number,
  limit = MAX_MESSAGES_PER_MINUTE,
  windowMs = RATE_WINDOW_MS,
): RateDecision {
  if (
    window === undefined ||
    now < window.startedAt ||
    now - window.startedAt >= windowMs
  ) {
    return { allowed: true, window: { startedAt: now, count: 1 } };
  }

  const count = window.count + 1;
  return {
    allowed: count <= limit,
    window: { startedAt: window.startedAt, count },
  };
}
