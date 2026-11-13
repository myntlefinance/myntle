/**
 * Pure parsing for the probe, kept out of the Durable Object so it can be
 * tested without a Worker runtime. Every function accepts unknown input and
 * returns an empty result rather than throwing: a probe reports a bad
 * upstream, it never fails because of one.
 */

import { SERIES_POINTS } from "./series";

export type KlinePoint = { time: number; value: number };
export type TickerPrice = { symbol: string; price: number };

/** The chart wants 48 half-hour candles; fewer is an incomplete series. */
export const KLINE_POINTS = SERIES_POINTS;

export function hasFullKlineSeries(points: KlinePoint[]): boolean {
  return points.length === KLINE_POINTS;
}

/**
 * Only a real string with content or a real finite number is a price. Null,
 * "", " " and booleans all become null rather than the 0 that Number() gives.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The trace endpoint is one `key=value` per line; colo is the Cloudflare edge code. */
export function parseColo(trace: string): string | null {
  const match = /^colo=([A-Za-z0-9]+)$/m.exec(trace);
  return match?.[1] ?? null;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `[{ symbol, price }]`, skipping rows without a real price. */
export function parseTickerPrices(body: unknown): TickerPrice[] {
  if (!Array.isArray(body)) return [];

  const prices: TickerPrice[] = [];
  for (const row of body) {
    if (typeof row !== "object" || row === null) continue;
    const { symbol, price } = row as { symbol?: unknown; price?: unknown };
    if (typeof symbol !== "string") continue;
    const value = toFiniteNumber(price);
    if (value === null) continue;
    prices.push({ symbol, price: value });
  }
  return prices;
}

/** Binance kline rows are arrays: [openTime, open, high, low, close, ...]. */
export function parseKlines(body: unknown): KlinePoint[] {
  if (!Array.isArray(body)) return [];

  const points: KlinePoint[] = [];
  for (const row of body) {
    if (!Array.isArray(row)) continue;
    const time = toFiniteNumber(row[0]);
    const value = toFiniteNumber(row[4]);
    if (time === null || value === null) continue;
    points.push({ time, value });
  }
  points.sort((a, b) => a.time - b.time);
  return points;
}

/** A short, safe reason for a failed fetch; never the full request. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? "timeout" : error.message;
  }
  return String(error);
}
