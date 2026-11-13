import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  encodePrices,
  errorFrame,
  frameBytes,
  MAX_ASSET_ID_LENGTH,
  MAX_FRAME_BYTES,
  MAX_SOCKET_ASSETS,
  parseClientFrame,
  planSubscriptions,
  planUnsubscriptions,
  unknownAssetsFrame,
} from "../src/protocol";
import type { Quote } from "../src/prices";

const NOW = 1_762_000_000_000;

function frame(value: unknown): string {
  return JSON.stringify(value);
}

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("frameBytes", () => {
  it("counts UTF-8 bytes rather than characters", () => {
    expect(frameBytes("abc")).toBe(3);
    expect(frameBytes("é")).toBe(2);
    expect(frameBytes(bytes("abc"))).toBe(3);
  });
});

describe("parseClientFrame", () => {
  it("accepts a sub and trims and dedupes its ids", () => {
    const parsed = parseClientFrame(
      frame({ t: "sub", assets: [" nep141:wrap.near ", "a", "a"] }),
    );

    expect(parsed).toEqual({
      ok: true,
      frame: { t: "sub", assets: ["nep141:wrap.near", "a"] },
    });
  });

  it("accepts an unsub", () => {
    expect(parseClientFrame(frame({ t: "unsub", assets: ["a"] }))).toEqual({
      ok: true,
      frame: { t: "unsub", assets: ["a"] },
    });
  });

  it("accepts a ping and ignores any other keys", () => {
    expect(parseClientFrame(frame({ t: "ping", assets: ["a"] }))).toEqual({
      ok: true,
      frame: { t: "ping" },
    });
  });

  it("accepts an empty asset list", () => {
    expect(parseClientFrame(frame({ t: "sub", assets: [] }))).toEqual({
      ok: true,
      frame: { t: "sub", assets: [] },
    });
  });

  it("accepts a binary frame and decodes it as text", () => {
    expect(parseClientFrame(bytes(frame({ t: "ping" })))).toEqual({
      ok: true,
      frame: { t: "ping" },
    });
  });

  it("rejects malformed JSON", () => {
    expect(parseClientFrame("{not json")).toEqual({
      ok: false,
      code: "bad-frame",
    });
  });

  it("rejects a missing, null or unknown t", () => {
    for (const value of [{}, { t: null }, { t: "subscribe" }, { t: 1 }]) {
      expect(parseClientFrame(frame(value))).toEqual({
        ok: false,
        code: "bad-frame",
      });
    }
  });

  it("rejects a non-array assets field", () => {
    for (const assets of ["a", 1, null, { a: "b" }]) {
      expect(parseClientFrame(frame({ t: "sub", assets }))).toEqual({
        ok: false,
        code: "bad-frame",
      });
    }
  });

  it("rejects a non-string, empty or over-long id", () => {
    expect(parseClientFrame(frame({ t: "sub", assets: ["a", 1] }))).toEqual({
      ok: false,
      code: "bad-frame",
    });
    expect(parseClientFrame(frame({ t: "sub", assets: ["   "] }))).toEqual({
      ok: false,
      code: "bad-frame",
    });
    expect(
      parseClientFrame(
        frame({ t: "sub", assets: ["x".repeat(MAX_ASSET_ID_LENGTH + 1)] }),
      ),
    ).toEqual({ ok: false, code: "bad-frame" });
  });

  it("accepts an id exactly at the length limit", () => {
    const assetId = "x".repeat(MAX_ASSET_ID_LENGTH);
    expect(parseClientFrame(frame({ t: "sub", assets: [assetId] }))).toEqual({
      ok: true,
      frame: { t: "sub", assets: [assetId] },
    });
  });

  it("accepts fifty ids and rejects fifty-one before the registry lookup", () => {
    const fifty = Array.from(
      { length: MAX_SOCKET_ASSETS },
      (_, index) => `id-${index}`,
    );

    expect(parseClientFrame(frame({ t: "sub", assets: fifty }))).toEqual({
      ok: true,
      frame: { t: "sub", assets: fifty },
    });

    expect(
      parseClientFrame(frame({ t: "sub", assets: [...fifty, "one-more"] })),
    ).toEqual({ ok: false, code: "too-many" });
  });

  it("caps unknown ids at the same limit, before validation", () => {
    const many = Array.from({ length: 120 }, (_, index) => `unknown-${index}`);

    expect(parseClientFrame(frame({ t: "sub", assets: many }))).toEqual({
      ok: false,
      code: "too-many",
    });
  });

  it("dedupes before applying the cap", () => {
    const fifty = Array.from(
      { length: MAX_SOCKET_ASSETS },
      (_, index) => `id-${index}`,
    );

    expect(
      parseClientFrame(frame({ t: "sub", assets: [...fifty, ...fifty] })).ok,
    ).toBe(true);
  });

  it("rejects a frame over 4KB, including a padded one", () => {
    const atLimit = `{"t":"ping"}${" ".repeat(MAX_FRAME_BYTES - 12)}`;
    expect(atLimit.length).toBe(MAX_FRAME_BYTES);
    expect(parseClientFrame(atLimit).ok).toBe(true);

    expect(parseClientFrame(`${atLimit} `)).toEqual({
      ok: false,
      code: "bad-frame",
    });
    expect(parseClientFrame(bytes(`${atLimit} `))).toEqual({
      ok: false,
      code: "bad-frame",
    });
  });

  it("rejects input that is not text or binary", () => {
    for (const input of [null, undefined, 42, {}, [], new Uint8Array([1])]) {
      expect(parseClientFrame(input)).toEqual({
        ok: false,
        code: "bad-frame",
      });
    }
  });
});

describe("planSubscriptions", () => {
  const known = new Set(["a", "b", "c"]);

  it("adds known ids, reports unknown ids, and stores only the known ones", () => {
    const plan = planSubscriptions([], ["a", "ghost", "b"], known);

    expect(plan.assets).toEqual(["a", "b"]);
    expect(plan.added).toEqual(["a", "b"]);
    expect(plan.unknown).toEqual(["ghost"]);
    expect(plan.tooMany).toBe(false);
  });

  it("is idempotent for an id already subscribed", () => {
    const plan = planSubscriptions(["a", "b"], ["a", "b"], known);

    expect(plan.assets).toEqual(["a", "b"]);
    expect(plan.added).toEqual([]);
    expect(plan.unknown).toEqual([]);
    expect(plan.tooMany).toBe(false);
  });

  it("dedupes a repeated id inside one message", () => {
    const plan = planSubscriptions([], ["a", "a", "a"], known);

    expect(plan.assets).toEqual(["a"]);
    expect(plan.added).toEqual(["a"]);
  });

  it("dedupes a repeated unknown id into one error", () => {
    const plan = planSubscriptions([], ["ghost", "ghost"], known);

    expect(plan.unknown).toEqual(["ghost"]);
    expect(plan.assets).toEqual([]);
  });

  it("adds the fiftieth asset", () => {
    const current = Array.from({ length: MAX_SOCKET_ASSETS - 1 }, (_, i) => `id-${i}`);
    const plan = planSubscriptions(current, ["last"], new Set(["last"]));

    expect(plan.tooMany).toBe(false);
    expect(plan.assets).toHaveLength(MAX_SOCKET_ASSETS);
    expect(plan.added).toEqual(["last"]);
  });

  it("keeps the existing set and adds nothing when a message crosses 50", () => {
    const current = Array.from({ length: MAX_SOCKET_ASSETS - 1 }, (_, i) => `id-${i}`);
    const plan = planSubscriptions(current, ["one", "two"], new Set(["one", "two"]));

    expect(plan.tooMany).toBe(true);
    expect(plan.assets).toEqual(current);
    expect(plan.added).toEqual([]);
    expect(plan.unknown).toEqual([]);
  });

  it("still allows a duplicate sub at the cap", () => {
    const current = Array.from({ length: MAX_SOCKET_ASSETS }, (_, i) => `id-${i}`);
    const plan = planSubscriptions(current, ["id-0"], new Set(["id-0"]));

    expect(plan.tooMany).toBe(false);
    expect(plan.assets).toHaveLength(MAX_SOCKET_ASSETS);
    expect(plan.added).toEqual([]);
  });

  it("rejects a brand new id at the cap", () => {
    const current = Array.from({ length: MAX_SOCKET_ASSETS }, (_, i) => `id-${i}`);
    const plan = planSubscriptions(current, ["fresh"], new Set(["fresh"]));

    expect(plan.tooMany).toBe(true);
    expect(plan.assets).toHaveLength(MAX_SOCKET_ASSETS);
  });

  it("does not mutate the current set it was given", () => {
    const current = ["a"];
    planSubscriptions(current, ["b"], known);

    expect(current).toEqual(["a"]);
  });
});

describe("planUnsubscriptions", () => {
  it("removes subscribed ids and preserves order", () => {
    const plan = planUnsubscriptions(["a", "b", "c"], ["b"]);

    expect(plan.assets).toEqual(["a", "c"]);
    expect(plan.removed).toEqual(["b"]);
  });

  it("ignores an id that was never subscribed", () => {
    const plan = planUnsubscriptions(["a"], ["ghost"]);

    expect(plan.assets).toEqual(["a"]);
    expect(plan.removed).toEqual([]);
  });

  it("dedupes the request and can empty the set", () => {
    const plan = planUnsubscriptions(["a", "b"], ["a", "a", "b"]);

    expect(plan.assets).toEqual([]);
    expect(plan.removed).toEqual(["a", "b"]);
  });
});

describe("encodePrices", () => {
  it("emits five-element tuples with the source and freshness", () => {
    const quotes = new Map<string, Quote>([
      ["a", { usd: 3.6, asOf: NOW, source: "binance" }],
      ["b", { usd: 1, asOf: NOW - 120_001, source: "alchemy" }],
    ]);

    expect(encodePrices(["a", "b"], quotes, NOW)).toEqual([
      ["a", 3.6, NOW, "binance", false],
      ["b", 1, NOW - 120_001, "alchemy", true],
    ]);
  });

  it("keeps a stored failure flag even while the quote is young", () => {
    const quotes = new Map<string, Quote>([
      ["a", { usd: 3.6, asOf: NOW, source: "oneclick", stale: true }],
    ]);

    expect(encodePrices(["a"], quotes, NOW)).toEqual([
      ["a", 3.6, NOW, "oneclick", true],
    ]);
  });

  it("skips a missing or malformed quote instead of sending a zero", () => {
    const quotes = new Map<string, Quote>([
      ["nan", { usd: Number.NaN, asOf: NOW, source: "binance" }],
      ["negative", { usd: -1, asOf: NOW, source: "binance" }],
      ["no-time", { usd: 1, asOf: 0, source: "binance" }],
      ["ok", { usd: 2, asOf: NOW, source: "binance" }],
    ]);

    expect(
      encodePrices(["nan", "negative", "no-time", "missing", "ok"], quotes, NOW),
    ).toEqual([["ok", 2, NOW, "binance", false]]);
  });

  it("preserves the order it was asked for and returns nothing for none", () => {
    const quotes = new Map<string, Quote>([
      ["a", { usd: 1, asOf: NOW, source: "binance" }],
      ["b", { usd: 2, asOf: NOW, source: "binance" }],
    ]);

    expect(encodePrices(["b", "a"], quotes, NOW).map((tuple) => tuple[0])).toEqual([
      "b",
      "a",
    ]);
    expect(encodePrices([], quotes, NOW)).toEqual([]);
  });
});

describe("server frames", () => {
  it("encodes a pong and an error with and without an asset", () => {
    expect(encodeFrame({ t: "pong" })).toBe('{"t":"pong"}');
    expect(errorFrame("too-many")).toEqual({ t: "error", code: "too-many" });
    expect(errorFrame("unknown-asset", "ghost")).toEqual({
      t: "error",
      code: "unknown-asset",
      asset: "ghost",
    });
  });

  it("batches unknown ids into one error frame, capped at fifty", () => {
    expect(unknownAssetsFrame(["a", "b"])).toEqual({
      t: "error",
      code: "unknown-asset",
      assets: ["a", "b"],
    });

    const many = Array.from({ length: 60 }, (_, index) => `id-${index}`);
    const capped = unknownAssetsFrame(many);
    expect(capped).toMatchObject({ t: "error", code: "unknown-asset" });
    expect((capped as { assets: string[] }).assets).toHaveLength(
      MAX_SOCKET_ASSETS,
    );
  });

  it("round-trips a snapshot frame through JSON", () => {
    const encoded = encodeFrame({
      t: "snapshot",
      prices: [["a", 3.6, NOW, "binance", false]],
    });

    expect(JSON.parse(encoded)).toEqual({
      t: "snapshot",
      prices: [["a", 3.6, NOW, "binance", false]],
    });
  });
});
