"use client";

import { Skeleton } from "skullet/react";
import type { AllocationGroup } from "@/components/finance/PortfolioHero";
import { PortfolioChrome } from "@/components/app/PortfolioChrome";
import type { AssetGroup } from "@/lib/wallet/balances";
import type { ChainKind } from "@/lib/wallet/types";
import { useSuperAccountView } from "./useSuperAccountView";

/* ─────────────────────────────────────────────────────────
 * SUPER ACCOUNT TAB
 * The confidential side of a connected wallet. The data and the
 * gate live in `useSuperAccountView`; this wrapper composes the
 * same shared chrome the portfolio page uses, so a standalone
 * render and the tabbed page can never drift apart.
 * ───────────────────────────────────────────────────────── */

export { mergeSuperGroups } from "./useSuperAccountView";

export function SuperAccountTab({
  chain,
  address,
  publicGroups,
  publicPending = false,
  publicRefreshing = false,
  sampleRows = null,
  group,
  onToggleGroup,
  onRefresh,
}: {
  chain: ChainKind | null;
  address: string | null;
  publicGroups: AssetGroup[];
  /** The public ledger is still on its way; the tab holds its shape. */
  publicPending?: boolean;
  /** The public half of a refresh started from the section row. */
  publicRefreshing?: boolean;
  /** The last read's row count, so a cold skeleton matches this table. */
  sampleRows?: number | null;
  group: AllocationGroup | null;
  onToggleGroup: (next: AllocationGroup) => void;
  /** Re-reads the public balances from the address row. */
  onRefresh: () => void;
}) {
  const view = useSuperAccountView({
    chain,
    address,
    publicGroups,
    publicPending,
    publicRefreshing,
    sampleRows,
    onRefresh,
  });

  return (
    <Skeleton
      id={view.showLock ? "portfolio:super:locked" : "portfolio:super"}
      data={view.skeletonData}
      sample={view.sample}
      label={view.label}
    >
      {(loaded) => (
        <PortfolioChrome
          address={address}
          chain={chain ?? "evm"}
          qrTitle="Super account"
          scope="super"
          groups={loaded.groups}
          heroGroups={loaded.groups}
          total={loaded.totalUsd}
          masked={view.showLock}
          heroAnimate={!view.pending}
          tableAnimate={!view.pending}
          refreshing={view.refreshing}
          onRefresh={view.refreshAll}
          bodyKey="super"
          error={view.failed}
          onRetry={view.retryPrivate}
          gate={view.showLock ? { forceLocked: view.forceLocked } : null}
          group={group}
          onSelectGroup={onToggleGroup}
        />
      )}
    </Skeleton>
  );
}

export default SuperAccountTab;
