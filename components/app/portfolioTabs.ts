/* The portfolio tabs, shared by the server page and the client view.
 * This module stays free of client-only imports so `page.tsx` can read
 * the opening `?tab=` on the server: importing it from a "use client"
 * module would fail the build. */

export type PortfolioTab = "Your wallet" | "Super account" | "Watchlist";

export const PORTFOLIO_TABS: readonly PortfolioTab[] = [
  "Your wallet",
  "Super account",
  "Watchlist",
] as const;

/* A passkey account signs with a credential and holds no chain wallet, so
 * the wallet tab does not exist for it. The confidential ledger and the
 * watchlist are the whole portfolio, not a replacement for it. */
export const PASSKEY_PORTFOLIO_TABS: readonly PortfolioTab[] = [
  "Super account",
  "Watchlist",
] as const;

/** The `?tab=` value a fresh visit — server or client — opens to. */
export function parsePortfolioTab(raw: unknown): PortfolioTab {
  if (raw === "super") return "Super account";
  if (raw === "watched") return "Watchlist";
  return "Your wallet";
}
