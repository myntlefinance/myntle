"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { IconEye, IconLoader2, IconTrash } from "@tabler/icons-react";
import { Skeleton } from "skullet/react";
import { Button } from "@/components/atoms/Button";
import { DialogShell } from "@/components/app/DialogShell";
import { truncateTechData } from "@/components/atoms/TechDataChip";
import {
  PortfolioHero,
  BalancesTitleRow,
  type AllocationGroup,
} from "@/components/finance/PortfolioHero";
import {
  HoldingsTable,
  flattenGroups,
} from "@/components/finance/HoldingsTable";
import {
  SAMPLE_PORTFOLIO,
  readPortfolioRowCount,
  sampleGroupsWithRows,
  type PortfolioSnapshot,
} from "./portfolioCache";
import { accountScope } from "@/lib/auth/session-identity";
import type { WatchlistEntry } from "./useWatchlist";
import { WatchedCards, type WatchedCardEntry } from "@/components/finance/WatchedCards";

/* ─────────────────────────────────────────────────────────
 * WATCHLIST TAB
 * Someone else's public portfolio: the watchlist as cards, and
 * the selected account's public hero plus holdings below.
 * Read-only by construction — the snapshot arrives from the
 * public read, neither component has a mutating action, and
 * Refresh is a plain refetch. Removing is gated by the dialog;
 * tracking it again restores it. The selection lives in memory
 * only: no address ever reaches the URL, and a fresh visit
 * opens to the stored default instead.
 * ───────────────────────────────────────────────────────── */

/* The list's loading shape, shared by the tab and the app shell: the
 * cards row only. The selected account's hero and holdings are a second
 * read, so the tab does not promise a detail before the list has even
 * said whether there is an address to watch.
 *
 * The sample is exported on its own because the app shell already sits
 * inside a measured `Skeleton`: nesting another one there would draw
 * two layers of bones over the same cards. The shell measures this
 * sample; the tab wraps it in its own `Skeleton` only when nothing
 * above it is already measuring. */
export function WatchedSkeletonSample() {
  return (
    <div
      className="flex flex-col gap-3"
      aria-label="Reading watchlist."
      role="status"
    >
      <WatchedCards
        entries={SAMPLE_WATCHED}
        // No selection in the skeleton: the accent ring and wash are a
        // data selection and should fade in with the loaded cards.
        selectedId={null}
        onSelect={() => {}}
        onEdit={() => {}}
        onDeleteRequest={() => {}}
        onAdd={() => {}}
        onSetDefault={() => {}}
      />
    </div>
  );
}

export function WatchedSkeletonBody() {
  return (
    <Skeleton
      id="portfolio:watched:list"
      data={null}
      sample={SAMPLE_WATCHED}
      label="Reading watchlist."
    >
      {() => <WatchedSkeletonSample />}
    </Skeleton>
  );
}

/* Two sample rows so the list's loading state replays its own cards
 * instead of an anonymous block. Skullet ghosts the sample text
 * automatically. */
const SAMPLE_WATCHED: WatchlistEntry[] = [
  {
    id: "sample-watch-1",
    chain: "evm",
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    label: "Vault",
    isDefault: true,
    createdAt: "2026-11-06T12:00:00.000Z",
  },
  {
    id: "sample-watch-2",
    chain: "near",
    address: "alice.near",
    label: null,
    isDefault: false,
    createdAt: "2026-11-06T12:01:00.000Z",
  },
];

/* The selected account opens through the table's own rhythm: the slot
 * holds the last account while the rows collapse, then frees it, so the
 * height eases both ways on the same curve the holdings use. A new
 * selection waits for its snapshot (or error) before swapping, so the
 * hero always morphs from the last real values instead of cutting
 * through the sample skeleton mid-switch; only the table below replays
 * the fade-up, keyed by account. */
function WatchedDetailSlot({
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
}) {
  // The pair on screen: entry and snapshot advance together, so the
  // numbers below a fresh label are never another account's.
  const [shown, setShown] = useState<{
    entry: WatchlistEntry | null;
    snapshot: PortfolioSnapshot | null;
  }>({ entry, snapshot });
  const [open, setOpen] = useState(entry !== null);
  const shownId = shown.entry?.id ?? null;
  // A newly picked card whose snapshot is still on its way: the slot
  // holds the previous pair, dimmed, instead of cutting to a skeleton.
  const waiting =
    entry !== null &&
    shownId !== null &&
    shownId !== entry.id &&
    snapshot === null &&
    !error;

  /* eslint-disable react-hooks/set-state-in-effect -- retention sync: the slot
   * keeps the last pair while the rows collapse, then frees it, and holds
   * it while the next account loads so the hero morphs across */
  useEffect(() => {
    if (!entry) {
      setOpen(false);
      const timer = window.setTimeout(
        () => setShown({ entry: null, snapshot: null }),
        220,
      );
      return () => window.clearTimeout(timer);
    }
    if (
      shownId !== null &&
      shownId !== entry.id &&
      snapshot === null &&
      !error
    ) {
      // The new account is still on its way and something is already on
      // screen: hold the previous pair until its snapshot (or error)
      // lands and the hero can morph across.
      return;
    }
    setShown({ entry, snapshot });
    const frame = window.requestAnimationFrame(() => setOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, [entry, snapshot, error, shownId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!shown.entry) {
    // Nothing selected — or a deselect just finished collapsing. The
    // cards own the choice, so the empty state names the next step in
    // one line. A fresh pick skips this: its entry is already set while
    // its pair is still on its way.
    if (!entry) {
      return (
        <p className="px-4 py-10 text-center text-[13px] leading-relaxed text-ink-3">
          Select an address to view its public portfolio.
        </p>
      );
    }
    return null;
  }
  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: "grid-template-rows 220ms cubic-bezier(0.23, 1, 0.32, 1)",
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <WatchedDetail
          entry={shown.entry}
          snapshot={shown.snapshot}
          isPending={isPending}
          error={error}
          refresh={refresh}
          stale={waiting}
          isRefreshing={isRefreshing}
        />
      </div>
    </div>
  );
}

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
const WATCHED_HERO_DURATION = 600;

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

/* The loaded hero plus table. The hero reads the queued snapshot so
 * its total, sentence, and bar stay consistent and glide one morph at
 * a time; the table reads the live view and grows as chunks land. */
function WatchedContent({
  view,
  queued,
  entry,
  group,
  onSelectGroup,
  pending,
}: {
  view: PortfolioSnapshot;
  queued: PortfolioSnapshot;
  entry: WatchlistEntry;
  group: AllocationGroup | null;
  onSelectGroup: (next: AllocationGroup) => void;
  pending: boolean;
}) {
  const vGroups = view.groups ?? [];
  const qItems = flattenGroups(queued.groups ?? []);
  const qTotal = Number.parseFloat(
    qItems.reduce((sum, item) => sum + item.valueUsd, 0).toFixed(2),
  );
  return (
    <div className="flex flex-col gap-3">
      <PortfolioHero
        total={qTotal}
        count={qItems.length}
        scope="watched"
        subject={entry.label ?? entry.address}
        items={qItems}
        selected={group}
        onSelect={onSelectGroup}
        steadyBar
        animate={!pending}
        morphDuration={WATCHED_HERO_DURATION}
      />
      {/* Per account the table remounts so the search, network,
        and dust controls restart with it; only the card below
        replays the entrance (see bodyKey) while the toolbar
        above paints instantly. */}
      <HoldingsTable
        key={entry.id}
        bodyKey={entry.id}
        groups={vGroups}
        group={group}
        emptyTitle="No public holdings found."
        animate={!pending}
      />
    </div>
  );
}

function WatchedDetail({
  entry,
  snapshot,
  isPending,
  error,
  refresh,
  stale = false,
  isRefreshing = false,
}: {
  entry: WatchlistEntry;
  snapshot: PortfolioSnapshot | null;
  isPending: boolean;
  error: unknown;
  refresh: () => void;
  /** A newly picked card is still loading: the held pair dims until its
   * snapshot lands then brightens and morphs as usual. No skeleton. */
  stale?: boolean;
  isRefreshing?: boolean;
}) {
  const [group, setGroup] = useState<AllocationGroup | null>(null);
  // The hero stays mounted across accounts so its total morphs; the bar
  // filter still restarts per account, reset here before paint so the
  // new account never flashes the old account's filter.
  const [filterFor, setFilterFor] = useState(entry.id);
  if (filterFor !== entry.id) {
    setFilterFor(entry.id);
    setGroup(null);
  }

  const pending = isPending && !snapshot;
  // The last read of this exact watched address sets the sample height,
  // so a returning visit does not reserve five rows for a three-row
  // table. The scope matches `useWatchedPortfolio` exactly.
  const watchedScope = `watched:${accountScope(entry.chain, entry.address)}`;
  const sampleRows = readPortfolioRowCount(watchedScope, "watched");
  const sample = useMemo(() => {
    if (sampleRows === null) return SAMPLE_WATCHED_SNAPSHOT;
    return {
      ...SAMPLE_WATCHED_SNAPSHOT,
      groups: sampleGroupsWithRows(SAMPLE_WATCHED_SNAPSHOT.groups, sampleRows),
    };
  }, [sampleRows]);
  // A failed read names itself with a retry; while the first read is
  // still on its way the skeleton below holds the section instead.
  const errorNode =
    error && !snapshot ? (
      <HoldingsTable
        groups={[]}
        error
        onRetry={() => refresh()}
      />
    ) : undefined;

  // The hero trails the table through the queue: chunk merges update
  // the queued snapshot at most every 650ms and each 600ms morph
  // finishes before the next begins. The table reads the live view.
  const queuedSnapshot = useQueuedValue(snapshot, entry.id);

  return (
    <div
      className={`flex flex-col gap-3 transition-opacity duration-200 ${stale ? "opacity-60" : "opacity-100"}`}
      aria-busy={stale || undefined}
    >
      <BalancesTitleRow onRefresh={refresh} refreshing={isRefreshing} />
      {/* One skeleton from ghost to content: feeding the snapshot in lets
        Skullet crossfade the reveal itself — ghost out, content in row by
        row — instead of cutting from an unmounted ghost to freshly
        mounted rows at the very end. */}
      <Skeleton
        id={`watched:${entry.id}`}
        data={snapshot}
        sample={sample}
        label="Reading public balances."
        loading={pending}
        error={errorNode}
      >
        {(view) => (
          <WatchedContent
            view={view}
            queued={queuedSnapshot ?? view}
            entry={entry}
            group={group}
            onSelectGroup={(next) =>
              setGroup((prev) => (prev === next ? null : next))
            }
            pending={pending}
          />
        )}
      </Skeleton>
    </div>
  );
}

export function WatchedTab({
  entries,
  listError,
  refreshList,
  selected,
  onSelect,
  onRemove,
  removeError,
  onEdit,
  onTrack,
  onSetDefault,
  snapshot,
  isPending,
  error,
  refresh,
  atLimit = false,
  isRefreshing = false,
}: {
  entries: WatchlistEntry[] | null;
  listError: unknown;
  refreshList: () => void;
  selected: WatchlistEntry | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void | Promise<unknown>;
  removeError: unknown;
  onEdit: (entry: WatchedCardEntry, event?: MouseEvent) => void;
  onTrack: (event?: MouseEvent) => void;
  /** Marks the default a fresh visit opens to. Resolves once the write
   * settles, so the menu can ride check → spinner → blue filled check. */
  onSetDefault: (id: string, next: boolean) => void | Promise<unknown>;
  snapshot: PortfolioSnapshot | null;
  isPending: boolean;
  error: unknown;
  refresh: () => void;
  /** Five addresses at most: the hollow slot retires when full. */
  atLimit?: boolean;
  isRefreshing?: boolean;
}) {
  // Card order stays put while the id set is unchanged: a set-default
  // write re-sorts the server list default-first, but the row must not
  // jump — the new order takes effect on the next reload instead.
  const [cardOrder, setCardOrder] = useState<string[] | null>(null);
  if (entries) {
    const sameSet =
      cardOrder !== null &&
      cardOrder.length === entries.length &&
      cardOrder.every((id) => entries.some((entry) => entry.id === id));
    if (!sameSet) {
      setCardOrder(entries.map((entry) => entry.id));
    }
  }
  const displayEntries = useMemo(() => {
    if (!entries) return [];
    if (!cardOrder) return entries;
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const ordered: WatchlistEntry[] = [];
    for (const id of cardOrder) {
      const found = byId.get(id);
      if (found) ordered.push(found);
    }
    // Brand-new ids tracked since the order was taken append at the end.
    for (const entry of entries) {
      if (!cardOrder.includes(entry.id)) ordered.push(entry);
    }
    return ordered;
  }, [entries, cardOrder]);

  // Two-step removal, like trash: the row only asks, the dialog deletes.
  const [confirmEntry, setConfirmEntry] = useState<Pick<
    WatchlistEntry,
    "id" | "chain" | "address" | "label"
  > | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmRemove = () => {
    if (!confirmEntry || deleting) return;
    setDeleting(true);
    void Promise.resolve(onRemove(confirmEntry.id)).finally(() => {
      setDeleting(false);
      setConfirmEntry(null);
    });
  };

  if (!entries) {
    if (listError) {
      return (
        <div className="flex min-h-[30vh] flex-col items-center justify-center px-4 py-12 text-center">
          <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
            The watchlist is unavailable.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={refreshList}
            className="mt-4"
          >
            Refresh
          </Button>
        </div>
      );
    }
    // Still on its way: the list's own shape holds the tab — cards
    // plus the default account's hero and holdings — so the switcher
    // never jumps when the rows land.
    return <WatchedSkeletonBody />;
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex min-h-[30vh] flex-col items-center justify-center px-4 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
            <IconEye size={18} stroke={1.7} aria-hidden />
          </span>
          <p className="mt-3 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
            Your watchlist is empty.
          </p>
          <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
            Track an address to read its public balances.
          </p>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={onTrack}
            className="mt-4"
          >
            Track
          </Button>
        </div>
        {removeError ? (
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            {removeError instanceof Error
              ? removeError.message
              : "The address could not be removed."}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The list is the outer read and owns its own skeleton. Its id is
        * separate from the detail's, so deleting the last address never
        * borrows the cards-plus-detail shape and then collapses. */}
      <Skeleton
        id="portfolio:watched:list"
        data={entries}
        sample={SAMPLE_WATCHED}
        label="Reading watchlist."
      >
        {() => (
          <WatchedCards
            entries={displayEntries}
            selectedId={selected?.id ?? null}
            onSelect={onSelect}
            onEdit={onEdit}
            onDeleteRequest={setConfirmEntry}
            onAdd={onTrack}
            onSetDefault={(entry, next) => onSetDefault(entry.id, next)}
            atLimit={atLimit}
          />
        )}
      </Skeleton>
      <WatchedDetailSlot
        entry={selected}
        snapshot={snapshot}
        isPending={isPending}
        error={error}
        refresh={refresh}
        isRefreshing={isRefreshing}
      />
      {removeError ? (
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          {removeError instanceof Error
            ? removeError.message
            : "The address could not be removed."}
        </p>
      ) : null}
      {confirmEntry ? (
        <DialogShell
          label="Delete address"
          title="Delete address?"
          icon={
            <IconTrash
              size={14}
              stroke={2}
              className="shrink-0 text-red"
              aria-hidden
            />
          }
          subtitle={`Are you sure you want to remove ${confirmEntry.label ?? truncateTechData(confirmEntry.address, confirmEntry.chain)} from your watchlist? You can track it again at any time.`}
          onClose={() => {
            if (!deleting) setConfirmEntry(null);
          }}
          busy={deleting}
          footer={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmEntry(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={confirmRemove}
                disabled={deleting}
              >
                {deleting ? (
                  <span className="inline-flex items-center gap-1.5">
                    <IconLoader2
                      size={14}
                      stroke={2}
                      className="animate-spin"
                    />
                    Delete
                  </span>
                ) : (
                  "Delete"
                )}
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
}

export default WatchedTab;
