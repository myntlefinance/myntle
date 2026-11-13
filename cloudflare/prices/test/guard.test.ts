import { beforeEach, describe, expect, it } from "vitest";
import { createBreaker } from "../src/lib/breaker";
import { countsAsOutage, withBreaker } from "../src/sources/guard";
import {
  fail,
  type SourceResult,
} from "../src/sources/types";

let now = 1_762_000_000_000;
const clock = (): number => now;

beforeEach(() => {
  now = 1_762_000_000_000;
});

function sourceOf(
  answer: () => Promise<SourceResult<number>>,
): { calls: number; fetchCurrent(): Promise<SourceResult<number>> } {
  const source = {
    calls: 0,
    async fetchCurrent(): Promise<SourceResult<number>> {
      source.calls += 1;
      return answer();
    },
  };
  return source;
}

describe("breaker guard", () => {
  it("skips a source while its breaker is open", async () => {
    const breaker = createBreaker({
      failures: 3,
      openMs: 60_000,
      now: clock,
    });
    const source = withBreaker(
      sourceOf(async () => fail("network")),
      breaker,
      "binance",
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await source.fetchCurrent();
    }

    expect(breaker.snapshot().state).toBe("open");

    const refused = await source.fetchCurrent();
    expect(source.calls).toBe(3);
    expect(refused).toEqual({
      ok: false,
      error: "breaker-open",
      retryAfterMs: 60_000,
    });
  });

  it("closes on a half-open probe that answers", async () => {
    const breaker = createBreaker({
      failures: 1,
      openMs: 60_000,
      now: clock,
    });
    let answer: SourceResult<number> = fail("network");
    const source = withBreaker(
      sourceOf(async () => answer),
      breaker,
      "alchemy",
    );

    await source.fetchCurrent();
    expect(breaker.snapshot().state).toBe("open");

    now += 60_001;
    answer = { ok: true, value: 1 };
    const probe = await source.fetchCurrent();

    expect(probe).toEqual({ ok: true, value: 1 });
    expect(breaker.snapshot().state).toBe("closed");
  });

  it("records a thrown call as a failure instead of wedging the probe", async () => {
    const breaker = createBreaker({
      failures: 1,
      openMs: 60_000,
      now: clock,
    });
    const source = withBreaker(
      sourceOf(async () => {
        throw new Error("socket hang up");
      }),
      breaker,
      "oneclick",
    );

    const result = await source.fetchCurrent();

    expect(result).toEqual({ ok: false, error: "network" });
    expect(breaker.snapshot().state).toBe("open");
  });

  it("treats a per-asset 400 as reachable and closes the breaker", async () => {
    const breaker = createBreaker({
      failures: 1,
      openMs: 60_000,
      now: clock,
    });
    let answer: SourceResult<number> = fail("network");
    const source = withBreaker(
      sourceOf(async () => answer),
      breaker,
      "alchemy",
    );

    await source.fetchCurrent();
    now += 60_001;

    answer = fail("unsupported", { status: 400 });
    await source.fetchCurrent();

    expect(breaker.snapshot().state).toBe("closed");
  });

  it("counts a partly failed batch as a failure, not a success", async () => {
    const breaker = createBreaker({
      failures: 2,
      openMs: 60_000,
      now: clock,
    });
    const source = withBreaker(
      sourceOf(async () => ({
        ok: true,
        value: 1,
        partial: true,
        failedChunks: 1,
      })),
      breaker,
      "binance",
    );

    await source.fetchCurrent();
    expect(breaker.snapshot().failures).toBe(1);
    expect(breaker.snapshot().state).toBe("closed");

    await source.fetchCurrent();
    expect(breaker.snapshot().state).toBe("open");
  });

  it("opens immediately when a partial batch carries a Retry-After", async () => {
    const breaker = createBreaker({
      failures: 3,
      openMs: 1_000,
      now: clock,
    });
    const partial: SourceResult<number> = {
      ok: true,
      value: 1,
      partial: true,
      failedChunks: 1,
      retryAfterMs: 5_000,
    };
    const source = withBreaker(
      sourceOf(async () => partial),
      breaker,
      "alchemy",
    );

    const result = await source.fetchCurrent();

    expect(result).toEqual(partial);
    expect(breaker.snapshot().state).toBe("open");
    expect(breaker.snapshot().retryAfterMs).toBe(5_000);
  });
});

describe("countsAsOutage", () => {
  it("counts transport, 5xx, credential, and rate-limit failures", () => {
    expect(countsAsOutage(fail("network"))).toBe(true);
    expect(countsAsOutage(fail("timeout"))).toBe(true);
    expect(countsAsOutage(fail("http-500", { status: 500 }))).toBe(true);
    expect(countsAsOutage(fail("http-401", { status: 401 }))).toBe(true);
    expect(countsAsOutage(fail("http-403", { status: 403 }))).toBe(true);
    expect(countsAsOutage(fail("http-418", { status: 418 }))).toBe(true);
    expect(
      countsAsOutage(fail("rate-limited", { status: 429, retryAfterMs: 5_000 })),
    ).toBe(true);
  });

  it("does not count a per-asset miss", () => {
    expect(countsAsOutage(fail("unsupported", { status: 400 }))).toBe(false);
    expect(countsAsOutage(fail("no-history"))).toBe(false);
    expect(countsAsOutage(fail("invalid-symbol"))).toBe(false);
    expect(countsAsOutage(fail("not-configured"))).toBe(false);
  });
});
