import {
  groupBalancesByNetwork,
  type AssetGroup,
  type TokenBalance,
} from "@/lib/wallet/balances";
import { accountScope } from "@/lib/auth/session-identity";
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
          category: "stables",
        },
        {
          id: "sample-base-eth",
          symbol: "ETH",
          name: "Ether",
          amount: "0.8420",
          valueUsd: 2734.18,
          category: "native",
        },
      ],
    },
    {
      id: "settlement",
      name: "Settlement Ledger",
      icon: "near",
      items: [
        {
          id: "sample-intents-usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "320.50",
          valueUsd: 320.5,
          category: "stables",
        },
      ],
    },
  ],
  totalUsd: 4304.68,
};

type LedgerItem = {
  assetId: string;
  symbol: string;
  decimals: number;
  balance: string;
  rawBalance: string;
  priceUsd?: number;
  valueUsd?: number;
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
  if (mem) return mem;
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(storageKey(scope));
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (validSnapshot(parsed)) {
          memory.set(scope, parsed);
          return parsed;
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
  try {
    if (typeof sessionStorage !== "undefined") {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(`${STORAGE_PREFIX}:`)) {
          sessionStorage.removeItem(key);
        }
      }
    }
  } catch {
    // Ignore.
  }
}

/** Fetches both sides of the portfolio and groups them for display. */
export async function fetchPortfolio(
  address: string,
  chain: string,
): Promise<PortfolioSnapshot> {
  const res = await fetch(
    `/api/wallet/balances?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`,
    { cache: "no-store" },
  );
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
    }),
  );
  const all = [...(body?.wallet?.balances ?? []), ...ledger];
  const total =
    (body?.wallet?.totalValueUsd ?? 0) +
    (body?.intentsLedger?.totalValueUsd ?? 0);
  return {
    groups: groupBalancesByNetwork(all),
    totalUsd: Number.parseFloat(total.toFixed(2)),
  };
}

/** Every client cache that belongs to a signed-in account. */
export function clearFinanceCaches() {
  clearPortfolioCache();
  clearHistoryCache();
}
