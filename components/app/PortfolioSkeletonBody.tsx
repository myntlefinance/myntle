"use client";

import { useState, type ReactNode } from "react";
import { IconEye, IconLock, IconWallet } from "@tabler/icons-react";
import { SegmentedControl } from "@/components/atoms/SegmentedControl";
import { PortfolioHero, type AllocationGroup } from "@/components/finance/PortfolioHero";
import {
  HoldingsTable,
  flattenGroups,
} from "@/components/finance/HoldingsTable";
import { WalletAddressRow } from "@/components/app/WalletAddressRow";
import { WatchedSkeletonSample } from "@/components/app/WatchedTab";
import { isIntentsGroupName } from "@/lib/wallet/balances";
import type { PortfolioSnapshot } from "./portfolioCache";
import {
  PASSKEY_PORTFOLIO_TABS,
  PORTFOLIO_TABS,
  type PortfolioTab,
} from "@/components/app/portfolioTabs";

/* ─────────────────────────────────────────────────────────
 * PORTFOLIO SKELETON BODY
 * The first-paint shell's measuring body: the tab the URL names,
 * no key, no entrance, no URL sync. Once providers mount, the real
 * PortfolioBody takes over with a live switcher and a skeleton per
 * tab; this module is what the shell measures before that. It stays
 * free of auth hooks because the shell renders outside AuthProvider.
 * ───────────────────────────────────────────────────────── */

export type { PortfolioTab };
export { PASSKEY_PORTFOLIO_TABS, PORTFOLIO_TABS };

/* The tab marks name the account, not the network: the connected wallet's
 * brand mark from the sentence chips, and the Myntle mark for the super
 * account. A wallet with no brand art falls back to the wallet glyph. */
function WalletTabIcon({ icon }: { icon?: string }) {
  const [failed, setFailed] = useState(false);
  if (!icon || failed) {
    return <IconWallet size={15} stroke={2} className="shrink-0" aria-hidden />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={icon}
      alt=""
      aria-hidden
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-full object-contain"
    />
  );
}

function SuperTabIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/myntle-logo.svg"
      alt=""
      aria-hidden
      className="size-4 shrink-0 rounded-[4px]"
    />
  );
}

function WatchlistTabIcon() {
  return <IconEye size={15} stroke={2} className="shrink-0" aria-hidden />;
}

export function portfolioTabIcons(walletIcon?: string): Record<PortfolioTab, ReactNode> {
  return {
    "Your wallet": <WalletTabIcon icon={walletIcon} />,
    "Super account": <SuperTabIcon />,
    Watchlist: <WatchlistTabIcon />,
  };
}

export function PortfolioSkeletonBody({
  snapshot,
  walletIcon,
  tab = "Your wallet",
  superLocked = false,
}: {
  snapshot: PortfolioSnapshot;
  walletIcon?: string;
  /** The tab a fresh visit opens to; the skeleton replays its shape. */
  tab?: PortfolioTab;
  /** The super tab's common state: masked hero plus the centered card. */
  superLocked?: boolean;
}) {
  const walletGroups =
    snapshot.walletGroups ??
    snapshot.groups.filter((group) => !isIntentsGroupName(group.name));
  const superGroups =
    snapshot.superGroups ??
    snapshot.groups.filter((group) => isIntentsGroupName(group.name));
  const sumGroups = (groups: typeof walletGroups) =>
    groups.reduce(
      (total, group) =>
        total + group.items.reduce((sub, item) => sub + item.valueUsd, 0),
      0,
    );
  // The skeleton replays the opening tab's shape, so landing on it never
  // flashes the wallet first: the switcher, sentence, and body all agree
  // from the first paint.
  const activeGroups = tab === "Super account" ? superGroups : walletGroups;
  const activeUsd = Number.parseFloat(
    sumGroups(activeGroups).toFixed(2),
  );
  const activeItems = flattenGroups(activeGroups);
  const locked = tab === "Super account" && superLocked;
  // The shell has no session yet, so the address row draws its shape from
  // a realistic address; Skullet turns the text into bones either way.
  const sampleAddress = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

  return (
    <div className={`flex flex-col ${tab === "Watchlist" ? "gap-6" : "gap-8"}`}>
      <SegmentedControl
        options={PORTFOLIO_TABS}
        value={tab}
        onChange={() => {}}
        icons={portfolioTabIcons(walletIcon)}
        className="self-start"
        showSelection={false}
        skeleton
      />
      {tab === "Watchlist" ? (
        <WatchedSkeletonSample />
      ) : (
        <div className="flex flex-col gap-3">
          <WalletAddressRow
            address={sampleAddress}
            chain="evm"
            qrTitle={
              tab === "Super account" ? "Super account" : "Your wallet"
            }
            onRefresh={() => {}}
            total={activeUsd}
            masked={locked}
            animate={false}
          />
          <PortfolioHero
            total={activeUsd}
            count={activeItems.length}
            scope={tab === "Super account" ? "super" : "wallet"}
            items={activeItems}
            selected={null}
            onSelect={() => {}}
            masked={locked}
            animate={false}
            hideTotal
          />
          {locked ? (
            <div className="relative min-h-[50vh]">
              <div
                aria-hidden="true"
                className="select-none opacity-60 saturate-50 blur-sm"
              >
                <HoldingsTable
                  groups={activeGroups}
                  group={null}
                  animate={false}
                />
              </div>
              <div className="absolute inset-0 flex items-center justify-center px-4">
                <UnlockCardSample />
              </div>
            </div>
          ) : (
            <HoldingsTable
              groups={activeGroups}
              group={null}
              animate={false}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* The locked card's box, without its hooks.
 *
 * The shell is rendered outside AuthProvider, so the real
 * `UnlockRequestCard` (which reads the session) cannot appear here. The
 * card is centered in a reserved 50vh area, so only its bones matter;
 * the shape matches the real card's shell, title row, sentence, and
 * footer action closely enough for the pop-in to land in place. */
function UnlockCardSample() {
  return (
    <div className="mt-2.5 w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-attention">
            <IconLock size={14} stroke={2} aria-hidden />
          </span>
          <p className="text-sm font-medium text-ink">Super account locked</p>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Please unlock your super account to continue.
        </p>
      </div>
      <div className="primitive-card-footer flex items-center justify-end gap-2 bg-surface pb-1.5 pt-1.5">
        <span className="inline-flex h-7 items-center rounded-full bg-ink px-3 text-[13px] font-medium text-canvas">
          Unlock
        </span>
      </div>
    </div>
  );
}

export type { AllocationGroup };

export default PortfolioSkeletonBody;
