/**
 * The explorer link for a settled transaction.
 *
 * 1Click reports each settlement as a hash plus an `explorerUrl`, but the URL
 * arrives empty in practice: every settled record in the database was stored
 * with no link at all while the hash sat right beside it. The app knows which
 * chain the trade named, so it builds the page itself and only falls back to
 * the API's URL when one is actually supplied.
 */

import { evmChainForSlug } from "@/lib/wallet/evm-chains";

export type ExplorerHash = {
  hash?: string;
  explorerUrl?: string;
};

const NATIVE_EXPLORERS: Record<string, (hash: string) => string> = {
  near: (hash) => `https://nearblocks.io/txns/${hash}`,
  "near-mainnet": (hash) => `https://nearblocks.io/txns/${hash}`,
  sol: (hash) => `https://solscan.io/tx/${hash}`,
  solana: (hash) => `https://solscan.io/tx/${hash}`,
};

/** The page a transaction hash lives on, when the chain is one we can name. */
export function explorerTxUrl(
  chain: string | null | undefined,
  hash: string,
): string | null {
  const slug = (chain ?? "").trim().toLowerCase();
  if (!slug || !hash) return null;
  const evm = evmChainForSlug(slug);
  if (evm?.explorerUrl) {
    return `${evm.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
  }
  const native = NATIVE_EXPLORERS[slug];
  return native ? native(hash) : null;
}

/**
 * The links for a status response's hashes, in the order they arrived.
 *
 * A hash whose chain has no known explorer is dropped rather than pointed at
 * a generic block explorer that would show nothing.
 */
export function settlementLinks(
  groups: Array<{ chain?: string | null; hashes: ExplorerHash[] }>,
): string[] {
  const links: string[] = [];
  for (const group of groups) {
    for (const item of group.hashes) {
      const supplied = item.explorerUrl?.trim();
      const url =
        supplied && /^https?:\/\//i.test(supplied)
          ? supplied
          : item.hash
            ? explorerTxUrl(group.chain, item.hash)
            : null;
      if (url && !links.includes(url)) links.push(url);
    }
  }
  return links;
}
