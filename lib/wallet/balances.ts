import { getAssets } from "@/lib/intents/service";

export type SupportedNetwork =
  | "arbitrum"
  | "base"
  | "ethereum"
  | "optimism"
  | "polygon"
  | "solana"
  | "near";

export type AssetCategory = "stables" | "native" | "token" | "dust";

export type BalanceFilterOptions = {
  networks?: SupportedNetwork[];
  category?: AssetCategory;
  symbol?: string;
  includeZeroValue?: boolean;
};

export type TokenBalance = {
  chain: string;
  network?: string;
  symbol: string;
  name: string;
  contractAddress: string | null;
  decimals: number;
  balance: string;
  rawBalance: string;
  priceUsd?: number;
  valueUsd?: number;
  logo?: string | null;
  category?: AssetCategory;
};

export type AssetItem = {
  id: string;
  symbol: string;
  name: string;
  amount: string;
  valueUsd: number;
  category: AssetCategory;
  logo?: string | null;
  contractAddress?: string | null;
  chain?: string;
  network?: string;
};

export type AssetGroup = {
  id: string;
  name: string;
  icon: string;
  items: AssetItem[];
};

const NETWORK_CONFIG: Record<string, { name: string; icon: string; order: number }> = {
  arbitrum: { name: "Arbitrum", icon: "arb", order: 1 },
  "arb-mainnet": { name: "Arbitrum", icon: "arb", order: 1 },
  arb: { name: "Arbitrum", icon: "arb", order: 1 },
  base: { name: "Base", icon: "base", order: 2 },
  "base-mainnet": { name: "Base", icon: "base", order: 2 },
  ethereum: { name: "Ethereum", icon: "eth", order: 3 },
  "eth-mainnet": { name: "Ethereum", icon: "eth", order: 3 },
  eth: { name: "Ethereum", icon: "eth", order: 3 },
  optimism: { name: "Optimism", icon: "op", order: 4 },
  "opt-mainnet": { name: "Optimism", icon: "op", order: 4 },
  op: { name: "Optimism", icon: "op", order: 4 },
  polygon: { name: "Polygon", icon: "polygon", order: 5 },
  "polygon-mainnet": { name: "Polygon", icon: "polygon", order: 5 },
  // Alchemy accepts polygon-mainnet on the request and answers with
  // matic-mainnet, so both spellings have to resolve to the same group.
  matic: { name: "Polygon", icon: "polygon", order: 5 },
  "matic-mainnet": { name: "Polygon", icon: "polygon", order: 5 },
  solana: { name: "Solana", icon: "sol", order: 6 },
  "solana-mainnet": { name: "Solana", icon: "sol", order: 6 },
  sol: { name: "Solana", icon: "sol", order: 6 },
  near: { name: "NEAR", icon: "near", order: 7 },
  "near-mainnet": { name: "NEAR", icon: "near", order: 7 },
  intents: { name: "Settlement Ledger", icon: "near", order: 8 },
};

/**
 * Display name for a chain id from any source (catalogue, balances, intent
 * output). Unknown ids fall back to the raw id so they stay readable.
 */
export function networkDisplayName(chain?: string): string {
  if (!chain) return "";
  const norm = chain.toLowerCase();
  return NETWORK_CONFIG[norm]?.name ?? chain;
}

/**
 * Transforms flat TokenBalance items into grouped network buckets.
 */
export function groupBalancesByNetwork(balances: TokenBalance[]): AssetGroup[] {
  const groupMap = new Map<string, AssetItem[]>();

  for (const b of balances) {
    if (isPhishingToken(b.symbol, b.name)) {
      continue;
    }
    const rawNet = (b.network || b.chain || "unknown").toLowerCase();
    const config = NETWORK_CONFIG[rawNet] ?? {
      name: rawNet.charAt(0).toUpperCase() + rawNet.slice(1),
      icon: rawNet,
      order: 99,
    };

    const groupKey = config.name;
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, []);
    }

    const val =
      b.valueUsd ?? (b.priceUsd ? Number.parseFloat(b.balance) * b.priceUsd : 0);

    groupMap.get(groupKey)!.push({
      id: `${rawNet}-${b.symbol}-${b.contractAddress || "native"}`,
      symbol: b.symbol,
      name: b.name,
      amount: b.balance,
      valueUsd: Number.parseFloat(val.toFixed(2)),
      category: b.category ?? classifyAssetCategory(b.symbol, val),
      logo: b.logo,
      contractAddress: b.contractAddress,
      chain: b.chain,
      network: b.network,
    });
  }

  const groups: AssetGroup[] = [];
  for (const [name, items] of groupMap.entries()) {
    const sampleNet = (items[0]?.network || items[0]?.chain || "unknown").toLowerCase();
    const config = NETWORK_CONFIG[sampleNet] ?? {
      name,
      icon: sampleNet,
      order: 99,
    };

    groups.push({
      id: config.icon,
      name,
      icon: config.icon,
      items,
    });
  }

  groups.sort((a, b) => {
    const orderA = NETWORK_CONFIG[a.id]?.order ?? 99;
    const orderB = NETWORK_CONFIG[b.id]?.order ?? 99;
    return orderA - orderB;
  });

  return groups;
}


export type WalletBalancesResult = {
  address: string;
  chain: string;
  balances: TokenBalance[];
  totalValueUsd?: number;
  error?: string;
};

export function formatTokenAmount(rawBigInt: bigint, decimals: number): string {
  const isNegative = rawBigInt < 0n;
  const abs = isNegative ? -rawBigInt : rawBigInt;
  const divisor = 10n ** BigInt(decimals);
  const integerPart = abs / divisor;
  const remainder = abs % divisor;

  if (remainder === 0n) {
    return `${isNegative ? "-" : ""}${integerPart.toString()}`;
  }

  const fraction = remainder
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const truncatedFraction = fraction.slice(0, 6);
  return `${isNegative ? "-" : ""}${integerPart.toString()}.${truncatedFraction}`;
}

const STABLECOIN_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "USDS",
  "SUSDS",
  "DAI",
  "AUSD",
  "USDC.E",
  "USDE",
  "FRAX",
  "BUSD",
  "TUSD",
  "FDUSD",
  "PYUSD",
]);

const NATIVE_SYMBOLS = new Set([
  "ETH",
  "WETH",
  "VWETH",
  "STETH",
  "SOL",
  "WSOL",
  "NEAR",
  "WNEAR",
  "POL",
  "MATIC",
  "BTC",
  "WBTC",
  "TBTC",
  "CBTC",
]);

export function classifyAssetCategory(
  symbol: string,
  valueUsd?: number,
): AssetCategory {
  const sym = symbol.trim().toUpperCase();
  const val = valueUsd ?? 0;

  if (val > 0 && val < 1.0) {
    return "dust";
  }
  if (
    STABLECOIN_SYMBOLS.has(sym) ||
    sym.includes("USDC") ||
    sym.includes("USDT") ||
    sym.includes("USD")
  ) {
    return "stables";
  }
  if (NATIVE_SYMBOLS.has(sym)) {
    return "native";
  }
  return "token";
}

const PHISHING_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "xyz",
  "site",
  "top",
  "vip",
  "app",
  "link",
  "info",
  "online",
  "club",
  "fun",
  "live",
  "cc",
  "pw",
  "ws",
  "me",
  "finance",
  "claims",
  "airdrop",
];

// Matches domain patterns like: foo.com, claim-eth.xyz, visit-usdc.net
// Note: Single-character bridge suffixes like .e (USDC.e) or .near are deliberately not included.
const DOMAIN_REGEX = new RegExp(
  `[a-zA-Z0-9-]+\\.(?:${PHISHING_TLDS.join("|")})(?:[/\\s]|$)`,
  "i",
);

const PHISHING_PHRASES_REGEX =
  /\b(visit\s|claim\s|claim-|claim\.|free\s|redeem\s|winner\s|congrat|airdrop\s*voucher|reward\s*token|voucher:)\b/i;

const URL_PROTOCOL_REGEX = /(https?:\/\/|www\.|\bt\.me\/)/i;

/**
 * Detects whether a token ticker or name is a phishing / scam lure.
 * Always active across all chains, networks, and queries.
 */
export function isPhishingToken(
  symbol?: string | null,
  name?: string | null,
): boolean {
  const s = (symbol || "").trim();
  const n = (name || "").trim();
  const combined = `${s} ${n}`.trim();

  if (!combined) return false;

  // 1. Explicit web URL protocols or telegram channels
  if (URL_PROTOCOL_REGEX.test(combined)) return true;

  // 2. Domain pattern in symbol or name (e.g., CLAIM-ETH.COM or airdrop.xyz)
  if (DOMAIN_REGEX.test(s) || DOMAIN_REGEX.test(n)) return true;

  // 3. Phishing action phrases
  if (PHISHING_PHRASES_REGEX.test(combined)) return true;

  return false;
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
  "solana-mainnet": { symbol: "SOL", name: "Solana", decimals: 9 },
};

type AlchemyTokenItem = {
  network: string;
  address: string;
  tokenAddress: string | null;
  tokenBalance: string;
  isSpam?: boolean;
  spamClassifications?: string[];
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
    code?: number;
  };
};

/**
 * Fetches token balances for EVM and Solana addresses via Alchemy's Portfolio API.
 */
async function fetchAlchemyBalances(
  address: string,
  chain: "evm" | "solana",
  options?: BalanceFilterOptions,
): Promise<WalletBalancesResult> {
  const EVM_NETWORK_MAP: Record<string, string> = {
    arbitrum: "arb-mainnet",
    base: "base-mainnet",
    ethereum: "eth-mainnet",
    optimism: "opt-mainnet",
    polygon: "polygon-mainnet",
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
      networks = filtered;
    } else {
      networks = ["eth-mainnet", "base-mainnet", "arb-mainnet"];
    }
  }

  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    return {
      address,
      chain,
      balances: [],
      totalValueUsd: 0,
      error:
        "ALCHEMY_API_KEY is not configured in .env.local. Add it to enable multi-chain balance queries.",
    };
  }

  try {
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
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        address,
        chain,
        balances: [],
        error: `Alchemy balance lookup failed with status ${res.status}: ${errText.slice(0, 120)}`,
      };
    }

    const json = (await res.json()) as AlchemyPortfolioResponse;
    if (json.error?.message) {
      return {
        address,
        chain,
        balances: [],
        error: `Alchemy error: ${json.error.message}`,
      };
    }

    const tokens = json.data?.tokens ?? [];
    const balances: TokenBalance[] = [];

    for (const item of tokens) {
      if (!item.tokenBalance) continue;

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
    return {
      address,
      chain,
      balances: [],
      error: error instanceof Error ? error.message : "Network error calling Alchemy",
    };
  }
}

const NEAR_TOKENS = [
  {
    contract: "wrap.near",
    symbol: "wNEAR",
    name: "Wrapped NEAR",
    decimals: 24,
  },
  {
    contract:
      "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    symbol: "USDC",
    name: "USD Coin (Intents)",
    decimals: 6,
  },
  {
    contract:
      "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
    symbol: "USDC.e",
    name: "USD Coin (Rainbow)",
    decimals: 6,
  },
  {
    contract: "usdt.tether-token.near",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
  },
];

/**
 * Fetches token balances for NEAR accounts using FastNEAR RPC.
 */
async function fetchNearBalances(
  address: string,
  options?: BalanceFilterOptions,
): Promise<WalletBalancesResult> {
  if (options?.networks && !options.networks.includes("near")) {
    return {
      address,
      chain: "near",
      balances: [],
      totalValueUsd: 0,
    };
  }

  const rpc =
    process.env.NEXT_PUBLIC_NEAR_RPC_PRIMARY || "https://free.rpc.fastnear.com";

  const balances: TokenBalance[] = [];
  let catalogue: Awaited<ReturnType<typeof getAssets>> = [];
  try {
    catalogue = await getAssets();
  } catch {
    catalogue = [];
  }

  const findCataloguePrice = (symbol: string, contractAddress?: string) => {
    const match = catalogue.find(
      (a) =>
        a.chain === "near" &&
        (contractAddress ? a.contractAddress === contractAddress : true) &&
        a.symbol.toLowerCase() === symbol.toLowerCase(),
    );
    return match?.price;
  };

  try {
    // 1. Native NEAR balance
    const nativeRes = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "view-account",
        method: "query",
        params: {
          request_type: "view_account",
          finality: "final",
          account_id: address,
        },
      }),
    });

    if (nativeRes.ok) {
      const nativeJson = (await nativeRes.json()) as {
        result?: { amount?: string };
      };
      if (nativeJson.result?.amount) {
        const raw = BigInt(nativeJson.result.amount);
        if (raw > 0n) {
          const formatted = formatTokenAmount(raw, 24);
          const price = findCataloguePrice("NEAR") ?? findCataloguePrice("wNEAR");
          const numFormatted = Number.parseFloat(formatted);
          const val =
            price !== undefined && !Number.isNaN(numFormatted)
              ? Number.parseFloat((numFormatted * price).toFixed(2))
              : undefined;

          balances.push({
            chain: "near",
            network: "near",
            symbol: "NEAR",
            name: "NEAR",
            contractAddress: null,
            decimals: 24,
            balance: formatted,
            rawBalance: raw.toString(),
            priceUsd: price,
            valueUsd: val,
            category: "native",
          });
        }
      }
    }

    // 2. NEP-141 token balances
    await Promise.all(
      NEAR_TOKENS.map(async (token) => {
        try {
          const tokenRes = await fetch(rpc, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: `view-nep141-${token.symbol}`,
              method: "query",
              params: {
                request_type: "call_function",
                finality: "final",
                account_id: token.contract,
                method_name: "ft_balance_of",
                args_base64: Buffer.from(
                  JSON.stringify({ account_id: address }),
                ).toString("base64"),
              },
            }),
          });

          if (!tokenRes.ok) return;
          const tokenJson = (await tokenRes.json()) as {
            result?: { result?: number[] };
          };
          if (!tokenJson.result?.result) return;

          const rawStr = Buffer.from(tokenJson.result.result)
            .toString("utf8")
            .replace(/^"|"$/g, "");
          const raw = BigInt(rawStr || "0");
          if (raw <= 0n) return;
          if (isPhishingToken(token.symbol, token.name)) return;

          const formatted = formatTokenAmount(raw, token.decimals);
          const price = findCataloguePrice(token.symbol, token.contract);
          const numFormatted = Number.parseFloat(formatted);
          const val =
            price !== undefined && !Number.isNaN(numFormatted)
              ? Number.parseFloat((numFormatted * price).toFixed(2))
              : undefined;

          const category = classifyAssetCategory(token.symbol, val);

          balances.push({
            chain: "near",
            network: "near",
            symbol: token.symbol,
            name: token.name,
            contractAddress: token.contract,
            decimals: token.decimals,
            balance: formatted,
            rawBalance: raw.toString(),
            priceUsd: price,
            valueUsd: val,
            category,
          });
        } catch {
          // Individual contract error does not abort the entire balance list
        }
      }),
    );

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
      chain: "near",
      balances: finalBalances,
      totalValueUsd: Number.parseFloat(totalValueUsd.toFixed(2)),
    };
  } catch (error) {
    return {
      address,
      chain: "near",
      balances: [],
      error: error instanceof Error ? error.message : "Failed to query NEAR RPC",
    };
  }
}

/**
 * Primary balance entry point. Automatically routes to Alchemy (EVM/Solana) or FastNEAR.
 */
export async function getConnectedWalletBalances(
  chain: string,
  address: string,
  options?: BalanceFilterOptions,
): Promise<WalletBalancesResult> {
  const normalizedChain = chain.toLowerCase();
  if (normalizedChain === "near" || normalizedChain === "near-mainnet") {
    return fetchNearBalances(address, options);
  }
  if (
    normalizedChain === "solana" ||
    normalizedChain === "sol" ||
    normalizedChain === "solana-mainnet"
  ) {
    return fetchAlchemyBalances(address, "solana", options);
  }
  return fetchAlchemyBalances(address, "evm", options);
}
