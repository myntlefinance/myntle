import { describe, expect, it } from "vitest";
import {
  describeError,
  hasFullKlineSeries,
  KLINE_POINTS,
  parseColo,
  parseJson,
  parseKlines,
  parseTickerPrices,
} from "../src/probe";

describe("parseColo", () => {
  it("reads the colo line from a trace body", () => {
    const trace = [
      "fl=123f45",
      "h=cloudflare.com",
      "ip=203.0.113.7",
      "colo=IAD",
      "tls=TLSv1.3",
    ].join("\n");

    expect(parseColo(trace)).toBe("IAD");
  });

  it("tolerates CRLF line endings", () => {
    expect(parseColo("fl=abc\r\ncolo=AMS\r\nts=1\r\n")).toBe("AMS");
  });

  it("returns null when the body has no colo line", () => {
    expect(parseColo("fl=abc\nh=cloudflare.com\n")).toBeNull();
  });

  it("returns null rather than matching colo inside another key", () => {
    expect(parseColo("xcolo=IAD\n")).toBeNull();
  });
});

describe("parseJson", () => {
  it("parses a well-formed body", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns undefined for a truncated or empty body", () => {
    expect(parseJson('<html>blocked')).toBeUndefined();
    expect(parseJson("")).toBeUndefined();
  });
});

describe("parseTickerPrices", () => {
  it("keeps symbol and numeric price", () => {
    const body = [
      { symbol: "BTCUSDT", price: "104321.12000000" },
      { symbol: "ETHUSDT", price: "3890.44" },
    ];

    expect(parseTickerPrices(body)).toEqual([
      { symbol: "BTCUSDT", price: 104321.12 },
      { symbol: "ETHUSDT", price: 3890.44 },
    ]);
  });

  it("drops rows without a symbol or a finite price", () => {
    const body = [
      { symbol: "BTCUSDT", price: "1" },
      { price: "2" },
      { symbol: "ETHUSDT" },
      { symbol: "SOLUSDT", price: "not-a-number" },
      null,
      "LINKUSDT",
    ];

    expect(parseTickerPrices(body)).toEqual([{ symbol: "BTCUSDT", price: 1 }]);
  });

  it("returns an empty list when the upstream sent an error object", () => {
    expect(parseTickerPrices({ code: -1121, msg: "Invalid symbol." })).toEqual(
      [],
    );
    expect(parseTickerPrices(undefined)).toEqual([]);
  });

  it("never turns an empty or null price into zero", () => {
    const body = [
      { symbol: "BTCUSDT", price: "" },
      { symbol: "ETHUSDT", price: "   " },
      { symbol: "SOLUSDT", price: null },
      { symbol: "NEARUSDT", price: true },
      { symbol: "LINKUSDT", price: [] },
    ];

    expect(parseTickerPrices(body)).toEqual([]);
  });

  it("keeps zero when the upstream really sent zero", () => {
    const body = [
      { symbol: "BTCUSDT", price: 0 },
      { symbol: "ETHUSDT", price: "0" },
      { symbol: "SOLUSDT", price: " 0.5 " },
    ];

    expect(parseTickerPrices(body)).toEqual([
      { symbol: "BTCUSDT", price: 0 },
      { symbol: "ETHUSDT", price: 0 },
      { symbol: "SOLUSDT", price: 0.5 },
    ]);
  });
});

describe("parseKlines", () => {
  const row = (openTime: number, close: string) => [
    openTime,
    "1.00",
    "2.00",
    "0.50",
    close,
    "1000",
    openTime + 1_799_999,
  ];

  it("takes the open time and the close of each candle", () => {
    const points = parseKlines([
      row(1_762_000_000_000, "3.61"),
      row(1_762_001_800_000, "3.72"),
    ]);

    expect(points).toEqual([
      { time: 1_762_000_000_000, value: 3.61 },
      { time: 1_762_001_800_000, value: 3.72 },
    ]);
  });

  it("sorts ascending even when the upstream answers out of order", () => {
    const points = parseKlines([row(2_000, "2"), row(1_000, "1")]);

    expect(points.map((point) => point.time)).toEqual([1_000, 2_000]);
  });

  it("keeps the valid rows and drops the malformed ones", () => {
    const points = parseKlines([
      row(1_000, "1"),
      [],
      "nope",
      [2_000, "1", "2", "0.5"],
      row(3_000, "abc"),
      null,
    ]);

    expect(points).toEqual([{ time: 1_000, value: 1 }]);
  });

  it("returns an empty list for a non-array body", () => {
    expect(parseKlines({ code: 451 })).toEqual([]);
    expect(parseKlines(undefined)).toEqual([]);
  });

  it("never turns an empty or null close into zero", () => {
    const points = parseKlines([
      [1_000, "1", "2", "0.5", ""],
      [2_000, "1", "2", "0.5", "   "],
      [3_000, "1", "2", "0.5", null],
      ["", "1", "2", "0.5", "4"],
      row(4_000, "4"),
    ]);

    expect(points).toEqual([{ time: 4_000, value: 4 }]);
  });

  it("accepts a numeric close and keeps a real zero", () => {
    const points = parseKlines([
      [1_000, "1", "2", "0.5", 0],
      [2_000, "1", "2", "0.5", 0.5],
    ]);

    expect(points).toEqual([
      { time: 1_000, value: 0 },
      { time: 2_000, value: 0.5 },
    ]);
  });
});

describe("hasFullKlineSeries", () => {
  const candle = (index: number) => [1_000 + index, "1", "2", "0.5", "1"];

  it("is true for exactly 48 parsed points", () => {
    const body = Array.from({ length: 48 }, (_, index) => candle(index));

    expect(KLINE_POINTS).toBe(48);
    expect(hasFullKlineSeries(parseKlines(body))).toBe(true);
  });

  it("is false when the upstream returned fewer than 48", () => {
    const body = Array.from({ length: 47 }, (_, index) => candle(index));

    expect(hasFullKlineSeries(parseKlines(body))).toBe(false);
  });

  it("is false when the upstream returned more than 48", () => {
    const body = Array.from({ length: 49 }, (_, index) => candle(index));

    expect(hasFullKlineSeries(parseKlines(body))).toBe(false);
  });
});

describe("describeError", () => {
  it("reduces an abort to a short timeout reason", () => {
    const error = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );

    expect(describeError(error)).toBe("timeout");
  });

  it("keeps an ordinary error message", () => {
    expect(describeError(new Error("network connection lost"))).toBe(
      "network connection lost",
    );
  });

  it("stringifies a thrown non-error", () => {
    expect(describeError("boom")).toBe("boom");
  });
});
