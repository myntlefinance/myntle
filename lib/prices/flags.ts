/**
 * The price-service rollout flag.
 *
 * The browser store reads this at call time, which Next inlines into the
 * client bundle because the value is a literal `process.env.NEXT_PUBLIC_*`
 * reference. The server client reads the same variable at runtime.
 *
 * Only the exact string "1" turns the live feed on. A blank value, "0",
 * "true", or an unset variable keeps the existing `/api/assets` path: no
 * WebSocket, no Worker request, and the catalogue price on every surface.
 */

/** The environment variable, named once so a test cannot drift from it. */
export const PRICES_LIVE_ENV = "NEXT_PUBLIC_PRICES_LIVE";

export function isPricesLive(): boolean {
  return process.env.NEXT_PUBLIC_PRICES_LIVE === "1";
}
