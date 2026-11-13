import type {
  PriceSeries,
  SeriesPoint,
  SourceName,
} from "./sources/types";

/** The chart contract: 24 hours at half-hour spacing. */
export const SERIES_POINTS = 48;

/**
 * Sort ascending, dedupe by timestamp, and drop anything that is not a real
 * observation. A duplicate timestamp keeps the last value the source sent,
 * because that is the later observation. No interpolation is ever invented:
 * a gap stays a gap and the chart draws what really arrived.
 */
export function normalizePoints(points: readonly SeriesPoint[]): SeriesPoint[] {
  const byTime = new Map<number, SeriesPoint>();

  for (const point of points) {
    if (!Number.isFinite(point.time) || point.time <= 0) continue;
    if (!Number.isFinite(point.value) || point.value < 0) continue;
    byTime.set(point.time, point);
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Take `target` evenly spaced indices, always including the first and the
 * last. This is selection, not averaging: every output point is a value the
 * upstream actually reported. For 288 five-minute points the step is about
 * six and the last point is the live edge.
 */
export function downsampleTo(
  points: readonly SeriesPoint[],
  target = SERIES_POINTS,
): SeriesPoint[] {
  if (target <= 0 || points.length === 0) return [];
  if (target === 1) {
    const last = points.at(-1);
    return last === undefined ? [] : [last];
  }
  if (points.length <= target) return [...points];

  const step = (points.length - 1) / (target - 1);
  const sampled: SeriesPoint[] = [];
  for (let index = 0; index < target; index++) {
    const point = points[Math.round(index * step)];
    if (point !== undefined) sampled.push(point);
  }
  return sampled;
}

/**
 * The move from the first close to the last, in percent. Null is honest when
 * there is no pair to compare or the first value cannot divide.
 */
export function changePct(points: readonly SeriesPoint[]): number | null {
  if (points.length < 2) return null;

  const first = points[0]?.value;
  const last = points.at(-1)?.value;
  if (first === undefined || last === undefined || first <= 0) return null;

  return ((last - first) / first) * 100;
}

/**
 * The one builder every history adapter returns. `asOf` is the newest
 * observation, not the fetch time: an empty or parked series must not look
 * fresher than the data behind it.
 */
export function buildSeries(
  points: readonly SeriesPoint[],
  source: SourceName,
  fetchedAt: number,
  target = SERIES_POINTS,
): PriceSeries {
  const normalized = normalizePoints(points);
  const sampled = downsampleTo(normalized, target);

  return {
    points: sampled,
    source,
    asOf: normalized.at(-1)?.time ?? fetchedAt,
    changePct: changePct(sampled),
  };
}
