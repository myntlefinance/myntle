"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "skullet/react";
import { IconChevronLeft, IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { SegmentedControl } from "@/components/atoms/SegmentedControl";
import {
  PASSKEY_PORTFOLIO_TABS,
  PORTFOLIO_TABS,
  portfolioTabIcons,
  type PortfolioTab,
} from "@/components/app/PortfolioSkeletonBody";
import SidebarNav from "@/components/primitives/SidebarNav";
import { AccountControl } from "@/components/app/AccountControl";
import { openWalletPicker } from "@/components/app/ConnectGate";
import { PortfolioChrome } from "@/components/app/PortfolioChrome";
import type { AllocationGroup } from "@/components/finance/PortfolioHero";
import {
  HoldingsTable,
  flattenGroups,
} from "@/components/finance/HoldingsTable";
import { WatchedTab } from "@/components/app/WatchedTab";
import EarnVaults from "@/components/finance/EarnVaults";
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
import { useRoutePrefetch } from "@/components/app/routePrefetch";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";
import { MAX_WATCHLIST_ENTRIES } from "@/lib/wallet/addresses";
import { accountScope } from "@/lib/auth/session-identity";
import {
  PORTFOLIO_QUERY_KEY,
  usePortfolio,
  useWatchedPortfolio,
} from "./portfolioQueries";
import { useSuperAccountView } from "./useSuperAccountView";
import { useWatchedDetailView } from "./useWatchedDetailView";
import { useWatchlist, type WatchlistEntry } from "./useWatchlist";
import {
  SAMPLE_PORTFOLIO,
  fetchPortfolio,
  portfolioScope,
  readPortfolioRowCount,
  sampleGroupsWithRows,
  type PortfolioSnapshot,
} from "./portfolioCache";
import { isIntentsGroupName } from "@/lib/wallet/balances";
import type { ChainKind } from "@/lib/wallet/types";

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

function PortfolioBody({
  snapshot,
  walletIcon,
  chain,
  address,
  passkeyAccountId = null,
  tab,
  onTabChange,
  onRefresh,
  isRefreshing = false,
  watch,
}: {
  snapshot: PortfolioSnapshot | null;
  walletIcon?: string;
  chain: ChainKind | null;
  address: string | null;
  /** A passkey account has no connected wallet, so its confidential
   * ledger is the whole portfolio rather than one tab of it. */
  passkeyAccountId?: string | null;
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
  const toggleGroup = (next: AllocationGroup) =>
    setGroup((prev) => (prev === next ? null : next));
  const passkey = passkeyAccountId !== null;
  // A passkey account reads its private ledger with the User-Session
  // under the `passkey` scope; a wallet's super account under its chain.
  const superChain: string | null = passkey ? "passkey" : chain;
  const superAddress = passkey ? passkeyAccountId : address;
  const scope = chain && address ? portfolioScope(chain, address) : null;
  const superScope =
    superChain && superAddress
      ? portfolioScope(superChain, superAddress)
      : null;
  // The last settled row counts are read even when the public snapshot is
  // present: the super account's private read can still be pending, and
  // its skeleton should reserve the merged table's height, not the sample's.
  const walletRows = readPortfolioRowCount(scope, "wallet");
  const superRows = readPortfolioRowCount(superScope, "super");

  // Only a real snapshot feeds the table. The sample below is measured by
  // the skeleton and never rendered as a balance; a missing read is an
  // empty state, never a template of someone else's money.
  const walletGroups = useMemo(() => {
    if (!snapshot) return [];
    return (
      snapshot.walletGroups ??
      snapshot.groups.filter((entry) => !isIntentsGroupName(entry.name))
    );
  }, [snapshot]);
  const walletSample = useMemo(
    () => ({
      groups: sampleGroupsWithRows(
        SAMPLE_PORTFOLIO.walletGroups ?? [],
        walletRows,
      ),
      totalUsd: SAMPLE_PORTFOLIO.walletUsd ?? 0,
    }),
    [walletRows],
  );
  const walletData = useMemo(() => {
    if (!snapshot) return null;
    return {
      groups: walletGroups,
      totalUsd:
        snapshot.walletUsd ??
        Number.parseFloat(
          flattenGroups(walletGroups)
            .reduce((sum, item) => sum + item.valueUsd, 0)
            .toFixed(2),
        ),
    };
  }, [snapshot, walletGroups]);

  // The super read stays mounted so the private gate and its reads do not
  // restart every time the tab is opened; it only reads while the tab is
  // visible, so opening the portfolio never touches the private ledger.
  const superView = useSuperAccountView({
    chain: superChain,
    address: superAddress,
    publicGroups: passkey ? [] : (snapshot?.superGroups ?? []),
    publicPending: passkey ? false : snapshot === null,
    publicRefreshing: isRefreshing,
    sampleRows: superRows,
    // A passkey account has no public wallet read; its refresh asks the
    // private ledger again, which `refreshAll` already does.
    onRefresh: passkey ? () => {} : onRefresh,
    active: tab === "Super account",
  });

  // The selected pill is part of the loaded state, not the skeleton: fade
  // it in when the active tab has data, and leave the switcher bland until
  // then. The watchlist is ready when its list lands; a wallet and super
  // tab when their reads do.
  const tabReady =
    tab === "Watchlist"
      ? watch.entries !== null
      : passkey
        ? !superView.pending
        : snapshot !== null;

  // The watched detail is shaped for the same chrome. Keeping the hook
  // mounted across tabs lets the address and total morph into the watched
  // account instead of remounting the section.
  const watchedView = useWatchedDetailView({
    entry: watch.selected,
    snapshot: watch.snapshot,
    isPending: watch.snapshotPending,
    error: watch.snapshotError,
    refresh: watch.refreshSnapshot,
    isRefreshing: watch.isRefreshing,
  });

  const isSuper = tab === "Super account";
  const isWatch = tab === "Watchlist";

  // The bar filter belongs to the account on screen, so a new watched
  // account starts clean. Entering or leaving the tab keeps it.
  const watchedId = watchedView?.entry.id ?? null;
  const [filterFor, setFilterFor] = useState<string | null>(null);
  if (watchedId && filterFor === null) {
    setFilterFor(watchedId);
  } else if (watchedId && filterFor !== watchedId) {
    setFilterFor(watchedId);
    setGroup(null);
  }

  const chromeVisible = !isWatch || watchedView !== null;
  // Wallet and super share one layout, so torph carries the address,
  // total, sentence, and pills across that switch. The watchlist is its
  // own layout; crossing either boundary remounts the target page and
  // replays the one entrance.
  const layoutKey = isWatch ? "watchlist" : "accounts";

  return (
    <div className={`flex flex-col ${isWatch ? "gap-6" : "gap-8"}`}>
      <SegmentedControl
        options={passkey ? PASSKEY_PORTFOLIO_TABS : PORTFOLIO_TABS}
        value={tab}
        onChange={onTabChange}
        icons={portfolioTabIcons(walletIcon)}
        className="self-start"
        showSelection={tabReady}
      />
      {/* Same layout: stays mounted so torph can morph. Layout change:
        * remounts the target and replays the page entrance. */}
      <div
        key={layoutKey}
        className="flex flex-col gap-6 animate-[fade-up_380ms_cubic-bezier(0.23,1,0.32,1)_both]"
      >
        {isWatch ? (
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
            atLimit={watch.atLimit}
          />
        ) : null}
      {chromeVisible ? (
        /* Within the watchlist tab this stays mounted across card
         * changes, so torph can morph the identity and totals. */
        <Skeleton
          id={passkey ? "portfolio:passkey" : "portfolio:content"}
          data={
            isWatch
              ? (watchedView?.data ?? null)
              : isSuper
                ? superView.skeletonData
                : walletData
          }
          sample={
            isWatch
              ? (watchedView?.sample ?? walletSample)
              : isSuper
                ? superView.sample
                : walletSample
          }
          label={
            isWatch
              ? (watchedView?.label ?? "Reading public balances.")
              : isSuper
                ? superView.label
                : "Reading your balances."
          }
        >
          {(loaded) => {
            // While the watched sample is on the ghost, measure its rows;
            // once the snapshot is real, the queued hero trails the table.
            const watchLive = isWatch && watchedView?.data != null;
            const heroGroups =
              watchLive && watchedView
                ? watchedView.heroGroups
                : loaded.groups;
            const total =
              watchLive && watchedView
                ? watchedView.total
                : loaded.totalUsd;
            return (
              <PortfolioChrome
                address={
                  isWatch
                    ? (watchedView?.address ?? address)
                    : passkey
                      ? passkeyAccountId
                      : address
                }
                // The subject names a watched card; wallet and super use
                // the account the user is already looking at.
                chain={
                  isWatch
                    ? (watchedView?.entry.chain ?? "evm")
                    : passkey
                      ? "near"
                      : (chain ?? "evm")
                }
                qrTitle={
                  isWatch
                    ? (watchedView?.subject ?? "Watchlist")
                    : isSuper
                      ? "Super account"
                      : "Your wallet"
                }
                scope={isWatch ? "watched" : isSuper ? "super" : "wallet"}
                subject={isWatch ? watchedView?.subject : undefined}
                groups={loaded.groups}
                heroGroups={heroGroups}
                total={total}
                masked={isSuper ? superView.showLock : undefined}
                heroAnimate={
                  isWatch
                    ? (watchedView?.heroAnimate ?? false)
                    : isSuper
                      ? !superView.pending
                      : snapshot !== null
                }
                tableAnimate={
                  isWatch
                    ? (watchedView?.tableAnimate ?? false)
                    : isSuper
                      ? !superView.pending
                      : snapshot !== null
                }
                refreshing={
                  isWatch
                    ? watchedView?.refreshing
                    : isSuper
                      ? superView.refreshing
                      : isRefreshing
                }
                onRefresh={
                  isWatch
                    ? watchedView?.refresh
                    : isSuper
                      ? superView.refreshAll
                      : onRefresh
                }
                bodyKey={
                  isWatch
                    ? `watched:${watchedView?.bodyKey ?? ""}`
                    : isSuper
                      ? "super"
                      : "wallet"
                }
                emptyTitle={
                  isWatch
                    ? "No public holdings found."
                    : passkey && isSuper && !superView.showLock
                      ? "Your private balance is empty. Ask the assistant to deposit."
                      : undefined
                }
                error={
                  isWatch
                    ? watchedView?.failed
                    : isSuper
                      ? superView.failed
                      : undefined
                }
                onRetry={
                  isWatch
                    ? watchedView?.refresh
                    : isSuper
                      ? superView.retryPrivate
                      : undefined
                }
                gate={
                  isSuper && superView.showLock
                    ? { forceLocked: superView.forceLocked }
                    : null
                }
                dimmed={isWatch ? watchedView?.stale : undefined}
                morphDuration={
                  isWatch ? watchedView?.morphDuration : undefined
                }
                group={group}
                onSelectGroup={toggleGroup}
              />
            );
          }}
        </Skeleton>
      ) : null}
        {!isWatch ? <EarnVaults /> : null}
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
  const prefetchRoute = useRoutePrefetch();
  // A chat row is a route here, not a local switch, so resting on one warms
  // both the transcript and the payload that mounts ChatView.
  const hoverThread = useCallback(
    (id: string) => {
      prefetchThread(id);
      prefetchRoute(`/chat/${encodeURIComponent(id)}`);
    },
    [prefetchRoute],
  );
  const queryClient = useQueryClient();
  const { data: threads = [] } = useThreads();
  const { data: trashed = [] } = useTrashed();
  const { account, connected, signedIn, status, identity } = useAuth();
  const passkeys = usePasskeysAvailable();
  const passkeyIdentity = identity?.kind === "passkey" ? identity : null;
  const passkeyAccountId = passkeyIdentity?.accountId ?? null;
  const passkeyAccount = passkeyAccountId !== null;
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
  const [tabState, setTabState] = useState<PortfolioTab>(initialTab);
  // A passkey account has no chain wallet, so the wallet tab is not a
  // place it can open on. The tab reads as the super account from the
  // first frame the identity is known; the effect below settles the URL.
  const tab: PortfolioTab =
    passkeyAccount && tabState === "Your wallet" ? "Super account" : tabState;
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
  // The watchlist belongs to the session, not to a wallet: a passkey
  // account has an account id and a session, so it can track addresses
  // the same way a connected wallet can.
  const watchEnabled = passkeyAccount || (connected && signedIn);
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

  // A passkey session can land after the first client frame, because it
  // is read asynchronously. The wallet tab it may have opened on is not a
  // tab this account has, so settle the state and the URL on the super
  // account instead of leaving an impossible selection behind.
  /* eslint-disable react-hooks/set-state-in-effect -- identity arrival: the tab follows the account kind */
  useEffect(() => {
    if (!passkeyAccount || tabState !== "Your wallet") return;
    setTabState("Super account");
    writeTabParams("Super account");
  }, [passkeyAccount, tabState]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
            staleTime: 300_000,
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
    // A passkey account has no wallet to show.
    if (passkeyAccount && next === "Your wallet") return;
    setTabState(next);
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
    // keeps a default instead of emptying on every delete. Returns the
    // write so the confirm dialog can ride check → spinner → notice
    // instead of closing before the list settles.
    const remaining =
      watchlist.entries?.filter((entry) => entry.id !== id) ?? null;
    return watchlist.remove(id).then(() => {
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

  // The tracked row is already in the cached list when add resolves, so
  // the card paints under the open dialog. Selecting it now starts its
  // detail read; the dialog then holds through one list re-read, so the
  // close reveals the card and its skeleton rather than the empty state.
  const trackEntry = async (input: {
    chain: WatchlistEntry["chain"];
    address: string;
    label?: string;
  }) => {
    const entry = await watchlist.add(input);
    setWatchSelected(entry.id);
    writeTabParams("Watchlist");
    await watchlist.refresh();
    return entry;
  };

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
      passkeyAccountId={passkeyAccountId}
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
        onHoverThread={hoverThread}
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
              {passkeyIdentity || status === "unknown" ? (
                // A signed-in reload starts here while the wallet, the
                // passkey, and the cookie are still being read. Painting
                // the log-in prompt first (the old order) made a returning
                // user watch their own account turn into "Please log in"
                // and back. The real per-tab skeleton holds the shape,
                // with its remembered id.
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
              ) : portfolio.error && snapshot === null && !passkeyAccount && tab !== "Watchlist" ? (
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
