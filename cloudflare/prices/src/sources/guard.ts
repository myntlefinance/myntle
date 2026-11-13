/**
 * A breaker-aware view of one price adapter. The resolver sees the adapter's
 * normal shape, so a refused source is just a failed call and the walk moves
 * to the next candidate without special cases.
 *
 * Every completed call records an outcome, and every call is wrapped in
 * try/catch, so a half-open probe can never be left admitted and never
 * recorded: that would wedge the breaker permanently.
 */

import type { Breaker, BreakerState } from "../lib/breaker";
import {
  countsAsOutage,
  fail,
  type SourceResult,
} from "./types";

export { countsAsOutage };

function isSourceResult(value: unknown): value is SourceResult<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

function logTransition(name: string, before: BreakerState, after: BreakerState): void {
  if (before !== after) {
    console.log(`[prices] source ${name} ${before} -> ${after}`);
  }
}

export function withBreaker<T extends object>(
  source: T,
  breaker: Breaker,
  name: string,
): T {
  return new Proxy(source, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;

      return async (...args: unknown[]): Promise<unknown> => {
        if (!breaker.canTry()) {
          // Not an outage of its own: the resolver moves on to the next
          // source, and the half-open probe already in flight records the
          // real outcome.
          return fail("breaker-open", {
            retryAfterMs: breaker.snapshot().retryAfterMs,
          });
        }

        const before = breaker.snapshot().state;
        let result: unknown;

        try {
          result = await Reflect.apply(value, target, args);
        } catch {
          breaker.recordFailure();
          logTransition(name, before, breaker.snapshot().state);
          return fail("network");
        }

        if (isSourceResult(result)) {
          if (result.ok) {
            // A partly successful batch still carries usable quotes, but a
            // chunk failed: the source is degraded, so the breaker counts it.
            if (result.partial === true) breaker.recordFailure(result.retryAfterMs);
            else breaker.recordSuccess();
          } else if (countsAsOutage(result)) {
            breaker.recordFailure(result.retryAfterMs);
          } else {
            // A per-asset miss proves the host answered; it closes a
            // half-open breaker instead of reopening it.
            breaker.recordSuccess();
          }
        }

        logTransition(name, before, breaker.snapshot().state);
        return result;
      };
    },
  }) as T;
}
