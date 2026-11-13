"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { truncateTechData } from "@/components/atoms/TechDataChip";
import { accountScope } from "@/lib/auth/session-identity";
import type { AssetGroup } from "@/lib/wallet/balances";
import {
  SAMPLE_PORTFOLIO,
  readPortfolioRowCount,
  sampleGroupsWithRows,
  type PortfolioSnapshot,
} from "./portfolioCache";
import type { WatchlistEntry } from "./useWatchlist";

/* ─────────────────────────────────────────────────────────
 * WATCHED DETAIL VIEW
 * The selected watchlist account's public snapshot, shaped for
 * the shared portfolio chrome. Kept as a hook so the chrome can
 * stay mounted across tabs and morph the address and total into
 * the watched account instead of remounting the whole section.
 * ───────────────────────────────────────────────────────── */

/* The watched detail's sample is the public side only: the wallet
 * groups, never the settlement ledger. Feeding `groups` would measure
 * nine rows and then reveal the watched account's shorter table. */
const SAMPLE_WATCHED_SNAPSHOT: PortfolioSnapshot = {
  groups: SAMPLE_PORTFOLIO.walletGroups ?? [],
  totalUsd: SAMPLE_PORTFOLIO.walletUsd ?? 0,
  walletGroups: SAMPLE_PORTFOLIO.walletGroups ?? [],
  superGroups: [],
  walletUsd: SAMPLE_PORTFOLIO.walletUsd ?? 0,
  superUsd: 0,
};

/* The watched hero runs slower than the shared timing (600ms vs 350ms)
 * so progressive chunk merges glide instead of flickering. The queue
 * holds each value until the previous morph finishes: bursts collapse
 * to the latest, never overriding mid-flight. The table below keeps
 * live rows and streams in without waiting. */
const HERO_QUEUE_DELAY = 650;
export const WATCHED_HERO_DURATION = 600;

function useQueuedValue<T>(value: T, resetKey: string): T {
  const [displayed, setDisplayed] = useState(value);
  const latestRef = useRef(value);
  const shownRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new account drops anything queued and paints its own value at
  // once; the torph morph still glides from the previous total.
  /* eslint-disable react-hooks/set-state-in-effect -- queue reset: the queued
   * value belongs to one watched address, like the filter reset below */
  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    latestRef.current = value;
    shownRef.current = value;
    setDisplayed(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    latestRef.current = value;
    if (timerRef.current !== null) return;
    if (value === shownRef.current) return;
    if (shownRef.current === null || shownRef.current === undefined) {
      shownRef.current = value;
      setDisplayed(value);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      shownRef.current = latestRef.current;
      setDisplayed(latestRef.current);
    }, HERO_QUEUE_DELAY);
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return displayed;
}

function sumUsd(groups: AssetGroup[]): number {
  return Number.parseFloat(
    groups
      .reduce(
        (total, group) =>
          total + group.items.reduce((sub, item) => sub + item.valueUsd, 0),
        0,
      )
      .toFixed(2),
  );
}

export type WatchedDetailView = {
  entry: WatchlistEntry;
  /** The address row's identity. */
  address: string;
  /** The label the hero sentence names. */
  subject: string;
  groups: AssetGroup[];
  heroGroups: AssetGroup[];
  total: number;
  pending: boolean;
  stale: boolean;
  failed: boolean;
  refreshing: boolean;
  refresh: () => void;
  /** Changes when the account changes: only the table body remounts. */
  bodyKey: string;
  /** Real or error data for the shared Skeleton; null while loading. */
  data: { groups: AssetGroup[]; totalUsd: number } | null;
  sample: { groups: AssetGroup[]; totalUsd: number };
  label: string;
  heroAnimate: boolean;
  tableAnimate: boolean;
  morphDuration: number;
};

export function useWatchedDetailView({
  entry,
  snapshot,
  isPending,
  error,
  refresh,
  isRefreshing = false,
}: {
  entry: WatchlistEntry | null;
  snapshot: PortfolioSnapshot | null;
  isPending: boolean;
  error: unknown;
  refresh: () => void;
  isRefreshing?: boolean;
}): WatchedDetailView | null {
  // The pair on screen: entry and snapshot advance together, so the
  // numbers below a fresh label are never another account's. While the
  // next account's read is in flight the previous pair stays, dimmed.
  const [shown, setShown] = useState<{
    entry: WatchlistEntry | null;
    snapshot: PortfolioSnapshot | null;
  }>({ entry, snapshot });
  const shownId = shown.entry?.id ?? null;

  /* eslint-disable react-hooks/set-state-in-effect -- retention sync: the slot
   * keeps the last pair while the next account's snapshot is loading */
  useEffect(() => {
    if (!entry) {
      setShown({ entry: null, snapshot: null });
      return;
    }
    if (
      shownId !== null &&
      shownId !== entry.id &&
      snapshot === null &&
      !error
    ) {
      // The new account is still on its way and something is already on
      // screen: hold the previous pair until its snapshot (or error)
      // lands and the chrome can morph across.
      return;
    }
    setShown({ entry, snapshot });
  }, [entry, snapshot, error, shownId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const displayEntry = shown.entry ?? entry;
  const displaySnapshot = shown.entry ? shown.snapshot : snapshot;
  const displayId = displayEntry?.id ?? "";
  const waiting =
    entry != null &&
    shownId !== null &&
    shownId !== entry.id &&
    snapshot === null &&
    !error;

  const pending = isPending && !displaySnapshot;
  const failed = Boolean(error && !displaySnapshot);
  const errorData = failed ? { groups: [], totalUsd: 0 } : null;

  const sampleRows = displayEntry
    ? readPortfolioRowCount(
        `watched:${accountScope(displayEntry.chain, displayEntry.address)}`,
        "watched",
      )
    : null;
  const sample = useMemo(() => {
    if (sampleRows === null) return SAMPLE_WATCHED_SNAPSHOT;
    return {
      ...SAMPLE_WATCHED_SNAPSHOT,
      groups: sampleGroupsWithRows(SAMPLE_WATCHED_SNAPSHOT.groups, sampleRows),
    };
  }, [sampleRows]);
  const data = displaySnapshot ?? errorData;

  // The hero trails the table through the queue: chunk merges update
  // the queued snapshot at most every 650ms and each 600ms morph
  // finishes before the next begins. The table reads the live view.
  const queued = useQueuedValue(displaySnapshot, displayId);
  const tableGroups = data?.groups ?? [];
  const heroGroups = (queued ?? data)?.groups ?? [];

  // The card switch fades only the rows below; hold the table numbers
  // plain through that entrance, then let later chunk overlays morph.
  const [tableLive, setTableLive] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- account entrance: hold
   * the table's morphs plain while the rows fade, then let chunks glide */
  useEffect(() => {
    setTableLive(false);
    const timer = window.setTimeout(() => setTableLive(true), 300);
    return () => window.clearTimeout(timer);
  }, [displayId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!entry || !displayEntry) return null;

  const subject =
    displayEntry.label ??
    displayEntry.resolvedName ??
    truncateTechData(displayEntry.address, displayEntry.chain);

  return {
    entry: displayEntry,
    address: displayEntry.address,
    subject,
    groups: tableGroups,
    heroGroups,
    total: sumUsd(heroGroups),
    pending,
    stale: waiting,
    failed,
    refreshing: isRefreshing,
    refresh,
    bodyKey: displayEntry.id,
    data,
    sample,
    label: "Reading public balances.",
    heroAnimate: !pending,
    tableAnimate: !pending && tableLive,
    morphDuration: WATCHED_HERO_DURATION,
  };
}
