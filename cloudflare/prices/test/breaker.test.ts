import { describe, expect, it } from "vitest";
import { createBreaker, type BreakerSnapshot } from "../src/lib/breaker";

const OPEN_MS = 60_000;

function closed(failures = 0): BreakerSnapshot {
  return {
    state: "closed",
    failures,
    openUntil: null,
    retryAfterMs: 0,
    probing: false,
  };
}

function clockFrom(start: number) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createBreaker", () => {
  it("starts closed and stays closed below the threshold", () => {
    const clock = clockFrom(1_000_000);
    const breaker = createBreaker({ now: clock.now });

    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.canTry()).toBe(true);
    expect(breaker.snapshot()).toEqual(closed(2));
  });

  it("opens after three consecutive failures", () => {
    const clock = clockFrom(1_000_000);
    const breaker = createBreaker({ now: clock.now });

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.canTry()).toBe(false);
    expect(breaker.snapshot()).toEqual({
      state: "open",
      failures: 3,
      openUntil: 1_060_000,
      retryAfterMs: OPEN_MS,
      probing: false,
    });
  });

  it("becomes half-open after the cooldown and admits one probe", () => {
    const clock = clockFrom(1_000_000);
    const breaker = createBreaker({ now: clock.now });

    for (let index = 0; index < 3; index++) breaker.recordFailure();

    clock.advance(OPEN_MS - 1);
    expect(breaker.canTry()).toBe(false);
    expect(breaker.snapshot().retryAfterMs).toBe(1);

    clock.advance(1);
    expect(breaker.canTry()).toBe(true);
    expect(breaker.snapshot()).toEqual({
      state: "half-open",
      failures: 3,
      openUntil: 1_060_000,
      retryAfterMs: 0,
      probing: true,
    });

    // Only the admitted probe gets through until it records an outcome.
    expect(breaker.canTry()).toBe(false);
  });

  it("closes and resets on a half-open success", () => {
    const clock = clockFrom(1_000_000);
    const breaker = createBreaker({ now: clock.now });

    for (let index = 0; index < 3; index++) breaker.recordFailure();
    clock.advance(OPEN_MS);
    breaker.canTry();
    breaker.recordSuccess();

    expect(breaker.canTry()).toBe(true);
    expect(breaker.snapshot()).toEqual(closed());
  });

  it("reopens immediately when the half-open attempt fails", () => {
    const clock = clockFrom(1_000_000);
    const breaker = createBreaker({ now: clock.now });

    for (let index = 0; index < 3; index++) breaker.recordFailure();
    clock.advance(OPEN_MS);
    breaker.canTry();
    breaker.recordFailure();

    expect(breaker.canTry()).toBe(false);
    expect(breaker.snapshot()).toEqual({
      state: "open",
      failures: 3,
      openUntil: 1_120_000,
      retryAfterMs: OPEN_MS,
      probing: false,
    });
  });

  it("clears the failure count on a closed success", () => {
    const clock = clockFrom(1_000_000);
    const breaker = createBreaker({ now: clock.now });

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.snapshot().state).toBe("closed");
    expect(breaker.snapshot().failures).toBe(2);
  });

  it("does not extend an already open window", () => {
    const clock = clockFrom(1_000_000);
    const breaker = createBreaker({ now: clock.now });

    for (let index = 0; index < 3; index++) breaker.recordFailure();
    clock.advance(10_000);
    breaker.recordFailure();

    expect(breaker.snapshot().openUntil).toBe(1_060_000);
  });

  it("opens immediately for an upstream ban window", () => {
    const clock = clockFrom(1_000_000);
    const breaker = createBreaker({ now: clock.now });

    // One 418 is enough: the Retry-After is the authority, not the count.
    breaker.recordFailure(600_000);

    expect(breaker.canTry()).toBe(false);
    expect(breaker.snapshot()).toEqual({
      state: "open",
      failures: 3,
      openUntil: 1_600_000,
      retryAfterMs: 600_000,
      probing: false,
    });
  });

  it("never opens for less than the standard window", () => {
    const clock = clockFrom(1_000_000);
    const breaker = createBreaker({ now: clock.now });

    breaker.recordFailure(5_000);

    expect(breaker.snapshot().openUntil).toBe(1_060_000);
  });

  it("honours explicit options", () => {
    const clock = clockFrom(0);
    const breaker = createBreaker({
      failures: 1,
      openMs: 5_000,
      now: clock.now,
    });

    breaker.recordFailure();

    expect(breaker.snapshot()).toEqual({
      state: "open",
      failures: 1,
      openUntil: 5_000,
      retryAfterMs: 5_000,
      probing: false,
    });
  });
});
