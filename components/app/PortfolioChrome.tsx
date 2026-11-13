"use client";

import { PortfolioHero, type AllocationGroup, type HeroScope } from "@/components/finance/PortfolioHero";
import { HoldingsTable, flattenGroups } from "@/components/finance/HoldingsTable";
import { WalletAddressRow } from "@/components/app/WalletAddressRow";
import { UnlockRequestCard } from "@/components/app/UnlockCard";
import type { AssetGroup } from "@/lib/wallet/balances";
import type { ChainKind } from "@/lib/wallet/types";

/* ─────────────────────────────────────────────────────────
 * PORTFOLIO CHROME
 * The identity row, the allocation sentence and bar, and the
 * holdings table shared by every portfolio subsection. The
 * caller keeps one instance mounted while the data underneath
 * changes, so the address, total, sentence, and pills morph in
 * place. Only the table body remounts — through `bodyKey` —
 * which is the one entrance the tabs are allowed to replay.
 * ───────────────────────────────────────────────────────── */

export type PortfolioChromeView = {
  /** The account whose balances these are; the row stays hidden without one. */
  address: string | null;
  /** The address's chain family, for its explorer link. */
  chain: ChainKind;
  qrTitle: string;
  scope: HeroScope;
  /** The watched label; the sentence marks the public state. */
  subject?: string;
  /** Rows for the table. */
  groups: AssetGroup[];
  /** Rows for the sentence and allocation bar. Watched keeps a
    * slower queued copy so progressive chunks glide. */
  heroGroups: AssetGroup[];
  /** The total in the address row; the hero hides its own. */
  total: number;
  masked?: boolean;
  /** Digits and sentence morph; false while the panel is on a sample. */
  heroAnimate?: boolean;
  /** Table digits morph; false through an account entrance. */
  tableAnimate?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Changes when the table's rows belong to a new tab or account:
    * only the body remounts, the toolbar above stays put. */
  bodyKey: string;
  emptyTitle?: string;
  /** The read failed; the body names it and offers a retry. */
  error?: boolean;
  onRetry?: () => void;
  /** Super account gate: the table stays mounted, blurred beneath
    * the unlock card, so unlocking never remounts the toolbar. */
  gate?: { forceLocked: boolean } | null;
  /** A newly picked watched account is still loading: dim the held
    * pair until its snapshot lands. */
  dimmed?: boolean;
  /** Watched hero timing; the shared timing everywhere else. */
  morphDuration?: number;
  group: AllocationGroup | null;
  onSelectGroup: (next: AllocationGroup) => void;
};

export function PortfolioChrome(view: PortfolioChromeView) {
  const heroItems = flattenGroups(view.heroGroups);
  const table = (
    <HoldingsTable
      groups={view.groups}
      group={view.group}
      animate={view.tableAnimate ?? true}
      bodyKey={view.bodyKey}
      emptyTitle={view.emptyTitle}
      error={view.error}
      onRetry={view.onRetry}
    />
  );

  return (
    <div
      className={`flex flex-col gap-3 transition-opacity duration-200 ${
        view.dimmed ? "opacity-60" : "opacity-100"
      }`}
      aria-busy={view.dimmed || undefined}
    >
      {view.address ? (
        <WalletAddressRow
          address={view.address}
          chain={view.chain}
          qrTitle={view.qrTitle}
          actionLabel={view.scope === "watched" ? "Transfer" : "Deposit"}
          onRefresh={view.onRefresh}
          // The gate is the locked super account: its private read cannot
          // run, so re-reading from its title row would only spin.
          refreshDisabled={Boolean(view.gate)}
          refreshing={view.refreshing}
          total={view.total}
          masked={view.masked}
          animate={view.heroAnimate ?? true}
          morphDuration={view.morphDuration}
        />
      ) : null}
      <PortfolioHero
        total={view.total}
        count={heroItems.length}
        scope={view.scope}
        subject={view.subject}
        items={heroItems}
        selected={view.group}
        onSelect={view.onSelectGroup}
        masked={view.masked}
        steadyBar
        animate={view.heroAnimate ?? true}
        morphDuration={view.morphDuration}
        hideTotal
      />
      <div className={view.gate ? "relative min-h-[50vh]" : undefined}>
        <div
          aria-hidden={view.gate ? true : undefined}
          inert={view.gate ? true : undefined}
          className={
            view.gate
              ? "select-none opacity-60 saturate-50 blur-sm"
              : undefined
          }
        >
          {table}
        </div>
        {view.gate ? (
          <div className="absolute inset-0 flex items-center justify-center px-4">
            <div className="w-full max-w-95 animate-[pop-in_180ms_cubic-bezier(0.23,1,0.32,1)_both]">
              <UnlockRequestCard
                createdAt={null}
                interactive
                superseded={false}
                live
                forceLocked={view.gate.forceLocked}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default PortfolioChrome;
