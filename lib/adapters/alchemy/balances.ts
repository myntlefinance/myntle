/**
 * Balances adapter over the portfolio provider. This directory is the only
 * place (besides the registry) that may read a provider key or call a
 * provider URL — see the boundary test in `lib/ports/boundary.test.ts`.
 *
 * Contents moved verbatim from `lib/wallet/balances.ts` in step 03:
 * chunking (5 networks per request), `pageKey` paging, the once-only
 * partial-failure retry, and the token-to-balance mapping. Pure vocabulary
 * (`formatTokenAmount`, `classifyAssetCategory`, `isPhishingToken`, …)
 * stays in `lib/wallet/balances.ts` and is reused here, never redefined.
 *
 * Edge mapping: provider responses become port types on return, and every
 * failure throws the taxonomy from `lib/ports/errors.ts` — never the
 * legacy `{ error }` string shape. A missing key throws
 * `ProviderNotConfigured`; any other transient failure throws
 * `ProviderUnavailable` with a generic message. Provider detail goes to
 * the server log, never to the caller.
 *
 * Server-side only: the key must never reach the browser.
 */

import type {
  BalanceFilterOptions,
  BalancesPort,
  BalancesResult,
  TokenBalance,
} from "@/lib/ports";
import { ProviderNotConfigured, ProviderUnavailable } from "@/lib/ports";
import {
  classifyAssetCategory,
  formatTokenAmount,
  isPhishingToken,
} from "@/lib/wallet/balances";

const PROVIDER_NAME = "alchemy";

/** Generic caller-facing message: no provider names reach the client. */
const UNAVAILABLE_MESSAGE = "Balances are unavailable. Try again shortly.";

function unavailable(detail: string): ProviderUnavailable {
  console.error(`[alchemy-balances] ${detail}`);
  return new ProviderUnavailable(UNAVAILABLE_MESSAGE);
}

const NETWORK_DEFAULTS: Record<
  string,
  { symbol: string; name: string; decimals: number }
> = {
  "eth-mainnet": { symbol: "ETH", name: "Ethereum", decimals: 18 },
  "base-mainnet": { symbol: "ETH", name: "Base ETH", decimals: 18 },
  "arb-mainnet": { symbol: "ETH", name: "Arbitrum ETH", decimals: 18 },
  "polygon-mainnet": { symbol: "POL", name: "Polygon", decimals: 18 },
  "matic-mainnet": { symbol: "POL", name: "Polygon", decimals: 18 },
  "opt-mainnet": { symbol: "ETH", name: "Optimism ETH", decimals: 18 },
  "bnb-mainnet": { symbol: "BNB", name: "BNB", decimals: 18 },
  "avax-mainnet": { symbol: "AVAX", name: "Avalanche", decimals: 18 },
  "gnosis-mainnet": { symbol: "xDAI", name: "xDAI", decimals: 18 },
  "linea-mainnet": { symbol: "ETH", name: "Linea ETH", decimals: 18 },
  "scroll-mainnet": { symbol: "ETH", name: "Scroll ETH", decimals: 18 },
  "zksync-mainnet": { symbol: "ETH", name: "ZKsync ETH", decimals: 18 },
  "blast-mainnet": { symbol: "ETH", name: "Blast ETH", decimals: 18 },
  "mantle-mainnet": { symbol: "MNT", name: "Mantle", decimals: 18 },
  "celo-mainnet": { symbol: "CELO", name: "Celo", decimals: 18 },
  "unichain-mainnet": { symbol: "ETH", name: "Unichain ETH", decimals: 18 },
  "soneium-mainnet": { symbol: "ETH", name: "Soneium ETH", decimals: 18 },
  "solana-mainnet": { symbol: "SOL", name: "Solana", decimals: 9 },
};

type AlchemyTokenItem = {
  network: string;
  address: string;
  tokenAddress: string | null;
  tokenBalance: string;
  isSpam?: boolean;
  spamClassifications?: string[];
  error?: string | null;
  tokenMetadata?: {
    name?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    logo?: string | null;
    isSpam?: boolean;
  };
  tokenPrices?: Array<{
    currency: string;
    value: string;
    lastUpdatedAt?: string;
  }>;
};

type AlchemyPortfolioResponse = {
  data?: {
    tokens?: AlchemyTokenItem[];
    pageKey?: string | null;
  };
  error?: {
    message?: string;
    partialErrors?: Array<{ network?: string; message?: string }>;
    code?: number;
  };
};

/**
 * Every EVM mainnet the Portfolio API is asked about. Alchemy caps one
 * request at 5 networks per address, so the caller chunks this list and
 * runs the chunks in parallel. The user never configures it: a watched
 * address reads all of these by default.
 */
const ALL_EVM_PORTFOLIO_NETWORKS = [
  "eth-mainnet",
  "base-mainnet",
  "arb-mainnet",
  "opt-mainnet",
  "polygon-mainnet",
  "bnb-mainnet",
  "avax-mainnet",
  "gnosis-mainnet",
  "linea-mainnet",
  "scroll-mainnet",
  "zksync-mainnet",
  "blast-mainnet",
  "mantle-mainnet",
  "celo-mainnet",
  "unichain-mainnet",
  "soneium-mainnet",
];

export const FAST_EVM_NETWORKS = [
  "eth-mainnet",
  "base-mainnet",
  "arb-mainnet",
  "opt-mainnet",
  "polygon-mainnet",
];

function chunkNetworks(networks: string[], size = 5): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < networks.length; i += size) {
    out.push(networks.slice(i, i + size));
  }
  return out;
}

type AlchemyChunkResult = {
  tokens: AlchemyTokenItem[];
  failedNetworks: string[];
};

/**
 * One network chunk, fully paged. Follows `pageKey` until Alchemy says
 * there is no next page, and keeps the successful tokens even when some
 * networks in the chunk report `partialErrors`.
 */
async function fetchAlchemyChunk(
  apiKey: string,
  address: string,
  networks: string[],
  maxPages = 20,
  allowRetry = true,
): Promise<AlchemyChunkResult> {
  const tokens: AlchemyTokenItem[] = [];
  const failed = new Set<string>();
  let pageKey: string | null | undefined;
  // Safety cap: a dusted whale can page deep, but never loop forever.
  const cappedPages = Math.max(1, Math.floor(maxPages));

  for (let page = 0; page < cappedPages; page += 1) {
    const res = await fetch(
      `https://api.g.alchemy.com/data/v1/${apiKey}/assets/tokens/by-address`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresses: [{ address, networks }],
          withMetadata: true,
          withPrices: true,
          includeNativeTokens: true,
          includeErc20Tokens: true,
          excludeFilters: ["SPAM"],
          ...(pageKey ? { pageKey } : {}),
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw unavailable(
        `chunk failed: status ${res.status} networks ${networks.join(",")}: ${errText.slice(0, 120)}`,
      );
    }

    const json = (await res.json()) as AlchemyPortfolioResponse;
    for (const item of json.data?.tokens ?? []) tokens.push(item);
    for (const entry of json.error?.partialErrors ?? []) {
      if (entry.network) failed.add(entry.network);
    }

    const next = json.data?.pageKey;
    if (!next) break;
    pageKey = next;
  }

  // Retry only the failed networks once, per the partial-failure guidance:
  // a failed network is absent from the next page, so it needs a new request.
  // The retry never recurses: a network that fails twice is reported, not
  // chased, so one bad slug can't hold the whole refresh open.
  if (allowRetry && failed.size > 0) {
    const retryNetworks = [...failed].filter((n) => networks.includes(n));
    if (retryNetworks.length > 0) {
      try {
        const retry = await fetchAlchemyChunk(apiKey, address, retryNetworks, maxPages, false);
        for (const item of retry.tokens) tokens.push(item);
        for (const n of retry.failedNetworks) failed.add(n);
        for (const n of retryNetworks) {
          if (!retry.failedNetworks.includes(n)) failed.delete(n);
        }
      } catch {
        // Keep the successful tokens; the chunk result still reports failures.
      }
    }
  }

  return { tokens, failedNetworks: [...failed] };
}

/**
 * Fetches token balances for EVM and Solana addresses via Alchemy's Portfolio API.
 *
 * EVM reads cover every network in ALL_EVM_PORTFOLIO_NETWORKS by default,
 * chunked to Alchemy's 5-networks-per-request limit and fully paged via
 * pageKey. An explicit `networks` filter narrows the read instead.
 *
 * Returns port types; every failure throws the port taxonomy. A missing
 * key throws `ProviderNotConfigured`; a failed or unreachable provider
 * throws `ProviderUnavailable`.
 */
export async function fetchAlchemyBalances(
  address: string,
  chain: "evm" | "solana",
  options?: BalanceFilterOptions,
  apiKey: string | undefined = process.env.ALCHEMY_API_KEY,
): Promise<BalancesResult> {
  const EVM_NETWORK_MAP: Record<string, string> = {
    arbitrum: "arb-mainnet",
    base: "base-mainnet",
    ethereum: "eth-mainnet",
    optimism: "opt-mainnet",
    polygon: "polygon-mainnet",
    bnb: "bnb-mainnet",
    avalanche: "avax-mainnet",
    gnosis: "gnosis-mainnet",
    linea: "linea-mainnet",
    scroll: "scroll-mainnet",
    zksync: "zksync-mainnet",
    blast: "blast-mainnet",
    mantle: "mantle-mainnet",
    celo: "celo-mainnet",
    unichain: "unichain-mainnet",
    soneium: "soneium-mainnet",
  };

  let networks: string[];
  if (chain === "solana") {
    if (options?.networks && !options.networks.includes("solana")) {
      return { address, chain, balances: [], totalValueUsd: 0 };
    }
    networks = ["solana-mainnet"];
  } else {
    if (options?.networks && options.networks.length > 0) {
      const filtered = options.networks
        .map((n) => EVM_NETWORK_MAP[n as keyof typeof EVM_NETWORK_MAP])
        .filter(Boolean);
      if (filtered.length === 0) {
        return { address, chain, balances: [], totalValueUsd: 0 };
      }
      networks = [...new Set(filtered)];
    } else {
      networks = [...ALL_EVM_PORTFOLIO_NETWORKS];
    }
  }

  if (!apiKey) {
    throw new ProviderNotConfigured(
      PROVIDER_NAME,
      "ALCHEMY_API_KEY is missing.",
    );
  }

  try {
    const chunks = chunkNetworks(networks, 5);
    const maxPages = options?.maxPages;
    const settled = await Promise.all(
      chunks.map((group) =>
        maxPages !== undefined
          ? fetchAlchemyChunk(apiKey, address, group, maxPages)
          : fetchAlchemyChunk(apiKey, address, group),
      ),
    );

    const tokens = settled.flatMap((result) => result.tokens);
    const failedNetworks = [...new Set(settled.flatMap((r) => r.failedNetworks))];
    if (tokens.length === 0 && failedNetworks.length > 0) {
      throw unavailable(
        `all networks failed: ${failedNetworks.slice(0, 5).join(", ")}`,
      );
    }
    const balances: TokenBalance[] = [];

    for (const item of tokens) {
      if (!item.tokenBalance) continue;
      // A per-token metadata or pricing failure: skip the row, keep the rest.
      if (item.error) continue;

      // 1. Alchemy spam filter check (always active)
      const isAlchemySpam =
        Boolean(item.isSpam) ||
        Boolean(item.tokenMetadata?.isSpam) ||
        (Array.isArray(item.spamClassifications) &&
          item.spamClassifications.length > 0);
      if (isAlchemySpam) continue;

      let raw: bigint;
      try {
        raw = BigInt(item.tokenBalance);
      } catch {
        continue;
      }
      if (raw <= 0n) continue;

      const networkDefault = NETWORK_DEFAULTS[item.network] ?? {
        symbol: "UNKNOWN",
        name: "Unknown Token",
        decimals: 18,
      };

      const decimals = item.tokenMetadata?.decimals ?? networkDefault.decimals;
      const symbol = item.tokenMetadata?.symbol || networkDefault.symbol;
      const name = item.tokenMetadata?.name || networkDefault.name;

      // 2. URL and phishing pattern check (always active)
      if (isPhishingToken(symbol, name)) {
        continue;
      }

      const usdPriceObj = item.tokenPrices?.find(
        (p) => p.currency.toLowerCase() === "usd",
      );
      const priceUsd = usdPriceObj ? Number.parseFloat(usdPriceObj.value) : undefined;
      const formatted = formatTokenAmount(raw, decimals);
      const numFormatted = Number.parseFloat(formatted);
      const valueUsd =
        priceUsd !== undefined && !Number.isNaN(numFormatted)
          ? Number.parseFloat((numFormatted * priceUsd).toFixed(2))
          : undefined;

      const category = classifyAssetCategory(symbol, valueUsd);

      balances.push({
        chain: chain === "solana" ? "solana" : item.network.replace("-mainnet", ""),
        network: item.network.replace("-mainnet", ""),
        symbol,
        name,
        contractAddress: item.tokenAddress,
        decimals,
        balance: formatted,
        rawBalance: raw.toString(),
        priceUsd,
        valueUsd,
        category,
        logo: item.tokenMetadata?.logo ?? null,
      });
    }

    let finalBalances = balances;
    if (options?.symbol) {
      const sym = options.symbol.toLowerCase();
      finalBalances = finalBalances.filter((b) => b.symbol.toLowerCase() === sym);
    }

    if (options?.category) {
      if (options.category === "stables") {
        finalBalances = finalBalances.filter(
          (b) =>
            b.category === "stables" ||
            b.symbol.toUpperCase().includes("USD") ||
            b.symbol.toUpperCase() === "DAI" ||
            b.symbol.toUpperCase() === "AUSD",
        );
      } else if (options.category === "dust") {
        finalBalances = finalBalances.filter(
          (b) => b.category === "dust" || (b.valueUsd ?? 0) < 1.0,
        );
      } else if (options.category === "native") {
        finalBalances = finalBalances.filter((b) => b.category === "native");
      }
    }

    // Zero-value filter: disabled by default, enabled only if user asked for a specific token (symbol) or explicitly requested zero-value
    const allowZeroValue = Boolean(options?.includeZeroValue || options?.symbol);
    if (!allowZeroValue) {
      finalBalances = finalBalances.filter(
        (b) => b.valueUsd !== undefined && b.valueUsd > 0,
      );
    }

    finalBalances.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

    const totalValueUsd = finalBalances.reduce(
      (sum, b) => sum + (b.valueUsd ?? 0),
      0,
    );

    return {
      address,
      chain,
      balances: finalBalances,
      totalValueUsd: Number.parseFloat(totalValueUsd.toFixed(2)),
    };
  } catch (error) {
    if (
      error instanceof ProviderNotConfigured ||
      error instanceof ProviderUnavailable
    ) {
      throw error;
    }
    throw unavailable(error instanceof Error ? error.message : "unknown failure");
  }
}

/**
 * Port-conformant entry point for the registry (wired in step 05).
 * Normalizes the chain the way the legacy entry point did: Solana
 * spellings read Solana, everything else non-NEAR reads EVM.
 */
export const alchemyBalancesPort: BalancesPort = {
  getBalances(
    chain: string,
    address: string,
    options?: BalanceFilterOptions,
  ): Promise<BalancesResult> {
    const normalizedChain = chain.toLowerCase();
    const alchemyChain =
      normalizedChain === "solana" ||
      normalizedChain === "sol" ||
      normalizedChain === "solana-mainnet"
        ? ("solana" as const)
        : ("evm" as const);
    return fetchAlchemyBalances(address, alchemyChain, options);
  },
};
