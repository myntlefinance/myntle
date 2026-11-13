import type { PriceDesk } from "./price-desk";

/** Bindings and vars this Worker is deployed with. */
export interface Env {
  PRICE_DESK: DurableObjectNamespace<PriceDesk>;
  APP_ORIGINS?: string;
  /** Required for /probe; without it the route answers 404. */
  PROBE_KEY?: string;

  /**
   * Source configuration, read by Step 04 when it builds the resolver.
   * Secrets in production, plain strings in local dev; none is required for
   * the public Binance.US and 1Click paths.
   */
  ALCHEMY_API_KEY?: string;
  /** Only needed if Binance.US requires a key for public data. */
  BINANCE_US_API_KEY?: string;
  /** Raises the CoinGecko history fallback's free-tier rate limit. */
  COINGECKO_API_KEY?: string;
  /** A CoinGecko pro key; when set, the pro host and header are used. */
  COINGECKO_PRO_API_KEY?: string;
  /** "1" tries api.binance.com before the US hosts; anything else keeps US only. */
  BINANCE_GLOBAL?: string;
}
