"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "skullet/react";
import { IconChevronLeft, IconHistory } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import SidebarNav from "@/components/primitives/SidebarNav";
import { AccountControl } from "@/components/app/AccountControl";
import { openWalletPicker } from "@/components/app/ConnectGate";
import { openSignIn } from "@/components/app/SignInDialog";
import { openPasskeyDialog } from "@/components/app/PasskeyDialog";
import { usePasskeysAvailable } from "@/lib/auth/passkey-client";
import { useResolvedAssetMeta } from "@/components/app/useAssetMeta";
import { useAuth } from "@/lib/auth/auth-provider";
import { accountScope } from "@/lib/auth/session-identity";
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
import { useHistory } from "./historyQueries";
import { SAMPLE_HISTORY_ROWS } from "./historyCache";
import {
  HistoryList,
  NO_HISTORY_META,
  NO_HISTORY_SYMBOLS,
} from "@/components/app/HistoryList";

/* ─────────────────────────────────────────────────────────
 * HISTORY
 * Every trade and deposit this account has approved, newest
 * first. The same transaction record the chat cards and the
 * assistant read, kept current by the settlement workflow.
 * ───────────────────────────────────────────────────────── */

export default function HistoryView() {
  const router = useRouter();
  const prefetchRoute = useRoutePrefetch();
  // Rows are routes here: warm the transcript and the payload together.
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
  const { connected, signedIn, status, identity } = useAuth();
  const passkeys = usePasskeysAvailable();

  const scope = identity
    ? accountScope(identity.chain, identity.address)
    : null;
  const history = useHistory(scope, signedIn);
  const rows = history.rows;

  const assetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows ?? []) {
      if (row.originAsset) ids.add(row.originAsset);
      if (row.destinationAsset) ids.add(row.destinationAsset);
    }
    return [...ids];
  }, [rows]);
  const meta = useResolvedAssetMeta(assetIds);
  const symbols = useMemo(() => {
    const out = new Map<string, string>();
    for (const [id, m] of meta) {
      if (m.symbol) out.set(id, m.symbol);
    }
    return out;
  }, [meta]);

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

  // One prompt serves both ways of arriving unsigned: connected with no
  // session yet, and a request that came back 401 mid-visit.
  const passkeySignIn = !connected && passkeys;
  const signInPrompt = (
    <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
        <IconHistory size={18} stroke={1.7} aria-hidden />
      </span>
      <h2 className="mt-3 text-[15px] font-medium text-ink">History</h2>
      <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
        Please log in to view your history.
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

  const emptyState = (
    <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
        <IconHistory size={18} stroke={1.7} aria-hidden />
      </span>
      <h2 className="mt-3 text-[15px] font-medium text-ink">
        You have not approved anything yet.
      </h2>
      <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
        Any trade or deposit you approve will land here.
      </p>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={() => router.push("/")}
        className="mt-4"
      >
        Start chat
      </Button>
    </div>
  );

  const skeleton = (
    <Skeleton
      id="history"
      data={null}
      sample={SAMPLE_HISTORY_ROWS}
      label="Reading your history."
    >
      {(sample) => (
        <HistoryList rows={sample} meta={NO_HISTORY_META} symbols={NO_HISTORY_SYMBOLS} />
      )}
    </Skeleton>
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
        onOpenTrash={() => router.push("/trash")}
        onOpenPortfolio={() => router.push("/portfolio")}
        historyActive
        onOpenHistory={() => router.push("/history")}
        trashCount={trashed.length}
        footer={<AccountControl />}
        footerCompact={<AccountControl compact />}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
          <header className="flex h-11 shrink-0 items-center border-b border-line px-4">
            <div className="flex w-full min-w-0 items-center justify-between">
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
                  <IconHistory size={17} stroke={1.7} />
                </span>
                <h1 className="truncate text-[14px] font-medium text-ink">
                  History
                </h1>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-4 py-4 sm:px-6 [scrollbar-gutter:stable]">
            <div className="mx-auto w-full max-w-[860px]">
              {!signedIn ? (
                status === "unknown" ? (
                  skeleton
                ) : connected ? (
                  signInPrompt
                ) : (
                  <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
                    <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
                      <IconHistory size={18} stroke={1.7} aria-hidden />
                    </span>
                    <h2 className="mt-3 text-[15px] font-medium text-ink">
                      History
                    </h2>
                    <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
                      {passkeys
                        ? "Log in with a wallet or a passkey to view your history."
                        : "Please log in to view your history."}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        variant="primary"
                        size="md"
                        onClick={openWalletPicker}
                      >
                        Log In
                      </Button>
                    </div>
                  </div>
                )
              ) : history.authExpired ? (
                signInPrompt
              ) : history.error && rows === null ? (
                <p className="text-[13.5px] leading-relaxed text-ink-2">
                  History is unavailable. Please try again.
                </p>
              ) : (
                <Skeleton
                  id="history"
                  data={rows}
                  sample={SAMPLE_HISTORY_ROWS}
                  empty={rows !== null && rows.length === 0}
                  emptyMessage={emptyState}
                  label="Reading your history."
                >
                  {(loaded) => (
                    <HistoryList rows={loaded} meta={meta} symbols={symbols} />
                  )}
                </Skeleton>
              )}
              {rows !== null && rows.length > 0 && history.hasNextPage ? (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={history.isFetchingNextPage}
                    onClick={history.loadMore}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
