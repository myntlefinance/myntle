import { describe, expect, it } from "vitest";
import {
  buildSeries,
  changePct,
  downsampleTo,
  normalizePoints,
  SERIES_POINTS,
} from "../src/series";
import type { SeriesPoint } from "../src/sources/types";

function ramp(count: number, stepMs = 300_000): SeriesPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    time: 1_000_000 + index * stepMs,
    value: index,
  }));
}

describe("normalizePoints", () => {
  it("sorts ascending", () => {
    const points = normalizePoints([
      { time: 3_000, value: 3 },
      { time: 1_000, value: 1 },
      { time: 2_000, value: 2 },
    ]);

    expect(points.map((point) => point.time)).toEqual([1_000, 2_000, 3_000]);
  });

  it("dedupes by timestamp with the later value winning", () => {
    const points = normalizePoints([
      { time: 1_000, value: 1 },
      { time: 2_000, value: 2 },
      { time: 1_000, value: 9 },
    ]);

    expect(points).toEqual([
      { time: 1_000, value: 9 },
      { time: 2_000, value: 2 },
    ]);
  });

  it("drops invalid times and values instead of zeroing them", () => {
    const points = normalizePoints([
      { time: 1_000, value: 1 },
      { time: Number.NaN, value: 2 },
      { time: 2_000, value: Number.NaN },
      { time: 3_000, value: -1 },
      { time: 0, value: 5 },
      { time: 4_000, value: Number.POSITIVE_INFINITY },
      { time: 5_000, value: 0 },
    ]);

    expect(points).toEqual([
      { time: 1_000, value: 1 },
      { time: 5_000, value: 0 },
    ]);
  });
});

describe("downsampleTo", () => {
  it("keeps an already short series untouched", () => {
    const points = ramp(10);

    expect(downsampleTo(points, 48)).toEqual(points);
  });

  it("takes 48 evenly spaced points including the last", () => {
    const points = ramp(288);
    const sampled = downsampleTo(points, SERIES_POINTS);

    expect(sampled).toHaveLength(48);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled.at(-1)).toEqual(points.at(-1));

    for (let index = 1; index < sampled.length; index++) {
      expect(sampled[index]!.time).toBeGreaterThan(sampled[index - 1]!.time);
    }
  });

  it("selects real points rather than averaging neighbours", () => {
    const points = ramp(100);
    const sampled = downsampleTo(points, 48);
    const originals = new Set(points.map((point) => `${point.time}:${point.value}`));

    for (const point of sampled) {
      expect(originals.has(`${point.time}:${point.value}`)).toBe(true);
    }
  });

  it("returns the last point when only one is requested", () => {
    expect(downsampleTo(ramp(10), 1)).toEqual([ramp(10).at(-1)]);
  });

  it("handles an empty series", () => {
    expect(downsampleTo([], 48)).toEqual([]);
    expect(downsampleTo(ramp(5), 0)).toEqual([]);
  });
});

describe("changePct", () => {
  it("measures the move from the first value to the last", () => {
    expect(
      changePct([
        { time: 1, value: 100 },
        { time: 2, value: 110 },
      ]),
    ).toBeCloseTo(10);
  });

  it("is negative on a fall", () => {
    expect(
      changePct([
        { time: 1, value: 200 },
        { time: 2, value: 150 },
      ]),
    ).toBeCloseTo(-25);
  });

  it("is null without two points or a usable first value", () => {
    expect(changePct([])).toBeNull();
    expect(changePct([{ time: 1, value: 100 }])).toBeNull();
    expect(
      changePct([
        { time: 1, value: 0 },
        { time: 2, value: 10 },
      ]),
    ).toBeNull();
  });
});

describe("buildSeries", () => {
  it("normalizes and downsamples the series", () => {
    const raw = ramp(288);
    const series = buildSeries(raw, "alchemy", 9_999_999);

    expect(series.source).toBe("alchemy");
    expect(series.points).toHaveLength(48);
    expect(series.asOf).toBe(raw.at(-1)!.time);
    // The ramp starts at zero, so there is no meaningful percent move.
    expect(series.changePct).toBeNull();
  });

  it("derives the same change from the downsampled endpoints", () => {
    const raw = ramp(288).map((point) => ({ ...point, value: point.value + 100 }));
    const series = buildSeries(raw, "binance", 9_999_999);

    const first = series.points[0]!.value;
    const last = series.points.at(-1)!.value;

    expect(series.changePct).toBeCloseTo(((last - first) / first) * 100);
  });

  it("falls back to the fetch time when there are no points", () => {
    const series = buildSeries([], "coingecko", 1_700_000);

    expect(series.points).toEqual([]);
    expect(series.asOf).toBe(1_700_000);
    expect(series.changePct).toBeNull();
  });
});
