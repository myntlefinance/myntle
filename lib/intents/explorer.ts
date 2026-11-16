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

const INTENTS_EXPLORER = "https://explorer.near-intents.org";

/**
 * The modes whose deposit address the Intents Explorer tracks under its
 * masked pages. Verified live: `confidential-external` and
 * `confidential-withdrawal` resolve (deposits, withdrawals, and swaps with
 * a chain leg), while signed ledger moves (`confidential-intents`) and the
 * legacy direct path return the explorer's empty state instead of a page.
 */
const MASKED_MODES = new Set([
  "confidential-external",
  "confidential-withdrawal",
]);

/**
 * The NEAR Intents Explorer page for a trade: the masked-transaction view
 * keyed by the minted deposit address. Only chain-touched modes resolve —
 * a signed ledger move has no page, so this returns null rather than
 * pointing at one.
 */
export function intentsExplorerTxUrl(
  depositAddress?: string | null,
  mode?: string | null,
): string | null {
  const address = (depositAddress ?? "").trim();
  if (!address) return null;
  if (!mode || !MASKED_MODES.has(mode.trim().toLowerCase())) return null;
  return `${INTENTS_EXPLORER}/mask/${address}`;
}

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
