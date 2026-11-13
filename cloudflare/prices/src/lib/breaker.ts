/**
 * A per-source circuit breaker. It is pure and clock-injected so the tests can
 * move time without a timer, and the Durable Object can hold one per source.
 *
 * Closed: requests flow. After `failures` consecutive failures the breaker
 * opens for `openMs`, and `canTry` answers false. Once the window elapses the
 * breaker is half-open: exactly one caller is admitted as the probe. A success
 * closes it and resets the count; a failed probe opens a fresh window.
 *
 * A caller that learns a ban window from the upstream (Binance.US answers 418
 * with Retry-After) can open the breaker immediately with `recordFailure(ms)`
 * even when the consecutive count is still below the threshold.
 */

export type BreakerOptions = {
  /** Consecutive failures that open the breaker. */
  failures?: number;
  /** How long the breaker stays open before a half-open attempt. */
  openMs?: number;
  now?: () => number;
};

export type BreakerState = "closed" | "open" | "half-open";

export type BreakerSnapshot = {
  state: BreakerState;
  failures: number;
  /** Epoch milliseconds, or null while closed. */
  openUntil: number | null;
  /** Milliseconds until a half-open attempt is allowed; 0 when it is. */
  retryAfterMs: number;
  /** True once the single half-open probe has been admitted. */
  probing: boolean;
};

export type Breaker = {
  canTry(): boolean;
  recordSuccess(): void;
  recordFailure(retryAfterMs?: number): void;
  snapshot(): BreakerSnapshot;
};

const DEFAULT_FAILURES = 3;
const DEFAULT_OPEN_MS = 60_000;

export function createBreaker(options: BreakerOptions = {}): Breaker {
  const threshold = Math.max(1, options.failures ?? DEFAULT_FAILURES);
  const openMs = Math.max(0, options.openMs ?? DEFAULT_OPEN_MS);
  const now = options.now ?? Date.now;

  let failures = 0;
  let openUntil: number | null = null;
  let probing = false;

  function state(): BreakerState {
    if (openUntil === null) return "closed";
    return now() < openUntil ? "open" : "half-open";
  }

  return {
    /**
     * In half-open this admits one caller and refuses the rest until that
     * caller records an outcome, so a recovered source does not receive the
     * whole watched set at once.
     */
    canTry(): boolean {
      const current = state();
      if (current === "closed") return true;
      if (current === "open") return false;
      if (probing) return false;

      probing = true;
      return true;
    },

    recordSuccess(): void {
      failures = 0;
      openUntil = null;
      probing = false;
    },

    recordFailure(retryAfterMs?: number): void {
      const current = state();

      // A failure while already open must not extend the window: the caller
      // is supposed to stop after canTry() says no.
      if (current === "open") return;

      // A ban window from the upstream is authoritative and opens the breaker
      // immediately, even on the first failure.
      if (retryAfterMs !== undefined && retryAfterMs > 0) {
        failures = Math.max(failures + 1, threshold);
        openUntil = now() + Math.max(openMs, retryAfterMs);
        probing = false;
        return;
      }

      // A failed half-open probe reopens immediately, regardless of the
      // threshold. Letting it stay half-open would send every caller upstream.
      if (current === "half-open") {
        failures = threshold;
        openUntil = now() + openMs;
        probing = false;
        return;
      }

      failures += 1;
      if (failures >= threshold) {
        openUntil = now() + openMs;
        probing = false;
      }
    },

    snapshot(): BreakerSnapshot {
      const current = state();
      const remaining =
        openUntil === null ? 0 : Math.max(0, openUntil - now());

      return {
        state: current,
        failures,
        openUntil,
        retryAfterMs: current === "open" ? remaining : 0,
        probing,
      };
    },
  };
}
