import {
  INTENTS_GROUP_NAME,
  groupBalancesByNetwork,
  isIntentsGroupName,
  type AssetGroup,
  type TokenBalance,
} from "@/lib/wallet/balances";
import { accountScope } from "@/lib/auth/session-identity";
import type { PasskeyPortfolioRead } from "./passkeyPortfolioData";
import { AuthExpiredError } from "./apiErrors";
import { clearHistoryCache } from "./historyCache";

/* ─────────────────────────────────────────────────────────
 * PORTFOLIO CACHE
 * The wallet balances and settlement ledger the Portfolio page
 * reads, held in module memory with a sessionStorage copy. The
 * page paints the last snapshot at once and revalidates behind
 * it, so switching to Portfolio never blocks on the network.
 * ───────────────────────────────────────────────────────── */

export type PortfolioSnapshot = {
  groups: AssetGroup[];
  totalUsd: number;
  /** Split for the tabbed portfolio. Older caches only have groups/totalUsd. */
  walletGroups?: AssetGroup[];
  superGroups?: AssetGroup[];
  walletUsd?: number;
  superUsd?: number;
};

/** One account's shape, for the skeleton before the first read lands. */
export const SAMPLE_PORTFOLIO: PortfolioSnapshot = {
  groups: [
    {
      id: "base",
      name: "Base",
      icon: "base",
      items: [
        {
          id: "sample-base-usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "1,250.00",
          valueUsd: 1250,
          priceUsd: 1,
          category: "stables",
          chain: "base",
          network: "base",
        },
        {
          id: "sample-base-eth",
          symbol: "ETH",
          name: "Ether",
          amount: "0.8420",
          valueUsd: 2734.18,
          priceUsd: 3247.24,
          category: "native",
          chain: "base",
          network: "base",
        },
        {
          id: "sample-base-degen",
          symbol: "DEGEN",
          name: "Degen",
          amount: "12,400",
          valueUsd: 86.4,
          category: "token",
          chain: "base",
          network: "base",
        },
      ],
    },
    {
      id: "sol",
      name: "Solana",
      icon: "sol",
      items: [
        {
          id: "sample-sol-sol",
          symbol: "SOL",
          name: "Solana",
          amount: "12.50",
          valueUsd: 1121.5,
          priceUsd: 89.72,
          category: "native",
          chain: "solana",
          network: "solana",
        },
        {
          id: "sample-sol-bonk",
          symbol: "BONK",
          name: "Bonk",
          amount: "1,200,000",
          valueUsd: 14.4,
          category: "token",
          chain: "solana",
          network: "solana",
        },
      ],
    },
    {
      id: "settlement",
      name: INTENTS_GROUP_NAME,
      icon: "near",
      items: [
        {
          id: "sample-intents-usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "320.50",
          valueUsd: 320.5,
          priceUsd: 1,
          category: "stables",
          chain: "near",
          network: "intents",
        },
        {
          id: "sample-intents-usdt",
          symbol: "USDT",
          name: "Tether USD",
          amount: "150.00",
          valueUsd: 150,
          priceUsd: 1,
          category: "stables",
          chain: "near",
          network: "intents",
        },
        {
          id: "sample-intents-near",
          symbol: "NEAR",
          name: "NEAR",
          amount: "85.20",
          valueUsd: 264.12,
          priceUsd: 3.1,
          category: "native",
          chain: "near",
          network: "intents",
        },
        {
          id: "sample-intents-eth",
          symbol: "ETH",
          name: "Ether",
          amount: "0.05",
          valueUsd: 162.36,
          priceUsd: 3247.24,
          category: "native",
          chain: "near",
          network: "intents",
        },
      ],
    },
  ],
  totalUsd: 6103.46,
  walletGroups: [
    {
      id: "base",
      name: "Base",
      icon: "base",
      items: [
        {
          id: "sample-base-usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "1,250.00",
          valueUsd: 1250,
          priceUsd: 1,
          category: "stables",
          chain: "base",
          network: "base",
        },
        {
          id: "sample-base-eth",
          symbol: "ETH",
          name: "Ether",
          amount: "0.8420",
          valueUsd: 2734.18,
          priceUsd: 3247.24,
          category: "native",
          chain: "base",
          network: "base",
        },
        {
          id: "sample-base-degen",
          symbol: "DEGEN",
          name: "Degen",
          amount: "12,400",
          valueUsd: 86.4,
          category: "token",
          chain: "base",
          network: "base",
        },
      ],
    },
    {
      id: "sol",
      name: "Solana",
      icon: "sol",
      items: [
        {
          id: "sample-sol-sol",
          symbol: "SOL",
          name: "Solana",
          amount: "12.50",
          valueUsd: 1121.5,
          priceUsd: 89.72,
          category: "native",
          chain: "solana",
          network: "solana",
        },
        {
          id: "sample-sol-bonk",
          symbol: "BONK",
          name: "Bonk",
          amount: "1,200,000",
          valueUsd: 14.4,
          category: "token",
          chain: "solana",
          network: "solana",
        },
      ],
    },
  ],
  superGroups: [
    {
      id: "settlement",
      name: INTENTS_GROUP_NAME,
      icon: "near",
      items: [
        {
          id: "sample-intents-usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "320.50",
          valueUsd: 320.5,
          priceUsd: 1,
          category: "stables",
          chain: "near",
          network: "intents",
        },
        {
          id: "sample-intents-usdt",
          symbol: "USDT",
          name: "Tether USD",
          amount: "150.00",
          valueUsd: 150,
          priceUsd: 1,
          category: "stables",
          chain: "near",
          network: "intents",
        },
        {
          id: "sample-intents-near",
          symbol: "NEAR",
          name: "NEAR",
          amount: "85.20",
          valueUsd: 264.12,
          priceUsd: 3.1,
          category: "native",
          chain: "near",
          network: "intents",
        },
        {
          id: "sample-intents-eth",
          symbol: "ETH",
          name: "Ether",
          amount: "0.05",
          valueUsd: 162.36,
          priceUsd: 3247.24,
          category: "native",
          chain: "near",
          network: "intents",
        },
      ],
    },
  ],
  walletUsd: 5206.48,
  superUsd: 896.98,
};

type LedgerItem = {
  assetId: string;
  symbol: string;
  decimals: number;
  balance: string;
  rawBalance: string;
  priceUsd?: number;
  valueUsd?: number;
  quantity?: number;
  priceAsOf?: number;
};

type BalancesReply = {
  wallet?: { balances?: TokenBalance[]; totalValueUsd?: number };
  intentsLedger?: { balances?: LedgerItem[]; totalValueUsd?: number };
};

const STORAGE_PREFIX = "myntle-portfolio-v1";

const memory = new Map<string, PortfolioSnapshot>();

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}:${scope}`;
}

function validSnapshot(value: unknown): value is PortfolioSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PortfolioSnapshot;
  return (
    Array.isArray(candidate.groups) &&
    Number.isFinite(candidate.totalUsd) &&
    candidate.groups.every(
      (group) =>
        group &&
        typeof group === "object" &&
        Array.isArray(group.items),
    )
  );
}

/* A cached snapshot from before the rename still carries the old group
 * name; migrate it on read so the filter and the table never show it. */
function renameIntentsGroup(group: AssetGroup): AssetGroup {
  if (group.name !== "Settlement Ledger") return group;
  return { ...group, name: INTENTS_GROUP_NAME };
}

function normalizeSnapshot(snapshot: PortfolioSnapshot): PortfolioSnapshot {
  const groups = snapshot.groups.map(renameIntentsGroup);
  const walletGroups = snapshot.walletGroups?.map(renameIntentsGroup);
  const superGroups = snapshot.superGroups?.map(renameIntentsGroup);
  if (
    Array.isArray(walletGroups) &&
    Array.isArray(superGroups) &&
    Number.isFinite(snapshot.walletUsd) &&
    Number.isFinite(snapshot.superUsd)
  ) {
    return { ...snapshot, groups, walletGroups, superGroups };
  }
  const splitSuperGroups = groups.filter((group) =>
    isIntentsGroupName(group.name),
  );
  const splitWalletGroups = groups.filter(
    (group) => !isIntentsGroupName(group.name),
  );
  const sum = (list: typeof groups) =>
    list.reduce(
      (total, group) =>
        total + group.items.reduce((sub, item) => sub + item.valueUsd, 0),
      0,
    );
  return {
    ...snapshot,
    groups,
    walletGroups: splitWalletGroups,
    superGroups: splitSuperGroups,
    walletUsd: Number.parseFloat(sum(splitWalletGroups).toFixed(2)),
    superUsd: Number.parseFloat(sum(splitSuperGroups).toFixed(2)),
  };
}

/**
 * The key is chain plus address: the same wallet on two chains is two
 * accounts. EVM addresses compare case-insensitively because wallets
 * return them checksummed while the session stores them lowercase.
 */
export function portfolioScope(chain: string, address: string): string {
  return accountScope(chain, address);
}

export function readPortfolioCache(
  scope: string,
): PortfolioSnapshot | undefined {
  const mem = memory.get(scope);
  if (mem) return normalizeSnapshot(mem);
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(storageKey(scope));
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (validSnapshot(parsed)) {
          const normalized = normalizeSnapshot(parsed);
          memory.set(scope, normalized);
          return normalized;
        }
      }
    }
  } catch {
    // Quota, private mode, or malformed storage. Fall through.
  }
  return undefined;
}

export function writePortfolioCache(
  scope: string,
  snapshot: PortfolioSnapshot,
) {
  memory.set(scope, snapshot);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(storageKey(scope), JSON.stringify(snapshot));
    }
  } catch {
    // Private mode. Memory still covers the session.
  }
}

export function clearPortfolioCache() {
  memory.clear();
  rowCountMemory.clear();
  try {
    if (typeof sessionStorage !== "undefined") {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (
          key?.startsWith(`${STORAGE_PREFIX}:`) ||
          key?.startsWith(`${ROW_COUNT_PREFIX}:`)
        ) {
          sessionStorage.removeItem(key);
        }
      }
    }
  } catch {
    // Ignore.
  }
}

/* ─────────────────────────────────────────────────────────
 * ROW-COUNT HINT
 * Skullet remembers a content shape under its id, but a portfolio
 * holding row carries an inline token SVG; a few rows push the saved
 * shape past skullet's 20k cap, so the exact shape is never replayed.
 * The row count is the part that moves the page, it is tiny, and it
 * survives a reload in sessionStorage. The sample builder below pads
 * or trims the sample groups to that count, so a returning visit's
 * skeleton is the same height as the table it is about to reveal.
 * ───────────────────────────────────────────────────────── */

const ROW_COUNT_PREFIX = "myntle-portfolio-rows-v1";

const rowCountMemory = new Map<string, number>();

function rowCountKey(scope: string, tab: "wallet" | "super" | "watched") {
  return `${ROW_COUNT_PREFIX}:${tab}:${scope}`;
}

export function readPortfolioRowCount(
  scope: string | null,
  tab: "wallet" | "super" | "watched",
): number | null {
  if (!scope) return null;
  const key = rowCountKey(scope, tab);
  const cached = rowCountMemory.get(key);
  if (cached !== undefined) return cached;
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) {
        const count = Number.parseInt(raw, 10);
        if (Number.isFinite(count) && count >= 0) {
          rowCountMemory.set(key, count);
          return count;
        }
      }
    }
  } catch {
    // Private mode. Memory still covers the session.
  }
  return null;
}

export function writePortfolioRowCount(
  scope: string | null,
  tab: "wallet" | "super" | "watched",
  count: number,
): void {
  if (!scope || !Number.isFinite(count) || count < 0) return;
  const key = rowCountKey(scope, tab);
  rowCountMemory.set(key, count);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(key, String(count));
    }
  } catch {
    // Private mode. Memory still covers the session.
  }
}

/** Counts every holding row across the groups. */
export function countGroupRows(groups: AssetGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

/**
 * Pads or trims the sample groups to the remembered row count.
 *
 * The items are copied and given synthetic ids so React and the table
 * treat them as distinct rows. Cycling through the sample items keeps
 * the allocation bar's proportions, which is all the skeleton shows.
 */
export function sampleGroupsWithRows(
  groups: AssetGroup[],
  rows: number | null,
): AssetGroup[] {
  if (rows === null) return groups;
  const flat = groups.flatMap((group) =>
    group.items.map((item) => ({ groupId: group.id, item })),
  );
  if (flat.length === 0) return groups;

  const next = groups.map((group) => ({ ...group, items: [] as typeof group.items }));
  const byId = new Map(next.map((group) => [group.id, group]));
  for (let index = 0; index < rows; index += 1) {
    const source = flat[index % flat.length];
    const target = byId.get(source.groupId);
    if (!target) continue;
    target.items.push({
      ...source.item,
      id: `${source.item.id}-sample-${index}`,
    });
  }
  return next.filter((group) => group.items.length > 0);
}

/** Fetches both sides of the portfolio and groups them for display. */
export async function fetchPortfolio(
  address: string,
  chain: string,
  opts?: { mode?: "fast" | "full"; networks?: string; refresh?: boolean },
): Promise<PortfolioSnapshot> {
  const params = new URLSearchParams({
    address,
    chain,
    mode: opts?.mode ?? "full",
  });
  if (opts?.networks) params.set("networks", opts.networks);
  if (opts?.refresh) params.set("refresh", "1");
  const res = await fetch(`/api/wallet/balances?${params.toString()}`, {
    cache: "no-store",
  });
  if (res.status === 401) throw new AuthExpiredError();
  if (!res.ok) throw new Error("Balances are unavailable.");

  const body = (await res.json()) as BalancesReply | null;
  const ledger: TokenBalance[] = (body?.intentsLedger?.balances ?? []).map(
    (balance) => ({
      chain: "near",
      network: "intents",
      symbol: balance.symbol,
      name: balance.symbol,
      contractAddress: balance.assetId,
      decimals: balance.decimals,
      balance: balance.balance,
      rawBalance: balance.rawBalance,
      priceUsd: balance.priceUsd,
      valueUsd: balance.valueUsd,
      ...(balance.assetId ? { assetId: balance.assetId } : {}),
      ...(balance.quantity !== undefined
        ? { quantity: balance.quantity }
        : {}),
      ...(balance.priceAsOf !== undefined
        ? { priceAsOf: balance.priceAsOf }
        : {}),
    }),
  );
  const walletBalances = body?.wallet?.balances ?? [];
  const walletUsd = body?.wallet?.totalValueUsd ?? 0;
  const superUsd = body?.intentsLedger?.totalValueUsd ?? 0;
  const total = walletUsd + superUsd;
  const walletGroups = groupBalancesByNetwork(walletBalances);
  const superGroups = groupBalancesByNetwork(ledger);
  const all = [...walletBalances, ...ledger];
  return {
    groups: groupBalancesByNetwork(all),
    totalUsd: Number.parseFloat(total.toFixed(2)),
    walletGroups,
    superGroups,
    walletUsd: Number.parseFloat(walletUsd.toFixed(2)),
    superUsd: Number.parseFloat(superUsd.toFixed(2)),
  };
}

/**
 * The full EVM read in progressive chunks. Mirrors
 * ALL_EVM_PORTFOLIO_NETWORKS in `lib/adapters/alchemy/balances.ts`
 * (16 slugs in chunks of 5), translated to the SupportedNetwork names
 * the balances route accepts. Hardcoded here so this client module
 * never imports the server balance reader.
 */
export const FULL_NETWORK_GROUPS: string[] = [
  "ethereum,base,arbitrum,optimism,polygon",
  "bnb,avalanche,gnosis,linea,scroll",
  "zksync,blast,mantle,celo,unichain",
  "soneium",
];

function mergeGroupLists(lists: AssetGroup[][]): AssetGroup[] {
  const merged = new Map<string, AssetGroup>();
  for (const list of lists) {
    for (const group of list ?? []) {
      const existing = merged.get(group.name);
      if (!existing) {
        merged.set(group.name, { ...group, items: [...group.items] });
      } else {
        existing.items.push(...group.items);
      }
    }
  }
  for (const group of merged.values()) {
    group.items.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  }
  return [...merged.values()];
}

/**
 * Merges one snapshot per network group into a single portfolio. Wallet
 * groups concatenate per network name; the settlement ledger is identical
 * in every group response, so the ledger (groups, totals) is taken from
 * the part with the largest superUsd instead of being summed.
 */
export function mergePortfolioSnapshots(
  parts: PortfolioSnapshot[],
): PortfolioSnapshot {
  if (parts.length === 0) {
    return {
      groups: [],
      totalUsd: 0,
      walletGroups: [],
      superGroups: [],
      walletUsd: 0,
      superUsd: 0,
    };
  }
  if (parts.length === 1) return parts[0];
  let richest = parts[0];
  for (const part of parts) {
    if ((part.superUsd ?? 0) > (richest.superUsd ?? 0)) richest = part;
  }
  const superUsd = Number.parseFloat((richest.superUsd ?? 0).toFixed(2));
  const walletUsd = Number.parseFloat(
    parts.reduce((sum, part) => sum + (part.walletUsd ?? 0), 0).toFixed(2),
  );
  const totalUsd = Number.parseFloat((walletUsd + superUsd).toFixed(2));
  const walletGroups = mergeGroupLists(
    parts.map((part) => part.walletGroups ?? []),
  );
  const superGroups = richest.superGroups ?? [];
  const ledgerGroups = (richest.groups ?? []).filter((group) =>
    isIntentsGroupName(group.name),
  );
  const mergedWalletGroups = mergeGroupLists(
    parts.map((part) =>
      (part.groups ?? []).filter(
        (group) => !isIntentsGroupName(group.name),
      ),
    ),
  );
  const order = new Map<string, number>();
  parts.forEach((part, partIndex) => {
    (part.groups ?? []).forEach((group, groupIndex) => {
      const rank = partIndex * 100 + groupIndex;
      if (!order.has(group.name) || rank < (order.get(group.name) ?? 0)) {
        order.set(group.name, rank);
      }
    });
  });
  const groups = [...mergedWalletGroups, ...ledgerGroups].sort(
    (a, b) => (order.get(a.name) ?? 9999) - (order.get(b.name) ?? 9999),
  );
  return { groups, totalUsd, walletGroups, superGroups, walletUsd, superUsd };
}

/** Every client cache that belongs to a signed-in account. */
export function clearFinanceCaches() {
  clearPortfolioCache();
  clearSuperPrivateCache();
  clearHistoryCache();
}

/* ─────────────────────────────────────────────────────────
 * SUPER PRIVATE CACHE
 * The confidential side of a wallet super account, read in the
 * browser with its own User-Session. Same paint-at-once contract
 * as the wallet portfolio: the last read renders instantly and
 * revalidates quietly behind it, so the tab never drops to a bare
 * loading line while the private read is in flight. Only successful
 * reads are kept; locked and error states always re-check live.
 * ───────────────────────────────────────────────────────── */

const SUPER_PRIVATE_PREFIX = "myntle-super-private-v1";

const superPrivateMemory = new Map<string, PasskeyPortfolioRead>();

function superPrivateKey(scope: string): string {
  return `${SUPER_PRIVATE_PREFIX}:${scope}`;
}

function validPrivateRead(value: unknown): value is PasskeyPortfolioRead {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PasskeyPortfolioRead;
  if (candidate.ok) {
    return (
      Array.isArray(candidate.entries) &&
      candidate.entries.every(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          typeof entry.tokenId === "string" &&
          typeof entry.available === "string",
      )
    );
  }
  return candidate.reason === "locked" || candidate.reason === "error";
}

export function readSuperPrivateCache(
  scope: string,
): PasskeyPortfolioRead | undefined {
  const mem = superPrivateMemory.get(scope);
  if (mem) return mem;
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(superPrivateKey(scope));
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (validPrivateRead(parsed) && parsed.ok) {
          superPrivateMemory.set(scope, parsed);
          return parsed;
        }
      }
    }
  } catch {
    // Quota, private mode, or malformed storage. Fall through.
  }
  return undefined;
}

export function writeSuperPrivateCache(
  scope: string,
  read: PasskeyPortfolioRead,
) {
  if (!read.ok) return;
  superPrivateMemory.set(scope, read);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(superPrivateKey(scope), JSON.stringify(read));
    }
  } catch {
    // Private mode. Memory still covers the session.
  }
}

export function clearSuperPrivateCache() {
  superPrivateMemory.clear();
  try {
    if (typeof sessionStorage !== "undefined") {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(`${SUPER_PRIVATE_PREFIX}:`)) {
          sessionStorage.removeItem(key);
        }
      }
    }
  } catch {
    // Ignore.
  }
}
