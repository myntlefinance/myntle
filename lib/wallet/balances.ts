import { getAssets } from "@/lib/intents/service";

export type SupportedNetwork =
  | "arbitrum"
  | "base"
  | "ethereum"
  | "optimism"
  | "polygon"
  | "bnb"
  | "avalanche"
  | "gnosis"
  | "linea"
  | "scroll"
  | "zksync"
  | "blast"
  | "mantle"
  | "celo"
  | "unichain"
  | "soneium"
  | "solana"
  | "near";

export type AssetCategory = "stables" | "native" | "token" | "dust";

export type BalanceFilterOptions = {
  networks?: SupportedNetwork[];
  category?: AssetCategory;
  symbol?: string;
  includeZeroValue?: boolean;
  maxPages?: number;
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
  /** The catalogue's asset id, when a row could be matched. */
  assetId?: string;
  /** Whole-unit quantity, from the formatted balance or the raw amount. */
  quantity?: number;
  /** When the catalogue observed the unit price, in milliseconds. */
  priceAsOf?: number;
};

export type AssetItem = {
  id: string;
  symbol: string;
  name: string;
  amount: string;
  valueUsd: number;
  priceUsd?: number;
  category: AssetCategory;
  logo?: string | null;
  contractAddress?: string | null;
  chain?: string;
  network?: string;
  /** The catalogue's asset id, so the live store can price this row. */
  assetId?: string;
  /** Whole-unit quantity, used for an exact live value. */
  quantity?: number;
  /** When the catalogue observed the stored unit price, in milliseconds. */
  priceAsOf?: number;
};

export type AssetGroup = {
  id: string;
  name: string;
  icon: string;
  items: AssetItem[];
};

/** The super account's public group, named for the rail that settles it. */
export const INTENTS_GROUP_NAME = "Near Intents";
/** Snapshots cached before the rename still carry this name. */
const LEGACY_INTENTS_GROUP_NAME = "Settlement Ledger";

export function isIntentsGroupName(name: string): boolean {
  return (
    name === INTENTS_GROUP_NAME || name === LEGACY_INTENTS_GROUP_NAME
  );
}

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
  // Alchemy answers "opt-mainnet"; the adapter strips the suffix, so the
  // bare slug has to resolve too, like every other stripped network.
  opt: { name: "Optimism", icon: "op", order: 4 },
  op: { name: "Optimism", icon: "op", order: 4 },
  polygon: { name: "Polygon", icon: "polygon", order: 5 },
  "polygon-mainnet": { name: "Polygon", icon: "polygon", order: 5 },
  // Alchemy accepts polygon-mainnet on the request and answers with
  // matic-mainnet, so both spellings have to resolve to the same group.
  matic: { name: "Polygon", icon: "polygon", order: 5 },
  "matic-mainnet": { name: "Polygon", icon: "polygon", order: 5 },
  bnb: { name: "BNB Chain", icon: "bnb", order: 10 },
  "bnb-mainnet": { name: "BNB Chain", icon: "bnb", order: 10 },
  avalanche: { name: "Avalanche", icon: "avax", order: 11 },
  "avax-mainnet": { name: "Avalanche", icon: "avax", order: 11 },
  avax: { name: "Avalanche", icon: "avax", order: 11 },
  gnosis: { name: "Gnosis", icon: "gnosis", order: 12 },
  "gnosis-mainnet": { name: "Gnosis", icon: "gnosis", order: 12 },
  linea: { name: "Linea", icon: "linea", order: 13 },
  "linea-mainnet": { name: "Linea", icon: "linea", order: 13 },
  scroll: { name: "Scroll", icon: "scroll", order: 14 },
  "scroll-mainnet": { name: "Scroll", icon: "scroll", order: 14 },
  zksync: { name: "ZKsync", icon: "zksync", order: 15 },
  "zksync-mainnet": { name: "ZKsync", icon: "zksync", order: 15 },
  blast: { name: "Blast", icon: "blast", order: 16 },
  "blast-mainnet": { name: "Blast", icon: "blast", order: 16 },
  mantle: { name: "Mantle", icon: "mantle", order: 17 },
  "mantle-mainnet": { name: "Mantle", icon: "mantle", order: 17 },
  celo: { name: "Celo", icon: "celo", order: 18 },
  "celo-mainnet": { name: "Celo", icon: "celo", order: 18 },
  unichain: { name: "Unichain", icon: "unichain", order: 19 },
  "unichain-mainnet": { name: "Unichain", icon: "unichain", order: 19 },
  soneium: { name: "Soneium", icon: "soneium", order: 20 },
  "soneium-mainnet": { name: "Soneium", icon: "soneium", order: 20 },
  solana: { name: "Solana", icon: "sol", order: 6 },
  "solana-mainnet": { name: "Solana", icon: "sol", order: 6 },
  sol: { name: "Solana", icon: "sol", order: 6 },
  near: { name: "NEAR", icon: "near", order: 7 },
  "near-mainnet": { name: "NEAR", icon: "near", order: 7 },
  intents: { name: INTENTS_GROUP_NAME, icon: "near", order: 8 },
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
      priceUsd: b.priceUsd,
      category: b.category ?? classifyAssetCategory(b.symbol, val),
      logo: b.logo,
      contractAddress: b.contractAddress,
      chain: b.chain,
      network: b.network,
      ...(b.assetId ? { assetId: b.assetId } : {}),
      ...(typeof b.quantity === "number" && Number.isFinite(b.quantity)
        ? { quantity: b.quantity }
        : {}),
      ...(typeof b.priceAsOf === "number" ? { priceAsOf: b.priceAsOf } : {}),
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
 * Every spelling a wallet network can use for the catalogue's chain id.
 *
 * Alchemy answers stripped slugs (`eth`, `arb`, `opt`, `solana`, `matic`),
 * while a caller may pass the long name. `near` maps to itself because the
 * settlement ledger stores its rows under the NEAR chain.
 */
const CATALOGUE_CHAIN_ALIASES: Record<string, string> = {
  ethereum: "eth",
  arbitrum: "arb",
  optimism: "op",
  opt: "op",
  solana: "sol",
  near: "near",
  matic: "pol",
  polygon: "pol",
  bnb: "bsc",
  avalanche: "avax",
};

/** A wallet network, normalized to the catalogue's chain spelling. */
export function catalogueChain(chain?: string | null): string {
  const key = (chain ?? "").trim().toLowerCase();
  const stripped = key.endsWith("-mainnet")
    ? key.slice(0, -"-mainnet".length)
    : key;
  return CATALOGUE_CHAIN_ALIASES[stripped] ?? stripped;
}

/** Whole units from the raw amount when possible, then the display string. */
export function quantityFromBalance(balance: TokenBalance): number | undefined {
  // The raw integer is the exact figure; the display string is truncated to
  // six decimals for readability, so it is only the fallback.
  if (
    balance.rawBalance &&
    Number.isInteger(balance.decimals) &&
    balance.decimals >= 0
  ) {
    try {
      const raw = BigInt(balance.rawBalance);
      const divisor = 10n ** BigInt(balance.decimals);
      const whole = raw / divisor;
      const fraction = raw % divisor;
      // Whole and fractional parts are divided separately so a clean amount
      // such as 10 NEAR comes back as 10, not 10.000000000000002.
      const value = Number(whole) + Number(fraction) / 10 ** balance.decimals;
      if (Number.isFinite(value)) return value;
    } catch {
      // Fall through to the display string.
    }
  }

  const formatted = Number.parseFloat(balance.balance.replace(/,/g, ""));
  return Number.isFinite(formatted) ? formatted : undefined;
}

/**
 * Adds the catalogue's identity to each balance: the asset id by contract
 * first, then by symbol plus chain, and the quantity the row represents.
 *
 * The unit price is deliberately not rewritten here. A tool that wants the
 * live feed prices the rows itself; a page keeps the price the provider or
 * the catalogue already settled, and the browser overlay refreshes it.
 */
async function enrichBalancesWithCatalogue(
  balances: TokenBalance[],
): Promise<TokenBalance[]> {
  if (balances.length === 0) return balances;

  let catalogue: Awaited<ReturnType<typeof getAssets>>;
  try {
    catalogue = await getAssets();
  } catch {
    return balances;
  }
  if (catalogue.length === 0) return balances;

  const byContractChain = new Map<string, (typeof catalogue)[number]>();
  const byContract = new Map<string, (typeof catalogue)[number] | null>();
  const bySymbolChain = new Map<string, (typeof catalogue)[number]>();
  for (const asset of catalogue) {
    const chain = catalogueChain(asset.chain);
    const contract = asset.contractAddress?.trim().toLowerCase();
    if (contract) {
      const chainKey = `${contract}|${chain}`;
      if (!byContractChain.has(chainKey)) {
        byContractChain.set(chainKey, asset);
      }
      // A contract can exist on more than one chain (Base and Optimism share
      // the WETH predeploy). A bare contract match is only safe when it is
      // unique; an ambiguous one defers to the chain-aware key.
      byContract.set(contract, byContract.has(contract) ? null : asset);
    } else {
      // A contract-less catalogue row is a native token. This map is only
      // consulted for a native balance; a contract-bearing balance with the
      // same ticker is a different token and must never borrow its price.
      const key = `${asset.symbol.toLowerCase()}|${chain}`;
      if (!bySymbolChain.has(key)) bySymbolChain.set(key, asset);
    }
    // 1Click calls native NEAR wNEAR; the NEAR RPC balks its native token
    // "NEAR". Mirror fetchNearBalances' price alias so the native row gets
    // the wrapped asset's id and observation time. The catalogue row carries
    // a contract, so this alias lives outside the contract-less branch.
    if (chain === "near" && asset.symbol.toLowerCase() === "wnear") {
      const nearKey = "near|near";
      if (!bySymbolChain.has(nearKey)) bySymbolChain.set(nearKey, asset);
    }
  }

  return balances.map((balance) => {
    const contract = balance.contractAddress?.trim().toLowerCase() ?? "";
    const chain = catalogueChain(balance.network || balance.chain);
    const chainKnown = chain.length > 0 && chain !== "evm";
    const symbolChain = `${balance.symbol.toLowerCase()}|${chain}`;
    // Prefer a contract that lives on the balance's own chain. A bare
    // contract match is only safe when the chain is unknown, because Base
    // and Optimism share the WETH predeploy and other addresses may collide.
    const asset = contract
      ? (byContractChain.get(`${contract}|${chain}`) ??
        (chainKnown ? undefined : byContract.get(contract)) ??
        undefined)
      : bySymbolChain.get(symbolChain);
    const assetId = balance.assetId ?? asset?.assetId;
    const quantity = quantityFromBalance(balance);

    return {
      ...balance,
      ...(assetId ? { assetId } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(asset?.priceUpdatedAt !== undefined
        ? { priceAsOf: asset.priceUpdatedAt }
        : {}),
    };
  });
}

/**
 * Primary balance entry point. NEAR reads run inline above; every other
 * chain is served by the registry-selected balances adapter behind the
 * port facade. The taxonomy the adapter throws is mapped back to the
 * legacy string channel here, so existing callers keep their shape
 * (route + AI tool unchanged).
 *
 * The registry is imported lazily because this module also ships pure
 * helpers to client components, and the registry is server-side only
 * (it throws on `window`). A static import would join the server-only
 * graph — keys, SDKs, endpoint URLs — to every client bundle that
 * formats a balance.
 */
export async function getConnectedWalletBalances(
  chain: string,
  address: string,
  options?: BalanceFilterOptions,
): Promise<WalletBalancesResult> {
  const normalizedChain = chain.toLowerCase();
  if (normalizedChain === "near" || normalizedChain === "near-mainnet") {
    const result = await fetchNearBalances(address, options);
    return {
      ...result,
      balances: await enrichBalancesWithCatalogue(result.balances),
    };
  }
  const legacyChain =
    normalizedChain === "solana" ||
    normalizedChain === "sol" ||
    normalizedChain === "solana-mainnet"
      ? "solana"
      : "evm";
  try {
    const { getBalancesPort } = await import("@/lib/adapters/registry");
    const res = await getBalancesPort().getBalances(chain, address, options);
    return {
      address: res.address,
      chain: legacyChain,
      balances: await enrichBalancesWithCatalogue(res.balances),
      totalValueUsd: res.totalValueUsd,
    };
  } catch (error) {
    console.error(
      `[wallet-balances] non-NEAR read failed: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
    return {
      address,
      chain: legacyChain,
      balances: [],
      error: "Balance lookup is unavailable. Try again shortly.",
    };
  }
}
