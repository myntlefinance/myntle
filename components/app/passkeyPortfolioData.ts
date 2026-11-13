import {
  classifyAssetCategory,
  type AssetItem,
} from "@/lib/wallet/balances";
import { formatUnits } from "@/lib/intents/balances";
import { fetchPrivateBalances } from "@/lib/intents/user-session";
import type { AssetMeta } from "./toolParts";
import type { PortfolioSnapshot } from "./portfolioCache";

/* ─────────────────────────────────────────────────────────
 * PASSKEY PRIVATE BALANCE
 * A passkey account has no chain wallet, so its portfolio is the
 * confidential ledger read with its own User-Session. Everything
 * here is browser-side: the token never reaches the server and the
 * amounts are never sent anywhere. The asset catalogue only ever
 * receives the token ids it needs to name a row.
 * ───────────────────────────────────────────────────────── */

export type PasskeyBalanceEntry = {
  tokenId: string;
  available: string;
  source?: string;
};

export type PasskeyPortfolioRead =
  | { ok: true; entries: PasskeyBalanceEntry[] }
  | { ok: false; reason: "locked" | "error" };

export type PasskeyPortfolioStatus = "locked" | "error" | "empty" | "loaded";

/**
 * The cache scope is namespaced so a passkey account can never share a
 * React Query entry with the wallet of the same address on a chain.
 */
export function passkeyPortfolioScope(accountId: string): string {
  return `passkey:${accountId}`;
}

function positiveEntry(entry: PasskeyBalanceEntry): boolean {
  if (!entry.tokenId || !/^\d+$/.test(entry.available)) return false;
  try {
    return BigInt(entry.available) > 0n;
  } catch {
    return false;
  }
}

/**
 * Reads the private balance straight from 1Click with the passkey
 * User-Session. A locked session is a state, not a failure.
 */
export async function fetchPasskeyPortfolio(
  accountId: string,
): Promise<PasskeyPortfolioRead> {
  return fetchSessionPortfolio("passkey", accountId);
}

/**
 * The same private read for any session owner: a wallet super
 * account reads with its own chain and address.
 */
export async function fetchSessionPortfolio(
  chain: string,
  address: string,
): Promise<PasskeyPortfolioRead> {
  const result = await fetchPrivateBalances(chain, address);
  if (!result.ok) return result;
  return { ok: true, entries: result.balances.filter(positiveEntry) };
}

export function passkeyPortfolioStatus(
  read: PasskeyPortfolioRead | null | undefined,
): PasskeyPortfolioStatus | "pending" {
  if (!read) return "pending";
  if (!read.ok) return read.reason;
  return read.entries.length === 0 ? "empty" : "loaded";
}

/**
 * Turns raw ledger entries into the same asset matrix the wallet page
 * renders. Unknown assets stay visible under their raw id rather than
 * disappearing from the user's balance.
 */
export function buildPasskeySnapshot(
  entries: PasskeyBalanceEntry[],
  meta: Map<string, AssetMeta>,
): PortfolioSnapshot {
  const items: AssetItem[] = [];

  for (const entry of entries) {
    if (!positiveEntry(entry)) continue;
    const resolved = meta.get(entry.tokenId);
    const decimals = resolved?.decimals ?? 18;
    const symbol = resolved?.symbol ?? "UNKNOWN";
    const amount = formatUnits(entry.available, decimals);
    const numeric = Number.parseFloat(amount);
    const priceUsd = resolved?.priceUsd;
    const valueUsd =
      priceUsd !== undefined && !Number.isNaN(numeric)
        ? Number.parseFloat((numeric * priceUsd).toFixed(2))
        : 0;

    items.push({
      id: `private-${entry.tokenId}`,
      symbol,
      name: symbol,
      amount,
      valueUsd,
      category: classifyAssetCategory(symbol, valueUsd),
      contractAddress: entry.tokenId,
      chain: "near",
      network: "intents",
      assetId: entry.tokenId,
      ...(Number.isFinite(numeric) ? { quantity: numeric } : {}),
      ...(priceUsd !== undefined ? { priceUsd } : {}),
      ...(resolved?.priceAsOf !== undefined
        ? { priceAsOf: resolved.priceAsOf }
        : {}),
    });
  }

  items.sort(
    (a, b) => b.valueUsd - a.valueUsd || a.symbol.localeCompare(b.symbol),
  );

  const total = items.reduce((sum, item) => sum + item.valueUsd, 0);

  const groups =
    items.length === 0
      ? []
      : [
          {
            id: "private-balance",
            name: "Private balance",
            icon: "near",
            items,
          },
        ];

  return {
    groups,
    totalUsd: Number.parseFloat(total.toFixed(2)),
    walletGroups: [],
    superGroups: groups,
    walletUsd: 0,
    superUsd: Number.parseFloat(total.toFixed(2)),
  };
}
