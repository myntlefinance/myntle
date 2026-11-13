import { describe, expect, it } from "vitest";
import {
  buildSeriesRow,
  changePct,
  decodeSeriesRow,
  encodeSeriesPoints,
  failedSeriesRow,
  isSeriesFresh,
  isSupportedRange,
  negativeSeriesRow,
  noHistory,
  normalizeSeries,
  presentHistory,
  SERIES_CACHE_TTL_MS,
  SERIES_COINGECKO_CACHE_TTL_MS,
  SERIES_NEGATIVE_TTL_MS,
  SERIES_RANGE,
  seriesCacheKey,
  seriesCacheTtlMs,
  type SeriesRow,
  type SeriesRowRecord,
} from "../src/history";
import { SERIES_POINTS } from "../src/series";
import type { SeriesPoint } from "../src/sources/types";

const NOW = 1_762_000_000_000;

function ramp(count: number, stepMs = 300_000): SeriesPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    time: 1_000_000 + index * stepMs,
    value: 100 + index,
  }));
}

function recordOf(row: SeriesRow): SeriesRowRecord {
  return {
    asset_id: row.assetId,
    range: row.range,
    points: encodeSeriesPoints(row.points),
    change_pct: row.changePct,
    source: row.source,
    fetched_at: row.fetchedAt,
  };
}

describe("normalizeSeries", () => {
  it("sorts, dedupes with the later value, and drops invalid points", () => {
    const normalized = normalizeSeries([
      { time: 3_000, value: 3 },
      { time: 1_000, value: 1 },
      { time: 2_000, value: 2 },
      { time: 1_000, value: 9 },
      { time: Number.NaN, value: 4 },
      { time: 4_000, value: Number.NaN },
      { time: 5_000, value: -1 },
      { time: 0, value: 5 },
    ]);

    expect(normalized.points).toEqual([
      { time: 1_000, value: 9 },
      { time: 2_000, value: 2 },
      { time: 3_000, value: 3 },
    ]);
    expect(normalized.incomplete).toBe(true);
  });

  it("keeps a short series honestly and marks it incomplete", () => {
    const points = ramp(5);
    const normalized = normalizeSeries(points);

    expect(normalized.points).toEqual(points);
    expect(normalized.incomplete).toBe(true);
  });

  it("is complete at exactly 48 points", () => {
    const normalized = normalizeSeries(ramp(SERIES_POINTS));

    expect(normalized.points).toHaveLength(SERIES_POINTS);
    expect(normalized.incomplete).toBe(false);
  });

  it("caps a long series at 48 real points without interpolating", () => {
    const raw = ramp(288);
    const normalized = normalizeSeries(raw);
    const originals = new Set(
      raw.map((point) => `${point.time}:${point.value}`),
    );

    expect(normalized.points).toHaveLength(48);
    expect(normalized.incomplete).toBe(false);
    expect(normalized.points[0]).toEqual(raw[0]);
    expect(normalized.points.at(-1)).toEqual(raw.at(-1));

    for (const point of normalized.points) {
      expect(originals.has(`${point.time}:${point.value}`)).toBe(true);
    }
    for (let index = 1; index < normalized.points.length; index += 1) {
      expect(normalized.points[index]!.time).toBeGreaterThan(
        normalized.points[index - 1]!.time,
      );
    }
  });

  it("returns an empty incomplete series for no points", () => {
    expect(normalizeSeries([])).toEqual({ points: [], incomplete: true });
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

  it("is null without two points", () => {
    expect(changePct([])).toBeNull();
    expect(changePct([{ time: 1, value: 100 }])).toBeNull();
  });

  it("is null when the first value cannot divide", () => {
    expect(
      changePct([
        { time: 1, value: 0 },
        { time: 2, value: 10 },
      ]),
    ).toBeNull();
  });
});

describe("series cache", () => {
  it("uses 30 minutes for Binance and Alchemy, 60 for CoinGecko", () => {
    expect(seriesCacheTtlMs("binance")).toBe(SERIES_CACHE_TTL_MS);
    expect(seriesCacheTtlMs("alchemy")).toBe(SERIES_CACHE_TTL_MS);
    expect(seriesCacheTtlMs("coingecko")).toBe(
      SERIES_COINGECKO_CACHE_TTL_MS,
    );
    expect(seriesCacheTtlMs("none")).toBe(SERIES_NEGATIVE_TTL_MS);
  });

  it("serves a Binance series for 30 minutes", () => {
    const row = buildSeriesRow({
      assetId: "asset",
      range: SERIES_RANGE,
      points: ramp(48),
      source: "binance",
      fetchedAt: NOW,
    });

    expect(isSeriesFresh(row, NOW)).toBe(true);
    expect(isSeriesFresh(row, NOW + SERIES_CACHE_TTL_MS - 1)).toBe(true);
    expect(isSeriesFresh(row, NOW + SERIES_CACHE_TTL_MS)).toBe(false);
    expect(isSeriesFresh(row, NOW + SERIES_CACHE_TTL_MS + 1)).toBe(false);
  });

  it("serves an Alchemy series for 30 minutes", () => {
    const row = buildSeriesRow({
      assetId: "asset",
      range: SERIES_RANGE,
      points: ramp(48),
      source: "alchemy",
      fetchedAt: NOW,
    });

    expect(isSeriesFresh(row, NOW + SERIES_CACHE_TTL_MS - 1)).toBe(true);
    expect(isSeriesFresh(row, NOW + SERIES_CACHE_TTL_MS)).toBe(false);
  });

  it("serves a CoinGecko series for 60 minutes", () => {
    const row = buildSeriesRow({
      assetId: "asset",
      range: SERIES_RANGE,
      points: ramp(48),
      source: "coingecko",
      fetchedAt: NOW,
    });

    // Still fresh where a Binance row would have expired.
    expect(isSeriesFresh(row, NOW + SERIES_CACHE_TTL_MS)).toBe(true);
    expect(isSeriesFresh(row, NOW + SERIES_COINGECKO_CACHE_TTL_MS - 1)).toBe(
      true,
    );
    expect(isSeriesFresh(row, NOW + SERIES_COINGECKO_CACHE_TTL_MS)).toBe(false);
  });

  it("serves a no-history row for 60 seconds", () => {
    const row = negativeSeriesRow("asset", SERIES_RANGE, NOW);

    expect(isSeriesFresh(row, NOW + SERIES_NEGATIVE_TTL_MS - 1)).toBe(true);
    expect(isSeriesFresh(row, NOW + SERIES_NEGATIVE_TTL_MS)).toBe(false);
  });

  it("never treats a clock-skewed future row as stale", () => {
    const row = negativeSeriesRow("asset", SERIES_RANGE, NOW + 5_000);
    expect(isSeriesFresh(row, NOW)).toBe(true);
  });

  it("keys an asset and its range without collisions", () => {
    const key = seriesCacheKey("nep141:wrap.near", SERIES_RANGE);

    expect(key).toBe(seriesCacheKey("nep141:wrap.near", SERIES_RANGE));
    expect(key).not.toBe(seriesCacheKey("nep141:usdc.near", SERIES_RANGE));
  });
});

describe("series row encode and decode", () => {
  it("round-trips a real row", () => {
    const row = buildSeriesRow({
      assetId: "nep141:wrap.near",
      range: SERIES_RANGE,
      points: ramp(48),
      source: "binance",
      fetchedAt: NOW,
    });

    expect(decodeSeriesRow(recordOf(row))).toEqual(row);
  });

  it("round-trips a negative row", () => {
    const row = negativeSeriesRow("unknown", SERIES_RANGE, NOW);

    expect(decodeSeriesRow(recordOf(row))).toEqual(row);
  });

  it("returns null for a missing row", () => {
    expect(decodeSeriesRow(null)).toBeNull();
    expect(decodeSeriesRow(undefined)).toBeNull();
  });

  it("returns null for corrupt JSON or a non-array payload", () => {
    const base = recordOf(negativeSeriesRow("asset", SERIES_RANGE, NOW));

    expect(decodeSeriesRow({ ...base, points: "{not json" })).toBeNull();
    expect(decodeSeriesRow({ ...base, points: '{"time":1}' })).toBeNull();
    expect(decodeSeriesRow({ ...base, points: "null" })).toBeNull();
  });

  it("returns null for a row that fails validation", () => {
    const base = recordOf(negativeSeriesRow("asset", SERIES_RANGE, NOW));

    expect(decodeSeriesRow({ ...base, asset_id: "  " })).toBeNull();
    expect(decodeSeriesRow({ ...base, range: "7d" })).toBeNull();
    expect(decodeSeriesRow({ ...base, fetched_at: 0 })).toBeNull();
    expect(decodeSeriesRow({ ...base, source: "yahoo" })).toBeNull();
  });

  it("rejects a negative source on a row that has points", () => {
    const base = recordOf(negativeSeriesRow("asset", SERIES_RANGE, NOW));

    expect(
      decodeSeriesRow({
        ...base,
        points: encodeSeriesPoints(ramp(3)),
        source: "none",
      }),
    ).toBeNull();
  });

  it("rejects an empty row that names a real source", () => {
    const base = recordOf(negativeSeriesRow("asset", SERIES_RANGE, NOW));

    expect(decodeSeriesRow({ ...base, source: "binance" })).toBeNull();
  });

  it("trims a legacy row wider than 48 to the newest 48 by time", () => {
    const base = {
      ...recordOf(negativeSeriesRow("asset", SERIES_RANGE, NOW)),
      source: "binance",
    };
    const wide = ramp(60);
    const decoded = decodeSeriesRow({
      ...base,
      change_pct: 999,
      points: encodeSeriesPoints(wide),
    });

    expect(decoded?.points).toHaveLength(48);
    expect(decoded?.points[0]).toEqual(wide[12]);
    expect(decoded?.points.at(-1)).toEqual(wide[59]);

    const points = decoded?.points ?? [];
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index]!.time).toBeGreaterThan(points[index - 1]!.time);
    }

    // The stored percent described the 60-point row; the trimmed line must
    // recompute it rather than carry a number that no longer matches.
    expect(decoded?.changePct).not.toBe(999);
    expect(decoded?.changePct).toBeCloseTo(
      ((points.at(-1)!.value - points[0]!.value) / points[0]!.value) * 100,
    );
  });

  it("drops a corrupt point but keeps the usable ones", () => {
    const base = {
      ...recordOf(negativeSeriesRow("asset", SERIES_RANGE, NOW)),
      source: "binance",
    };
    const decoded = decodeSeriesRow({
      ...base,
      points: JSON.stringify([
        { time: 1_000, value: 100 },
        { time: 2_000 },
        { time: "3_000", value: 102 },
        null,
        { time: 4_000, value: 104 },
      ]),
    });

    expect(decoded?.points).toEqual([
      { time: 1_000, value: 100 },
      { time: 4_000, value: 104 },
    ]);
  });

  it("recomputes a missing or malformed change_pct from the points", () => {
    const base = recordOf(
      buildSeriesRow({
        assetId: "asset",
        range: SERIES_RANGE,
        points: [
          { time: 1_000, value: 100 },
          { time: 2_000, value: 110 },
        ],
        source: "alchemy",
        fetchedAt: NOW,
      }),
    );

    expect(decodeSeriesRow({ ...base, change_pct: null })?.changePct).toBeCloseTo(
      10,
    );
    expect(
      decodeSeriesRow({ ...base, change_pct: Number.NaN })?.changePct,
    ).toBeCloseTo(10);
    expect(decodeSeriesRow({ ...base, change_pct: 99 })?.changePct).toBe(99);
  });
});

describe("failed refetch", () => {
  const previous = buildSeriesRow({
    assetId: "asset",
    range: SERIES_RANGE,
    points: ramp(48),
    source: "binance",
    fetchedAt: NOW - SERIES_CACHE_TTL_MS - 1,
  });

  it("keeps the last good series and marks it stale without overwriting it", () => {
    const outcome = failedSeriesRow({
      assetId: "asset",
      range: SERIES_RANGE,
      previous,
      fetchedAt: NOW,
    });

    expect(outcome.write).toBe(false);
    expect(outcome.row.points).toEqual(previous.points);
    expect(outcome.row.source).toBe("binance");
    expect(outcome.row.fetchedAt).toBe(previous.fetchedAt);
    expect(outcome.row.stale).toBe(true);

    const body = presentHistory(outcome.row);
    expect(body.points).toEqual(previous.points);
    expect(body).not.toHaveProperty("reason");
    if ("stale" in body) expect(body.stale).toBe(true);
  });

  it("writes a negative row when there is no previous series", () => {
    const outcome = failedSeriesRow({
      assetId: "asset",
      range: SERIES_RANGE,
      previous: null,
      fetchedAt: NOW,
    });

    expect(outcome.write).toBe(true);
    expect(outcome.row).toEqual(
      negativeSeriesRow("asset", SERIES_RANGE, NOW),
    );
    expect(presentHistory(outcome.row)).toEqual(
      noHistory("asset", SERIES_RANGE),
    );
  });

  it("refreshes a negative row when the previous row had no points", () => {
    const old = negativeSeriesRow(
      "asset",
      SERIES_RANGE,
      NOW - SERIES_NEGATIVE_TTL_MS - 1,
    );

    const outcome = failedSeriesRow({
      assetId: "asset",
      range: SERIES_RANGE,
      previous: old,
      fetchedAt: NOW,
    });

    expect(outcome.write).toBe(true);
    expect(outcome.row.fetchedAt).toBe(NOW);
    expect(outcome.row.source).toBe("none");
  });
});

describe("no-history shape", () => {
  it("is the one empty body the card renders", () => {
    expect(noHistory("asset", SERIES_RANGE)).toEqual({
      assetId: "asset",
      range: "24h",
      points: [],
      reason: "no-history",
    });
  });

  it("is what a negative row presents", () => {
    expect(presentHistory(negativeSeriesRow("asset", SERIES_RANGE, NOW))).toEqual(
      noHistory("asset", SERIES_RANGE),
    );
  });

  it("is what an empty-point row presents, whatever its source", () => {
    const row: SeriesRow = {
      assetId: "asset",
      range: SERIES_RANGE,
      points: [],
      changePct: null,
      source: "binance",
      fetchedAt: NOW,
    };

    expect(presentHistory(row)).toEqual(noHistory("asset", SERIES_RANGE));
  });
});

describe("presentHistory", () => {
  it("returns the points, the source, and the last observation as asOf", () => {
    const points = ramp(48);
    const row = buildSeriesRow({
      assetId: "asset",
      range: SERIES_RANGE,
      points,
      source: "binance",
      fetchedAt: NOW,
    });

    const body = presentHistory(row);

    expect(body).toMatchObject({
      assetId: "asset",
      range: "24h",
      points,
      source: "binance",
      asOf: points.at(-1)!.time,
      incomplete: false,
    });
    expect(body).not.toHaveProperty("reason");
    expect(body).not.toHaveProperty("stale");
    if ("changePct" in body) {
      expect(body.changePct).toBeCloseTo(
        ((points.at(-1)!.value - points[0]!.value) / points[0]!.value) * 100,
      );
    }
  });

  it("marks a short series incomplete and keeps every point", () => {
    const points = ramp(5);
    const row = buildSeriesRow({
      assetId: "asset",
      range: SERIES_RANGE,
      points,
      source: "alchemy",
      fetchedAt: NOW,
    });

    const body = presentHistory(row);

    expect("incomplete" in body && body.incomplete).toBe(true);
    expect(body.points).toHaveLength(5);
  });

  it("derives changePct from the stored points when the column is null", () => {
    const row: SeriesRow = {
      assetId: "asset",
      range: SERIES_RANGE,
      points: [
        { time: 1_000, value: 100 },
        { time: 2_000, value: 125 },
      ],
      changePct: null,
      source: "coingecko",
      fetchedAt: NOW,
    };

    const body = presentHistory(row);

    if ("changePct" in body) expect(body.changePct).toBeCloseTo(25);
  });
});

describe("buildSeriesRow", () => {
  it("normalizes the points and derives the percent move", () => {
    const raw = ramp(288);
    const row = buildSeriesRow({
      assetId: "asset",
      range: SERIES_RANGE,
      points: raw,
      source: "binance",
      fetchedAt: NOW,
    });

    expect(row.points).toHaveLength(48);
    expect(row.source).toBe("binance");
    expect(row.fetchedAt).toBe(NOW);
    expect(row.changePct).toBeCloseTo(
      ((row.points.at(-1)!.value - row.points[0]!.value) /
        row.points[0]!.value) *
        100,
    );
  });
});

describe("isSupportedRange", () => {
  it("accepts only the 24-hour range", () => {
    expect(isSupportedRange("24h")).toBe(true);
    expect(isSupportedRange("7d")).toBe(false);
    expect(isSupportedRange("")).toBe(false);
    expect(isSupportedRange(null)).toBe(false);
  });
});
