"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssetGroup } from "@/lib/wallet/balances";
import {
  SUPER_CLOSED_EVENT,
  SUPER_UNLOCK_EVENT,
  useSuperUnlocked,
} from "@/lib/intents/user-session";
import { useSuperPrivateBalances } from "./portfolioQueries";
import {
  SAMPLE_PORTFOLIO,
  portfolioScope,
  sampleGroupsWithRows,
  writePortfolioRowCount,
  type PortfolioSnapshot,
} from "./portfolioCache";

/* ─────────────────────────────────────────────────────────
 * SUPER ACCOUNT VIEW
 * The confidential side of a connected wallet: the unlock gate,
 * the private read, and the merge over the public settlement
 * rows. Kept as a hook so the shared portfolio chrome can stay
 * mounted across tabs while this data changes underneath it.
 * ───────────────────────────────────────────────────────── */

function sumGroups(groups: AssetGroup[]): number {
  return groups.reduce(
    (total, group) =>
      total + group.items.reduce((sub, item) => sub + item.valueUsd, 0),
    0,
  );
}

/** Public rows the private read does not already name, kept grouped. */
export function mergeSuperGroups(
  publicGroups: AssetGroup[],
  privateSnapshot: PortfolioSnapshot | null,
): { groups: AssetGroup[]; totalUsd: number } {
  if (!privateSnapshot) {
    return {
      groups: publicGroups,
      totalUsd: Number.parseFloat(sumGroups(publicGroups).toFixed(2)),
    };
  }
  const seen = new Set(
    privateSnapshot.groups
      .flatMap((group) => group.items)
      .map((item) => item.contractAddress ?? item.symbol),
  );
  const keptPublic = publicGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !seen.has(item.contractAddress ?? item.symbol),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const groups = [...privateSnapshot.groups, ...keptPublic];
  return {
    groups,
    totalUsd: Number.parseFloat(sumGroups(groups).toFixed(2)),
  };
}

/* The loading sample is fixed: keeping it at module scope stops the
 * Skeleton's sample object from changing identity on every render. */
const SUPER_SAMPLE_GROUPS = SAMPLE_PORTFOLIO.superGroups ?? [];
const SUPER_SAMPLE_TOTAL =
  SAMPLE_PORTFOLIO.superUsd ??
  Number.parseFloat(sumGroups(SUPER_SAMPLE_GROUPS).toFixed(2));

/** Longest the gate waits for the dialog to report that it closed. */
const REVEAL_WATCHDOG_MS = 4_000;
/** If the first private read never settles, fall back to the skeleton. */
const REVEAL_READ_WATCHDOG_MS = 8_000;

export function useSuperAccountView({
  chain,
  address,
  publicGroups,
  publicPending = false,
  publicRefreshing = false,
  sampleRows = null,
  onRefresh,
  active = true,
}: {
  chain: string | null;
  address: string | null;
  publicGroups: AssetGroup[];
  publicPending?: boolean;
  publicRefreshing?: boolean;
  sampleRows?: number | null;
  onRefresh: () => void;
  /** The super tab is on screen; the private read waits until it is. */
  active?: boolean;
}) {
  const unlocked = useSuperUnlocked(chain, address);
  const priv = useSuperPrivateBalances(chain, address, active && unlocked === true);

  // The read starts the moment the session lands, but the tab that was
  // behind the unlock dialog must not swap to the fetched rows while that
  // dialog is still fading. Hold the gate until the dialog reports it is
  // gone; the watchdog only covers a close that never arrives.
  const [held, setHeld] = useState(false);
  // True from the unlock until the first private read settles, so a slow
  // read keeps the locked background instead of flashing a skeleton. A
  // returning unlocked visit never sets it and keeps the skeleton.
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    let closeWatchdog: number | undefined;
    let readWatchdog: number | undefined;
    const hold = () => {
      setHeld(true);
      setSettling(true);
      window.clearTimeout(closeWatchdog);
      window.clearTimeout(readWatchdog);
      closeWatchdog = window.setTimeout(() => setHeld(false), REVEAL_WATCHDOG_MS);
      readWatchdog = window.setTimeout(
        () => setSettling(false),
        REVEAL_READ_WATCHDOG_MS,
      );
    };
    const release = () => {
      window.clearTimeout(closeWatchdog);
      setHeld(false);
    };
    window.addEventListener(SUPER_UNLOCK_EVENT, hold);
    window.addEventListener(SUPER_CLOSED_EVENT, release);
    return () => {
      window.clearTimeout(closeWatchdog);
      window.clearTimeout(readWatchdog);
      window.removeEventListener(SUPER_UNLOCK_EVENT, hold);
      window.removeEventListener(SUPER_CLOSED_EVENT, release);
    };
  }, []);

  const locked = unlocked !== true;
  // The private read has not settled yet (no snapshot, and not a known
  // refusal or failure).
  const privatePending =
    unlocked === true &&
    !priv.snapshot &&
    priv.status !== "error" &&
    priv.status !== "locked";
  // A just-unlocked tab keeps its gate until both the dialog is gone and
  // the first private read has landed. A returning visit reveals as soon
  // as the session is live and lets the skeleton cover the read.
  const revealed = unlocked === true && !held && !settling;
  // The public read always drives the skeleton. A just-unlocked tab never
  // swaps to the skeleton for the private read; it holds the locked shape.
  const pending = publicPending || (!settling && privatePending);

  // Once the dialog is gone, the first private read is what the gate was
  // waiting for. Clear the hold when it has settled, whatever it decided.
  /* eslint-disable react-hooks/set-state-in-effect -- gate release: the
   * dialog close and the first private read settle one flag */
  useEffect(() => {
    if (!settling || held) return;
    if (
      priv.snapshot ||
      priv.status === "error" ||
      priv.status === "locked"
    ) {
      setSettling(false);
    }
  }, [settling, held, priv.snapshot, priv.status]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sample = useMemo(() => {
    if (sampleRows === null) {
      return { groups: SUPER_SAMPLE_GROUPS, totalUsd: SUPER_SAMPLE_TOTAL };
    }
    return {
      groups: sampleGroupsWithRows(SUPER_SAMPLE_GROUPS, sampleRows),
      totalUsd: SUPER_SAMPLE_TOTAL,
    };
  }, [sampleRows]);
  const scope = chain && address ? portfolioScope(chain, address) : null;

  const merged = useMemo(() => {
    // A held gate keeps the exact background it had before the unlock:
    // public rows only, never the private rows fetched behind the dialog.
    if (!revealed) {
      return {
        groups: publicGroups,
        totalUsd: Number.parseFloat(sumGroups(publicGroups).toFixed(2)),
      };
    }
    const effective = priv.snapshot ?? null;
    return mergeSuperGroups(publicGroups, effective);
  }, [revealed, publicGroups, priv.snapshot]);

  // Locked means gated, never empty: the confidential balance is
  // unknown without a session, so the tab keeps its exact layout and
  // the same in-chat card fades in over it. A null createdAt keeps the
  // card live; the background is inert while it asks.
  //
  // A live session whose read comes back locked is gated too: the service
  // refused the token, so the private rows are unknown even if the public
  // ledger has rows. The card follows the live state (`live`) and is forced
  // back to locked here, so it can never say "unlocked" over masked rows.
  const refused = revealed && priv.status === "locked";
  const showLock = !revealed || refused;
  const failed =
    revealed &&
    !pending &&
    !locked &&
    priv.status === "error" &&
    merged.groups.every((group) => group.items.length === 0);
  // The address row re-reads both sides of the super account. Refreshing
  // only the public ledger while the private read is refused looks like a
  // broken button; the private read is what the user is asking about.
  // A locked account has nothing to re-read — the gate is waiting on the
  // user, not on the network — so the control stays inert until unlock.
  const refreshAll = () => {
    if (showLock) return;
    onRefresh();
    void priv.refresh();
  };
  const refreshing =
    !showLock && (publicRefreshing || (priv.isRefreshing ?? false));

  // Remember the row count the next cold skeleton should reserve. The
  // merged private rows are what the unlocked table shows, so this runs
  // only once the tab has a settled view.
  useEffect(() => {
    if (pending) return;
    writePortfolioRowCount(
      scope,
      "super",
      merged.groups.reduce((count, group) => count + group.items.length, 0),
    );
  }, [scope, pending, merged.groups]);

  return {
    groups: merged.groups,
    total: merged.totalUsd,
    pending,
    refreshing,
    showLock,
    forceLocked: refused || held || settling,
    failed,
    refreshAll,
    retryPrivate: () => void priv.refresh(),
    sample,
    skeletonData: pending
      ? null
      : { groups: merged.groups, totalUsd: merged.totalUsd },
    label: "Reading your super account.",
  };
}

export type SuperAccountView = ReturnType<typeof useSuperAccountView>;
