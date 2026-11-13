"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { IconEye, IconLoader2, IconTrash } from "@tabler/icons-react";
import { Skeleton } from "skullet/react";
import { Button } from "@/components/atoms/Button";
import { DialogShell } from "@/components/app/DialogShell";
import { truncateTechData } from "@/components/atoms/TechDataChip";
import { WatchedCards, type WatchedCardEntry } from "@/components/finance/WatchedCards";
import type { WatchlistEntry } from "./useWatchlist";

/* ─────────────────────────────────────────────────────────
 * WATCHED TAB
 * The watchlist as cards, plus the dialogs that manage them.
 * The selected account's detail is not owned here: it feeds the
 * shared portfolio chrome above, so the address and total can
 * morph across tabs. This section replays the entrance when the
 * tab is entered; the card list updating underneath never does.
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
  atLimit = false,
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
  /** Five addresses at most: the hollow slot retires when full. */
  atLimit?: boolean;
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
  // The dialog rides check → spinner → notice, like sign-in: the success
  // notice reads first, then the dialog fades as the list settles, so the
  // card delete and the dialog close land together instead of apart.
  const [confirmEntry, setConfirmEntry] = useState<Pick<
    WatchlistEntry,
    "id" | "chain" | "address" | "label" | "resolvedName"
  > | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const locked = deleting || succeeded;
  const notice = succeeded || deleteError;

  // The success notice reads first, then the dialog fades out and closes.
  useEffect(() => {
    if (!succeeded) return;
    const fade = window.setTimeout(() => setLeaving(true), 850);
    const done = window.setTimeout(() => {
      setConfirmEntry(null);
      setSucceeded(false);
      setDeleteError(null);
      setLeaving(false);
    }, 1100);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [succeeded]);

  const requestDelete = (
    entry: Pick<
      WatchlistEntry,
      "id" | "chain" | "address" | "label" | "resolvedName"
    >,
  ) => {
    setDeleteError(null);
    setSucceeded(false);
    setLeaving(false);
    setConfirmEntry(entry);
  };

  const closeConfirm = () => {
    if (locked) return;
    setConfirmEntry(null);
    setDeleteError(null);
  };

  const confirmRemove = () => {
    if (!confirmEntry || locked) return;
    setDeleting(true);
    setDeleteError(null);
    void Promise.resolve(onRemove(confirmEntry.id)).then(
      () => setSucceeded(true),
      (cause: unknown) =>
        setDeleteError(
          cause instanceof Error
            ? cause.message
            : "The address could not be removed.",
        ),
    ).finally(() => setDeleting(false));
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
          // The page-level entrance owns the tab change; selecting or
          // updating a card under it never remounts this list.
          <WatchedCards
            entries={displayEntries}
            selectedId={selected?.id ?? null}
            onSelect={onSelect}
            onEdit={onEdit}
            onDeleteRequest={requestDelete}
            onAdd={onTrack}
            onSetDefault={(entry, next) => onSetDefault(entry.id, next)}
            atLimit={atLimit}
          />
        )}
      </Skeleton>
      {selected ? null : (
        <p className="px-4 py-10 text-center text-[13px] leading-relaxed text-ink-3">
          Select an address to view its public portfolio.
        </p>
      )}
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
          subtitle={`Are you sure you want to remove ${confirmEntry.label ?? confirmEntry.resolvedName ?? truncateTechData(confirmEntry.address, confirmEntry.chain)} from your watchlist? You can track it again at any time.`}
          onClose={closeConfirm}
          busy={locked}
          leaving={leaving}
          footer={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeConfirm}
                disabled={locked}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={confirmRemove}
                disabled={locked}
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
        >
          {/* the notice grows the dialog instead of jumping it */}
          <div
            className="grid"
            style={{
              gridTemplateRows: notice ? "1fr" : "0fr",
              transition: "grid-template-rows 240ms var(--ease-out-strong)",
            }}
          >
            <div className="min-h-0 overflow-hidden">
              {succeeded ? (
                <p
                  key="ok"
                  className="mt-3 rounded-[8px] bg-green-tint px-3 py-2 text-[13px] text-ink"
                  style={{ animation: "fade-in 180ms ease-out both" }}
                >
                  Address removed.
                </p>
              ) : deleteError ? (
                <p
                  key={deleteError}
                  className="mt-3 rounded-[8px] bg-red-tint px-3 py-2 text-[13px] text-ink"
                  style={{ animation: "fade-in 180ms ease-out both" }}
                >
                  {deleteError}
                </p>
              ) : null}
            </div>
          </div>
        </DialogShell>
      ) : null}
    </div>
  );
}

export default WatchedTab;
