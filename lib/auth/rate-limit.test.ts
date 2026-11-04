import { describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits } from "./rate-limit";

describe("rate limit", () => {
  it("allows bursts inside the budget", () => {
    resetRateLimits();
    for (let i = 0; i < 5; i += 1) {
      expect(checkRateLimit("k", 5, 60_000, 1000 + i).limited).toBe(false);
    }
  });

  it("blocks past the budget and recovers after the window", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i += 1) {
      checkRateLimit("k", 3, 60_000, i);
    }
    const blocked = checkRateLimit("k", 3, 60_000, 10);
    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(checkRateLimit("k", 3, 60_000, 60_001).limited).toBe(false);
  });

  it("tracks keys independently", () => {
    resetRateLimits();
    checkRateLimit("a", 1, 60_000, 0);
    expect(checkRateLimit("a", 1, 60_000, 1).limited).toBe(true);
    expect(checkRateLimit("b", 1, 60_000, 1).limited).toBe(false);
  });
});
