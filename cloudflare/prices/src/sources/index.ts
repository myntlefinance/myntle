import { createAlchemySource } from "./alchemy";
import { createBinanceSource } from "./binance";
import { createCoingeckoSource } from "./coingecko";
import { createOneclickSource } from "./oneclick";
import type { SourceConfig } from "./types";

/**
 * Build the four adapters from one config. Nothing here reads a binding, a
 * secret, or the environment: the Worker passes the keys in, and the adapters
 * stay callable from a test or a Bun probe with no Worker runtime.
 *
 * `list` is the /health shape for Step 04. The adapters do not share a method
 * signature because Binance.US prices pairs, Alchemy prices symbols, 1Click
 * prices asset ids, and CoinGecko only draws history. The single dispatch
 * shape is `createPriceResolver(sources, config)`, built over these same
 * instances so the Binance global-host cooldown and the 1Click catalogue
 * cache are shared.
 */
export function createSources(config: SourceConfig = {}) {
  const binance = createBinanceSource(config);
  const alchemy = createAlchemySource(config);
  const oneclick = createOneclickSource(config);
  const coingecko = createCoingeckoSource(config);

  return {
    binance,
    alchemy,
    oneclick,
    coingecko,
    list: [binance, alchemy, oneclick, coingecko],
  };
}

export type Sources = ReturnType<typeof createSources>;

export { createAlchemySource } from "./alchemy";
export type { AlchemyAddress, AlchemySource } from "./alchemy";
export { createBinanceSource } from "./binance";
export type { BinanceSource } from "./binance";
export { createCoingeckoSource } from "./coingecko";
export type { CoingeckoSource } from "./coingecko";
export { createOneclickSource } from "./oneclick";
export type { OneclickSource } from "./oneclick";
export { createPriceResolver } from "./resolve";
export type {
  BatchAttempt,
  BatchFailure,
  BatchResult,
  PriceResolver,
  ResolverAsset,
  SourceAdapters,
} from "./resolve";
export {
  fail,
  fromHttp,
  NOT_CONFIGURED,
  notConfigured,
} from "./types";
export type {
  CurrentQuote,
  LiveSourceName,
  PriceSeries,
  SeriesPoint,
  SourceAttempt,
  SourceConfig,
  SourceFailure,
  SourceName,
  SourceOk,
  SourceResult,
} from "./types";
