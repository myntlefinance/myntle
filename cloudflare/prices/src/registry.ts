import type { RawAsset } from "./catalogue";

/** Bump when the alias or precedence rules change, so a stale mapping is visible. */
export const REGISTRY_VERSION = "2";

export type PriceSource = "binance" | "alchemy" | "oneclick";

export type RegistryAsset = {
  assetId: string;
  symbol: string;
  chain: string;
  contract: string | null;
  decimals: number;
  coingeckoId: string | null;
  binanceSymbol: string | null;
  alchemySymbol: string | null;
  alchemyNetwork: string | null;
  alchemyAddress: string | null;
  primarySource: PriceSource;
  sources: PriceSource[];
  cataloguePrice: number | null;
  cataloguePriceUpdatedAt: number | null;
};

/**
 * 1:1 wrapped or bridged assets only. A staked or yield-bearing derivative is
 * a different unit with a different price, so it must never appear here. Keys
 * are uppercase because the catalogue mixes case (`wNEAR`, `cbBTC`).
 *
 * USDT0 is deliberately absent: its coingeckoId is `usdt0`, so it keeps its
 * own identity rather than borrowing USDT's price.
 */
export const ALIASES: Record<string, string> = {
  WETH: "ETH",
  WNEAR: "NEAR",
  WBTC: "BTC",
  CBBTC: "BTC",
  XBTC: "BTC",
  "BTC(OMNI)": "BTC",
  "USDC.E": "USDC",
};

/**
 * The majors the interface trades most. Binance.US is primary for these only:
 * a thin pair can be stale or wide, and Alchemy's aggregate is the better
 * display for the long tail even when a pair exists.
 */
export const LIQUID_SYMBOLS = new Set([
  "BTC",
  "ETH",
  "SOL",
  "NEAR",
  "LINK",
  "ARB",
  "OP",
  "SUI",
  "APT",
  "AVAX",
  "BNB",
  "ADA",
  "XRP",
  "DOGE",
  "LTC",
  "BCH",
  "TRX",
  "XLM",
  "ZEC",
  "UNI",
  "AAVE",
  "PEPE",
  "SHIB",
  "POL",
  "DAI",
  "USDC",
]);

/**
 * Tickers that collide with something else on Alchemy. Measured against the
 * live API on 10 Nov 2026; this is a candidate list until Step 03 confirms
 * each symbol at fetch time.
 */
const ALCHEMY_DENYLIST = new Set([
  "ABG",
  "NOEAR",
  "GNEAR",
  "TESTNEBULA",
  "CFI",
  "SPARKUSDC",
  "LAUSDC",
  "FMS",
  "WNEARKAT",
  "STJACK",
  "NRUSDT",
  "CNEAR",
  "TMU",
]);

/** Catalogue chain slug to Alchemy network, where the network is known. */
const ALCHEMY_NETWORKS: Record<string, string> = {
  eth: "eth-mainnet",
  base: "base-mainnet",
  arb: "arb-mainnet",
  op: "opt-mainnet",
  pol: "polygon-mainnet",
  sol: "solana-mainnet",
  bnb: "bnb-mainnet",
  // The catalogue calls BNB Smart Chain `bsc`; the two slugs are the same chain.
  bsc: "bnb-mainnet",
  avax: "avax-mainnet",
  gnosis: "gnosis-mainnet",
  scroll: "scroll-mainnet",
  linea: "linea-mainnet",
  blast: "blast-mainnet",
  mantle: "mantle-mainnet",
  zksync: "zksync-mainnet",
  celo: "celo-mainnet",
  unichain: "unichain-mainnet",
  soneium: "soneium-mainnet",
  // hood, xlayer, monad, bera and plasma are left out on purpose: Alchemy's
  // network slug for each is unverified, and a guessed slug fails at fetch time.
};

/**
 * A stablecoin ticker is not an identity: "USDC" on an obscure chain could be
 * anything. The coingeckoId is the guard, and a mismatch blocks every mapping.
 */
const STABLE_ASSETS: ReadonlyMap<string, string> = new Map([
  ["USDC", "usd-coin"],
  ["USDT", "tether"],
  ["DAI", "dai"],
]);

const ALCHEMY_SYMBOL = /^[A-Z0-9]+$/;

function findBinancePair(ticker: string, symbols: Set<string>): string | null {
  for (const quote of ["USDT", "USD", "USDC"]) {
    const pair = `${ticker}${quote}`;
    if (symbols.has(pair)) return pair;
  }
  return null;
}

function alchemyNetworkFor(chain: string): string | null {
  return ALCHEMY_NETWORKS[chain.toLowerCase()] ?? null;
}

/**
 * One row per catalogue asset, with the fallback plan it should follow.
 *
 * The order is deliberate: a liquid major on a real pair wins, then the
 * aggregate, then any remaining pair, then the catalogue's own five-minute
 * batch. A row always ends in oneclick, so every asset can produce a value.
 */
export function buildRegistry(
  raw: RawAsset[],
  binanceSymbols: Set<string>,
): RegistryAsset[] {
  return raw.map((asset) => {
    const rawTicker = asset.symbol.toUpperCase();
    const ticker = ALIASES[rawTicker] ?? rawTicker;

    // The guard follows the alias target, so a wrapped or bridged stable cannot
    // inherit the ticker without proving the identity behind it.
    const expectedStableId = STABLE_ASSETS.get(ticker);
    const identityVerified =
      expectedStableId === undefined
        ? asset.coingeckoId !== null
        : asset.coingeckoId === expectedStableId;

    const binanceSymbol = identityVerified
      ? findBinancePair(ticker, binanceSymbols)
      : null;
    const alchemySymbol =
      identityVerified &&
      ALCHEMY_SYMBOL.test(ticker) &&
      !ALCHEMY_DENYLIST.has(ticker)
        ? ticker
        : null;

    let primarySource: PriceSource;
    if (LIQUID_SYMBOLS.has(ticker) && binanceSymbol !== null) {
      primarySource = "binance";
    } else if (alchemySymbol !== null) {
      primarySource = "alchemy";
    } else if (binanceSymbol !== null) {
      primarySource = "binance";
    } else {
      primarySource = "oneclick";
    }

    // The primary source leads the fallback plan; the rest follow, and the
    // catalogue's own five-minute batch is always the last resort.
    const sources: PriceSource[] = [primarySource];
    if (primarySource !== "binance" && binanceSymbol !== null) {
      sources.push("binance");
    }
    if (primarySource !== "alchemy" && alchemySymbol !== null) {
      sources.push("alchemy");
    }
    if (primarySource !== "oneclick") sources.push("oneclick");

    return {
      assetId: asset.assetId,
      symbol: asset.symbol,
      chain: asset.chain,
      contract: asset.contract,
      decimals: asset.decimals,
      coingeckoId: asset.coingeckoId,
      binanceSymbol,
      alchemySymbol,
      alchemyNetwork: alchemyNetworkFor(asset.chain),
      alchemyAddress: asset.contract,
      primarySource,
      sources: [...new Set(sources)],
      cataloguePrice: asset.price,
      cataloguePriceUpdatedAt: asset.priceUpdatedAt,
    };
  });
}
