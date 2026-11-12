"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "skullet/react";
import { IconChevronLeft, IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { SegmentedControl } from "@/components/atoms/SegmentedControl";
import {
  PORTFOLIO_TABS,
  portfolioTabIcons,
  type PortfolioTab,
} from "@/components/app/PortfolioSkeletonBody";
import SidebarNav from "@/components/primitives/SidebarNav";
import { AccountControl } from "@/components/app/AccountControl";
import { openWalletPicker } from "@/components/app/ConnectGate";
import { PasskeyPortfolio } from "@/components/app/PasskeyPortfolio";
import { PortfolioHero, BalancesTitleRow, type AllocationGroup } from "@/components/finance/PortfolioHero";
import {
  HoldingsTable,
  flattenGroups,
} from "@/components/finance/HoldingsTable";
import { SuperAccountTab } from "@/components/app/SuperAccountTab";
import { WatchedTab } from "@/components/app/WatchedTab";
import type { WatchedCardEntry } from "@/components/finance/WatchedCards";
import { TrackDialog } from "@/components/app/TrackDialog";
import { useAuth } from "@/lib/auth/auth-provider";
import { openSignIn } from "@/components/app/SignInDialog";
import { openPasskeyDialog } from "@/components/app/PasskeyDialog";
import { usePasskeysAvailable } from "@/lib/auth/passkey-client";
import {
  THREADS_QUERY_KEY,
  TRASHED_QUERY_KEY,
  useThreads,
  useTrashed,
} from "@/components/app/threadQueries";
import {
  deleteCachedMessages,
  findThreadLabel,
  prefetchThread,
  readThreadsCache,
  readTrashedCache,
  writeThreadsCache,
  writeTrashedCache,
  type ThreadItem,
  type TrashedItem,
} from "@/components/app/threadCache";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";
import { MAX_WATCHLIST_ENTRIES } from "@/lib/wallet/addresses";
import { accountScope } from "@/lib/auth/session-identity";
import {
  PORTFOLIO_QUERY_KEY,
  usePortfolio,
  useWatchedPortfolio,
} from "./portfolioQueries";
import { useWatchlist, type WatchlistEntry } from "./useWatchlist";
import {
  SAMPLE_PORTFOLIO,
  fetchPortfolio,
  portfolioScope,
  readPortfolioRowCount,
  sampleGroupsWithRows,
  type PortfolioSnapshot,
} from "./portfolioCache";

/* ─────────────────────────────────────────────────────────
 * PORTFOLIO
 * Tabbed holdings: the connected wallet beside the super account
 * that settles through NEAR Intents, or the private balance of a
 * passkey account. Tabs, hero, and table are distilled from the
 * segmented control, allocation card, filter table, and search list.
 * A wallet reads nothing until it is connected and signed in.
 * ───────────────────────────────────────────────────────── */

/* The tab lives in the URL so a reload lands back on it, with replace and
 * never push. The watched selection never does: it lives in memory for
 * the session and falls back to the stored default on a fresh visit, so
 * no address can leak through a copied link. The opening tab arrives
 * from the server instead (see the page): reading it here on mount
 * would first paint the wallet and then flip. */
function writeTabParams(tab: PortfolioTab) {
  const params = new URLSearchParams(window.location.search);
  params.set(
    "tab",
    tab === "Super account" ? "super" : tab === "Watchlist" ? "watched" : "wallet",
  );
  params.delete("address");
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}?${params.toString()}`,
  );
}

export type WatchControls = {
  entries: WatchlistEntry[] | null;
  listError: unknown;
  refreshList: () => void;
  selected: WatchlistEntry | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  removeError: unknown;
  onEdit: (entry: WatchedCardEntry, event?: React.MouseEvent) => void;
  onTrack: (event?: React.MouseEvent) => void;
  /** Marks the default a fresh visit opens to. Resolves once the write
   * settles, so the menu can ride check → spinner → blue filled check. */
  onSetDefault: (id: string, next: boolean) => void | Promise<unknown>;
  snapshot: PortfolioSnapshot | null;
  snapshotPending: boolean;
  snapshotError: unknown;
  refreshSnapshot: () => void;
  atLimit: boolean;
  isRefreshing?: boolean;
};

/* The wallet side owns its own skeleton: the switcher above it never
 * unmounts, so the tab the user picked keeps its real control while the
 * rows arrive. One stable id means a returning visit paints the account's
 * last real shape instead of the sample's five rows. */
function WalletPanel({
  snapshot,
  rows,
  group,
  onToggleGroup,
  onRefresh,
  refreshing = false,
}: {
  snapshot: PortfolioSnapshot | null;
  /** The last read's row count, so a cold skeleton matches this table. */
  rows: number | null;
  group: AllocationGroup | null;
  onToggleGroup: (next: AllocationGroup) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const pending = snapshot === null;
  const sample = useMemo(() => {
    if (!pending) return SAMPLE_PORTFOLIO;
    const walletGroups = sampleGroupsWithRows(
      SAMPLE_PORTFOLIO.walletGroups ?? [],
      rows,
    );
    return {
      ...SAMPLE_PORTFOLIO,
      groups: walletGroups,
      walletGroups,
    };
  }, [pending, rows]);

  return (
    <Skeleton
      id="portfolio:wallet"
      data={snapshot}
      sample={sample}
      label="Reading your balances."
    >
      {(loaded) => {
        const groups =
          loaded.walletGroups ??
          loaded.groups.filter((entry) => entry.name !== "Settlement Ledger");
        const items = flattenGroups(groups);
        const total =
          loaded.walletUsd ??
          Number.parseFloat(
            groups
              .reduce(
                (sum, entry) =>
                  sum +
                  entry.items.reduce((sub, item) => sub + item.valueUsd, 0),
                0,
              )
              .toFixed(2),
          );
        return (
          <div className="flex flex-col gap-3">
            <BalancesTitleRow onRefresh={onRefresh} refreshing={refreshing} />
            <PortfolioHero
              total={total}
              count={items.length}
              scope="wallet"
              items={items}
              selected={group}
              onSelect={onToggleGroup}
              animate={!pending}
            />
            <HoldingsTable
              groups={groups}
              group={group}
              animate={!pending}
            />
          </div>
        );
      }}
    </Skeleton>
  );
}

function PortfolioBody({
  snapshot,
  walletIcon,
  chain,
  address,
  tab,
  onTabChange,
  onRefresh,
  isRefreshing = false,
  watch,
}: {
  snapshot: PortfolioSnapshot | null;
  walletIcon?: string;
  chain: string | null;
  address: string | null;
  tab: PortfolioTab;
  onTabChange: (next: PortfolioTab) => void;
  /** Re-reads the public balances; each tab titles it the same way. */
  onRefresh: () => void;
  /** That public re-read is in flight. */
  isRefreshing?: boolean;
  watch: WatchControls;
}) {
  // Bar selection doubles as the table filter; null shows everything.
  // Switching tabs keeps the group — stables are stables on either side.
  const [group, setGroup] = useState<AllocationGroup | null>(null);
  const scope = chain && address ? portfolioScope(chain, address) : null;
  // The last settled row counts are read even when the public snapshot is
  // present: the super account's private read can still be pending, and
  // its skeleton should reserve the merged table's height, not the sample's.
  const walletRows = readPortfolioRowCount(scope, "wallet");
  const superRows = readPortfolioRowCount(scope, "super");
  // The selected pill is part of the loaded state, not the skeleton: fade
  // it in when the active tab has data, and leave the switcher bland until
  // then. The watchlist is ready when its list lands; wallet and super when
  // the public snapshot does.
  const tabReady =
    tab === "Watchlist" ? watch.entries !== null : snapshot !== null;

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        options={PORTFOLIO_TABS}
        value={tab}
        onChange={onTabChange}
        icons={portfolioTabIcons(walletIcon)}
        className="self-start"
        showSelection={tabReady}
      />
      {/* This wrapper mounts once with the table, and again only when the
        * tab key changes. Data landing under it never remounts it, so the
        * reveal is skullet's alone instead of a second fade-up. */}
      <div
        key={tab}
        className="flex flex-col gap-3 animate-[fade-up_250ms_cubic-bezier(0.23,1,0.32,1)]"
      >
        {tab === "Your wallet" ? (
          <WalletPanel
            snapshot={snapshot}
            rows={walletRows}
            group={group}
            onToggleGroup={(next) =>
              setGroup((prev) => (prev === next ? null : next))
            }
            onRefresh={onRefresh}
            refreshing={isRefreshing}
          />
        ) : tab === "Super account" ? (
          <SuperAccountTab
            chain={chain}
            address={address}
            publicGroups={snapshot?.superGroups ?? []}
            publicPending={snapshot === null}
            publicRefreshing={isRefreshing}
            sampleRows={superRows}
            group={group}
            onToggleGroup={(next) =>
              setGroup((prev) => (prev === next ? null : next))
            }
            onRefresh={onRefresh}
          />
        ) : (
          <WatchedTab
            entries={watch.entries}
            listError={watch.listError}
            refreshList={watch.refreshList}
            selected={watch.selected}
            onSelect={watch.onSelect}
            onRemove={watch.onRemove}
            removeError={watch.removeError}
            onEdit={watch.onEdit}
            onTrack={watch.onTrack}
            onSetDefault={watch.onSetDefault}
            snapshot={watch.snapshot}
            isPending={watch.snapshotPending}
            error={watch.snapshotError}
            refresh={watch.refreshSnapshot}
            atLimit={watch.atLimit}
            isRefreshing={watch.isRefreshing}
          />
        )}
      </div>
    </div>
  );
}

export default function PortfolioView({
  initialTab = "Your wallet",
}: {
  /** The `?tab=` value the server read: first paint already agrees. */
  initialTab?: PortfolioTab;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: threads = [] } = useThreads();
  const { data: trashed = [] } = useTrashed();
  const { account, connected, signedIn, status, identity } = useAuth();
  const passkeys = usePasskeysAvailable();
  const passkeyIdentity = identity?.kind === "passkey" ? identity : null;
  const passkeyAccount = passkeyIdentity !== null;
  const accountAddress = account?.address;
  const accountKind = account?.kind;

  const portfolio = usePortfolio(
    accountKind ?? null,
    accountAddress ?? null,
    !passkeyAccount && connected && signedIn,
  );
  const snapshot = portfolio.snapshot;
  const walletIcon = account?.walletIcon ?? undefined;
  const passkeySignIn = !connected && passkeys;

  // The tab and the watchlist selection both live in the URL, replaced
  // and never pushed, so a reload lands back on the same account.
  // Refresh lives in each section beside its title now, not the header:
  // the watchlist already tracks from its own card, and every tab
  // re-reads from the same row.
  const [tab, setTab] = useState<PortfolioTab>(initialTab);
  const [watchSelected, setWatchSelected] = useState<string | null>(null);
  const [trackOpen, setTrackOpen] = useState(false);
  const [trackOrigin, setTrackOrigin] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [editEntry, setEditEntry] = useState<WatchedCardEntry | null>(null);
  const [editOrigin, setEditOrigin] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const watchEnabled = !passkeyAccount && connected && signedIn;
  const watchlist = useWatchlist(watchEnabled);
  const watchAtLimit =
    (watchlist.entries?.length ?? 0) >= MAX_WATCHLIST_ENTRIES;
  // The default is applied once per list: the first address paints the
  // detail so the tab is never empty, then the selection belongs to the
  // user — an explicit deselect stays empty until the next click.
  const defaultAppliedRef = useRef(false);
  const selectedEntry = useMemo(
    () => watchlist.entries?.find((entry) => entry.id === watchSelected) ?? null,
    [watchlist.entries, watchSelected],
  );
  const watched = useWatchedPortfolio(
    selectedEntry?.chain ?? null,
    selectedEntry?.address ?? null,
    // The watched balance reads only on its own tab with an account
    // selected: opening the portfolio never fetches it behind the wallet.
    watchEnabled && tab === "Watchlist" && selectedEntry !== null,
  );

  // Scrub once on mount (never during render, or hydration disagrees
  // with the server). A stale address param from an old shared link is
  // removed here: the selection never reads it.
  useEffect(() => {
    writeTabParams(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The default account: the list arrives default-first, so the first
  // entry is the stored default and selects itself once the list lands.
  // The tab then never opens empty. It runs only when no selection
  // exists yet; afterwards the cards own it for the session.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time default like the tab read above */
  useEffect(() => {
    if (defaultAppliedRef.current) return;
    if (watchSelected || !watchlist.entries) return;
    const first = watchlist.entries[0];
    if (!first) return;
    defaultAppliedRef.current = true;
    setWatchSelected(first.id);
  }, [watchSelected, watchlist.entries]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The selected card owns the urgent read through `useWatchedPortfolio`;
  // this warms the remaining cards behind it so a switch usually lands on
  // a cached snapshot instead of the previous card's numbers. Queued in a
  // timeout plus an idle window so the current balance wins the connection
  // first. Gated to the Watchlist tab like the urgent read, and capped by
  // the five-address list limit.
  useEffect(() => {
    if (!watchEnabled || tab !== "Watchlist") return;
    const list = watchlist.entries;
    if (!list || list.length < 2) return;
    const selectedId = selectedEntry?.id ?? list[0]?.id;
    const rest = list.filter((entry) => entry.id !== selectedId);
    if (rest.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const warm = () => {
        if (cancelled) return;
        for (const entry of rest) {
          const scope = `watched:${accountScope(entry.chain, entry.address)}`;
          void queryClient.prefetchQuery({
            queryKey: [...PORTFOLIO_QUERY_KEY, scope],
            queryFn: () => fetchPortfolio(entry.address, entry.chain),
            staleTime: 60_000,
          });
        }
      };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(warm, { timeout: 2000 });
      } else {
        warm();
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [watchEnabled, tab, watchlist.entries, selectedEntry?.id, queryClient]);

  const handleTab = (next: PortfolioTab) => {
    setTab(next);
    writeTabParams(next);
    if (next === "Watchlist" && !watchSelected) {
      // Entering with nothing selected falls back to the default, so
      // the tab never lands empty when addresses are tracked.
      const first = watchlist.entries?.[0];
      if (first) {
        defaultAppliedRef.current = true;
        setWatchSelected(first.id);
      }
    }
  };

  const selectWatch = (id: string | null) => {
    // In-memory last-active: the session keeps the latest click until
    // reload, when the stored default takes over again.
    setWatchSelected(id);
    writeTabParams("Watchlist");
  };

  const removeWatch = (id: string) => {
    // The rows left after this one become the fallback, so the detail
    // keeps a default instead of emptying on every delete.
    const remaining =
      watchlist.entries?.filter((entry) => entry.id !== id) ?? null;
    void watchlist.remove(id).then(() => {
      // The detail unmounts with its row; anything left keeps the list.
      if (watchSelected === id) {
        const next = remaining?.[0] ?? null;
        setWatchSelected(next ? next.id : null);
        writeTabParams("Watchlist");
      }
    });
  };

  const setDefaultWatch = (id: string, next: boolean) =>
    watchlist.setDefault({ id, isDefault: next }).then(() => {
      // The list re-sorts default-first; the in-memory selection keeps
      // its row by id, so nothing here reselects.
    });

  // Both dialogs grow from their trigger's viewport point, clamped to
  // their own edge, so each opens in the general direction of the click
  // instead of always the center. Keyboard opens carry no point and stay
  // centered.
  const pointOf = (event?: React.MouseEvent) =>
    event && (event.clientX !== 0 || event.clientY !== 0)
      ? { x: event.clientX, y: event.clientY }
      : null;

  // The dialog grows from the trigger's viewport point, clamped to its
  // own edge, so it opens in the general direction of the click instead
  // of always the center. Keyboard opens carry no point and stay centered.
  const openTrack = (event?: React.MouseEvent) => {
    setTrackOrigin(pointOf(event));
    setTrackOpen(true);
  };

  const openEdit = (entry: WatchedCardEntry, event?: React.MouseEvent) => {
    setEditOrigin(pointOf(event));
    setEditEntry(entry);
  };

  const trackEntry = (input: {
    chain: WatchlistEntry["chain"];
    address: string;
    label?: string;
  }) =>
    watchlist.add(input).then((entry) => {
      setWatchSelected(entry.id);
      writeTabParams("Watchlist");
      return entry;
    });

  // Edit saves through the same dialog, prefilled: the label, the
  // address, or both may have changed. A blanked label keeps the old
  // one rather than failing validation. The row keeps its id, so the
  // selection and the detail below stay put.
  const saveEdit = (
    entry: WatchedCardEntry,
    input: {
      chain: WatchlistEntry["chain"];
      address: string;
      label?: string;
    },
  ) =>
    watchlist
      .update({
        id: entry.id,
        label: input.label ?? entry.label ?? "",
        chain: input.chain,
        address: input.address,
      })
      .then((updated) => {
        writeTabParams("Watchlist");
        return updated;
      });
  // Sidebar thread management: same rename/delete the chat pages use, so
  // the kebab renders (SidebarNav hides it when both are missing) and
  // hover prefetches the thread history.
  const renameThread = useCallback(
    (id: string, next: string) => {
      const cleaned = next.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      if (!cleaned) return;
      const current = findThreadLabel(id);
      if (current != null && cleaned === current.trim()) return;
      const prevThreads = queryClient.getQueryData<ThreadItem[]>(THREADS_QUERY_KEY);
      const prevCache = readThreadsCache();
      queryClient.setQueryData<ThreadItem[]>(THREADS_QUERY_KEY, (old) => {
        if (!old) return old;
        if (!old.some((t) => t.id === id)) return old;
        return old.map((t) => (t.id === id ? { ...t, label: cleaned } : t));
      });
      if (prevCache.some((t) => t.id === id)) {
        writeThreadsCache(
          prevCache.map((t) => (t.id === id ? { ...t, label: cleaned } : t)),
        );
      }
      void fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: cleaned }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("rename failed");
        })
        .catch(() => {
          if (prevThreads) queryClient.setQueryData(THREADS_QUERY_KEY, prevThreads);
          writeThreadsCache(prevCache);
        });
    },
    [queryClient],
  );

  const deleteThread = useCallback(
    (id: string) => {
      const label =
        queryClient.getQueryData<ThreadItem[]>(THREADS_QUERY_KEY)?.find((t) => t.id === id)?.label ??
        findThreadLabel(id) ??
        "New chat";
      void fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
        .then(async (res) => {
          if (!res.ok) throw new Error("delete failed");
          let deletedAt = new Date().toISOString();
          try {
            const body = (await res.json()) as { deletedAt?: string };
            if (typeof body?.deletedAt === "string" && body.deletedAt) {
              deletedAt = body.deletedAt;
            }
          } catch {
            // DELETE succeeded; fall back to now for the trash ordering.
          }
          return deletedAt;
        })
        .then((deletedAt) => {
          deleteCachedMessages(id);
          const entry: TrashedItem = { id, label, deletedAt };
          queryClient.setQueryData<ThreadItem[]>(THREADS_QUERY_KEY, (old) =>
            old ? old.filter((t) => t.id !== id) : old,
          );
          writeThreadsCache(readThreadsCache().filter((t) => t.id !== id));
          queryClient.setQueryData<TrashedItem[]>(TRASHED_QUERY_KEY, (old) =>
            old ? [entry, ...old.filter((t) => t.id !== id)] : [entry],
          );
          const prevTrashed = readTrashedCache().filter((t) => t.id !== id);
          writeTrashedCache([entry, ...prevTrashed]);
        })
        .catch(() => {
          // No list change was made, so nothing to roll back. SidebarNav's
          // safety timer releases the collapsed row so it glides back.
        });
    },
    [queryClient],
  );
  const signInPrompt = (
    <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
        <IconWallet size={18} stroke={1.7} aria-hidden />
      </span>
      <h2 className="mt-3 text-[15px] font-medium text-ink">
        Portfolio &amp; Balances
      </h2>
      <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
        Please log in to view your portfolio and balances.
      </p>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={passkeySignIn ? openPasskeyDialog : openSignIn}
        className="mt-4"
      >
        Log In
      </Button>
    </div>
  );

  const body = (
    <PortfolioBody
      snapshot={snapshot}
      walletIcon={walletIcon}
      chain={accountKind ?? null}
      address={accountAddress ?? null}
      tab={tab}
      onTabChange={handleTab}
      onRefresh={() => void portfolio.refresh()}
      isRefreshing={portfolio.isRefreshing}
      watch={{
        entries: watchlist.entries,
        listError: watchlist.error,
        refreshList: () => void watchlist.refresh(),
        selected: selectedEntry,
        onSelect: selectWatch,
        onRemove: removeWatch,
        removeError: watchlist.removeError,
        onEdit: openEdit,
        onTrack: openTrack,
        onSetDefault: setDefaultWatch,
        snapshot: watched.snapshot,
        snapshotPending: watched.isPending,
        snapshotError: watched.error,
        refreshSnapshot: () => void watched.refresh(),
        atLimit: watchAtLimit,
        isRefreshing: watched.isRefreshing,
      }}
    />
  );

  return (
    <main className="flex h-[100dvh] gap-0 bg-canvas p-2.5 text-ink lg:pl-0">
      <SidebarNav
        fill
        className="hidden lg:flex"
        recents={threads.map((t) => ({ id: t.id, label: t.label ?? "New chat" }))}
        onPick={(id) => router.push(`/chat/${encodeURIComponent(id)}`)}
        onNewChat={() => router.push("/")}
        onHoverThread={prefetchThread}
        onRenameChat={renameThread}
        onDeleteChat={deleteThread}
        onOpenPortfolio={() => router.push("/portfolio")}
        portfolioActive
        onOpenHistory={() => router.push("/history")}
        trashCount={trashed.length}
        onOpenTrash={() => router.push("/trash")}
        footer={<AccountControl />}
        footerCompact={<AccountControl compact />}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
          <header className="flex h-11 shrink-0 items-center border-b border-line px-4">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => router.push("/")}
                aria-label="Back to chat"
                className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink lg:hidden"
              >
                <IconChevronLeft size={16} stroke={2} />
              </button>
              <span className="flex size-5 shrink-0 items-center justify-center text-ink-3">
                <IconWallet size={17} stroke={1.7} />
              </span>
              <h1 className="truncate text-[14px] font-medium text-ink">
                Portfolio
              </h1>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-4 py-4 sm:px-6 [scrollbar-gutter:stable]">
            <div className="w-full">
              {passkeyIdentity ? (
                <PasskeyPortfolio accountId={passkeyIdentity.accountId} />
              ) : status === "unknown" ? (
                // A signed-in reload starts here while the wallet and the
                // cookie are still being read. Painting the log-in prompt
                // first (the old order) made a returning user watch their
                // own account turn into "Please log in" and back. The real
                // per-tab skeleton holds the shape, with its remembered id.
                body
              ) : !connected || !accountAddress ? (
                <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
                  <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
                    <IconWallet size={18} stroke={1.7} aria-hidden />
                  </span>
                  <h2 className="mt-3 text-[15px] font-medium text-ink">
                    Portfolio &amp; Balances
                  </h2>
                  <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
                    Please log in to view your portfolio and balances.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={openWalletPicker}
                    className="mt-4"
                  >
                    Log In
                  </Button>
                </div>
              ) : !signedIn ? (
                signInPrompt
              ) : portfolio.authExpired ? (
                signInPrompt
              ) : portfolio.error && snapshot === null && tab !== "Watchlist" ? (
                <HoldingsTable
                  groups={[]}
                  error
                  onRetry={() => void portfolio.refresh()}
                />
              ) : (
                body
              )}
            </div>
          </div>
        </section>
        {trackOpen ? (
          <TrackDialog
            open
            onClose={() => setTrackOpen(false)}
            onTrack={trackEntry}
            origin={trackOrigin}
            atLimit={watchAtLimit}
          />
        ) : null}
        {editEntry ? (
          <TrackDialog
            key={editEntry.id}
            open
            title="Edit address"
            submitLabel="Save"
            failureMessage="The address could not be saved."
            initial={{
              chain: editEntry.chain,
              address: editEntry.address,
              label: editEntry.label,
            }}
            onClose={() => {
              setEditEntry(null);
              setEditOrigin(null);
            }}
            onTrack={(input) => saveEdit(editEntry, input)}
            origin={editOrigin}
          />
        ) : null}
      </div>
    </main>
  );
}
