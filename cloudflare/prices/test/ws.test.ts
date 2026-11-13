import { describe, expect, it } from "vitest";
import { MAX_SOCKET_ASSETS } from "../src/protocol";
import {
  buildPatchFrame,
  buildSnapshotFrame,
  decodeAttachment,
  encodeAttachment,
  fanOut,
  filterKnownAssets,
  noteMessage,
  overlapAssets,
  publishIds,
  unionSocketAssets,
} from "../src/ws";
import { mergeQuotes, type Quote } from "../src/prices";

const NOW = 1_762_000_000_000;

function quotes(entries: Record<string, number>): Map<string, Quote> {
  return new Map(
    Object.entries(entries).map(([assetId, usd]) => [
      assetId,
      { usd, asOf: NOW, source: "binance" as const },
    ]),
  );
}

function parsed(frame: string | null): {
  t: string;
  prices: [string, number, number, string, boolean][];
} {
  expect(frame).not.toBeNull();
  return JSON.parse(frame as string);
}

describe("socket attachment", () => {
  it("round-trips through JSON exactly as the runtime stores it", () => {
    const attachment = encodeAttachment(["a", "b"]);
    const restored = decodeAttachment(JSON.parse(JSON.stringify(attachment)));

    expect(attachment).toEqual({ assets: ["a", "b"] });
    expect(restored).toEqual(attachment);
  });

  it("trims, dedupes and bounds the stored set", () => {
    expect(encodeAttachment([" a ", "a", "b"])).toEqual({ assets: ["a", "b"] });

    const many = Array.from({ length: MAX_SOCKET_ASSETS + 5 }, (_, i) => `id-${i}`);
    expect(encodeAttachment(many).assets).toHaveLength(MAX_SOCKET_ASSETS);
  });

  it("treats a missing, corrupt or wrong-shaped attachment as empty", () => {
    for (const raw of [null, undefined, {}, [], { assets: "a" }, 42]) {
      expect(decodeAttachment(raw)).toEqual({ assets: [] });
    }
  });

  it("drops a non-string or blank entry instead of trusting it", () => {
    expect(
      decodeAttachment({ assets: ["a", 1, null, "  ", "b"] }),
    ).toEqual({ assets: ["a", "b"] });
  });
});

describe("overlapAssets", () => {
  it("returns only the subscribed ids a publish touched, in subscription order", () => {
    expect(overlapAssets(["b", "a"], new Set(["a", "b", "c"]))).toEqual([
      "b",
      "a",
    ]);
  });

  it("returns nothing for a socket with no overlap", () => {
    expect(overlapAssets(["x"], new Set(["a"]))).toEqual([]);
  });
});

describe("fan-out", () => {
  it("sends one patch per socket, holding only that socket's overlapping ids", () => {
    const frames = fanOut(
      [
        { socket: "one", assets: ["a", "b"] },
        { socket: "two", assets: ["c"] },
        { socket: "three", assets: ["x"] },
      ],
      ["a", "b", "c"],
      quotes({ a: 1, b: 2, c: 3, x: 4 }),
      NOW,
    );

    expect(frames).toHaveLength(2);

    const first = parsed(frames[0]?.frame ?? null);
    expect(first.t).toBe("patch");
    expect(first.prices.map((tuple) => tuple[0])).toEqual(["a", "b"]);

    const second = parsed(frames[1]?.frame ?? null);
    expect(second.prices.map((tuple) => tuple[0])).toEqual(["c"]);
  });

  it("sends nothing to a socket whose overlapping quote is missing", () => {
    const frames = fanOut(
      [{ socket: "one", assets: ["a"] }],
      ["a"],
      new Map(),
      NOW,
    );

    expect(frames).toEqual([]);
  });

  it("carries every changed asset in one frame rather than one frame per asset", () => {
    const frames = fanOut(
      [{ socket: "one", assets: ["a", "b", "c"] }],
      ["a", "b", "c"],
      quotes({ a: 1, b: 2, c: 3 }),
      NOW,
    );

    expect(frames).toHaveLength(1);
    expect(parsed(frames[0]?.frame ?? null).prices).toHaveLength(3);
  });
});

describe("frame builders", () => {
  it("builds a patch for the overlap and null when there is none", () => {
    const patch = buildPatchFrame(["a", "b"], new Set(["a", "b", "c"]), quotes({ a: 1, b: 2 }), NOW);

    expect(parsed(patch)).toEqual({
      t: "patch",
      prices: [
        ["a", 1, NOW, "binance", false],
        ["b", 2, NOW, "binance", false],
      ],
    });

    expect(buildPatchFrame(["x"], new Set(["a"]), quotes({ a: 1 }), NOW)).toBeNull();
    expect(buildPatchFrame(["a"], new Set(["a"]), new Map(), NOW)).toBeNull();
  });

  it("builds a snapshot with every cached subscribed quote, even an empty one", () => {
    expect(
      parsed(buildSnapshotFrame(["a", "missing"], quotes({ a: 1 }), NOW)),
    ).toEqual({
      t: "snapshot",
      prices: [["a", 1, NOW, "binance", false]],
    });

    expect(parsed(buildSnapshotFrame(["missing"], new Map(), NOW))).toEqual({
      t: "snapshot",
      prices: [],
    });
  });
});

describe("unionSocketAssets", () => {
  it("unions every socket's set, sorted", () => {
    expect(
      unionSocketAssets([["c", "a"], ["b"], [], ["a"]]),
    ).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for no sockets", () => {
    expect(unionSocketAssets([])).toEqual([]);
  });
});

describe("registry filtering and publish ids", () => {
  it("drops ids the registry no longer lists, preserving order", () => {
    expect(filterKnownAssets(["a", "gone", "b"], new Set(["a", "b"]))).toEqual([
      "a",
      "b",
    ]);
  });

  it("unions updated and failed ids without duplicates", () => {
    expect(publishIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("publishes a failed refresh with its prior quote marked stale", () => {
    const before = new Map<string, Quote>([
      ["a", { usd: 3, asOf: NOW, source: "binance" }],
    ]);
    const after = mergeQuotes(before, { quotes: new Map(), failures: ["a"] });

    const frame = buildPatchFrame(
      ["a"],
      new Set(publishIds([], ["a"])),
      after,
      NOW,
    );

    expect(parsed(frame).prices).toEqual([["a", 3, NOW, "binance", true]]);
  });
});

describe("noteMessage", () => {
  it("allows sixty frames a minute and refuses the sixty-first", () => {
    let window = noteMessage(undefined, NOW).window;

    for (let index = 1; index < 60; index += 1) {
      const decision = noteMessage(window, NOW);
      expect(decision.allowed).toBe(true);
      window = decision.window;
    }

    const refused = noteMessage(window, NOW);
    expect(refused.allowed).toBe(false);
    expect(refused.window.count).toBe(61);
  });

  it("starts a fresh window at the minute boundary", () => {
    const window = { startedAt: NOW, count: 60 };

    expect(noteMessage(window, NOW + 59_999).allowed).toBe(false);
    expect(noteMessage(window, NOW + 60_000)).toEqual({
      allowed: true,
      window: { startedAt: NOW + 60_000, count: 1 },
    });
  });

  it("starts over when the clock moves backwards", () => {
    expect(noteMessage({ startedAt: NOW, count: 60 }, NOW - 1)).toEqual({
      allowed: true,
      window: { startedAt: NOW - 1, count: 1 },
    });
  });
});
