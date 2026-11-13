"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Skeleton } from "skullet/react";
import { TrashSample } from "@/components/app/TrashSample";
import {
  IconArrowBackUp,
  IconChevronLeft,
  IconLoader2,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import SidebarNav from "@/components/primitives/SidebarNav";
import { WalletButton } from "@/components/app/WalletButton";
import { Button } from "@/components/atoms/Button";
import {
  activateWarmState,
  isTooltipWarm,
  onTooltipEnter,
  onTooltipLeave,
} from "@/components/app/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { THREADS_QUERY_KEY, TRASHED_QUERY_KEY } from "@/components/app/threadQueries";
import {
  deleteCachedMessages,
  fetchThreads,
  fetchTrashed,
  findThreadLabel,
  hasTrashedCache,
  prefetchThread,
  prefetchTrashedThread,
  readThreadsCache,
  readTrashedCache,
  trashedMessageCache,
  writeThreadsCache,
  writeTrashedCache,
  type ThreadItem,
  type TrashedItem,
} from "@/components/app/threadCache";
import { useRoutePrefetch } from "@/components/app/routePrefetch";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";
import { useHoverIntent } from "@/components/app/useHoverIntent";
import { useAuth } from "@/lib/auth/auth-provider";

/* ─────────────────────────────────────────────────────────
 * TRASH
 * Deleted chats rest here for 30 days, newest first.
 * Features an unboxed icon prefix, instant row hover (per Emil
 * Kowalski), SelectionActions floating dock, and retention countdown.
 * ───────────────────────────────────────────────────────── */

/** Row collapse duration when deleted. */
const EXIT_MS = 230;

/** Computes retention days (30 down to 1, or Soon for 0) and local purge time tooltip. */
function getRetentionBadge(deletedAt?: string): { days: number; isSoon: boolean; tooltip: string } {
  if (!deletedAt) return { days: 30, isSoon: false, tooltip: "" };
  const deletedTime = new Date(deletedAt).getTime();
  if (Number.isNaN(deletedTime)) return { days: 30, isSoon: false, tooltip: "" };

  const purgeTime = deletedTime + 30 * 86_400_000;
  const msLeft = Math.max(0, purgeTime - Date.now());
  const totalHours = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60)));
  const days = Math.floor(totalHours / 24);

  const isSoon = days <= 0;
  const tooltip = `Permanently deleted at ${new Date(purgeTime).toLocaleString()}`;

  return { days: Math.min(30, Math.max(1, days)), isSoon, tooltip };
}

/** Uniform-width badge displaying days (e.g. 30d, 29d, or Soon) with an Emil Kowalski-coordinated centered tooltip. */
function TimeLeftBadge({
  deletedAt,
  className = "",
}: {
  deletedAt?: string;
  className?: string;
}) {
  const { days, isSoon, tooltip } = getRetentionBadge(deletedAt);
  const [tooltipPos, setTooltipPos] = useState<{
    x: number;
    bottom?: number;
    top?: number;
  } | null>(null);
  const [isInstant, setIsInstant] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  const handleMouseEnter = (event: React.MouseEvent<HTMLSpanElement>) => {
    if (!tooltip) return;
    onTooltipEnter();
    const rect = event.currentTarget.getBoundingClientRect();
    const isNearTop = rect.top < 44;
    const pos = {
      x: rect.left + rect.width / 2,
      bottom: isNearTop ? undefined : window.innerHeight - rect.top + 6,
      top: isNearTop ? rect.bottom + 6 : undefined,
    };

    if (isTooltipWarm()) {
      // Warm window: skip 400ms delay and entrance animation across adjacent tooltips
      setIsInstant(true);
      setTooltipPos(pos);
    } else {
      // Cold hover: wait 400ms delay to prevent accidental activation
      setIsInstant(false);
      clearTimer();
      openTimerRef.current = setTimeout(() => {
        setTooltipPos(pos);
        activateWarmState();
      }, 400);
    }
  };

  const handleMouseLeave = () => {
    clearTimer();
    setTooltipPos(null);
    onTooltipLeave();
  };

  useEffect(() => {
    return () => clearTimer();
  }, []);

  useEffect(() => {
    if (!tooltipPos) return;
    const dismiss = () => {
      clearTimer();
      setTooltipPos(null);
      onTooltipLeave();
    };
    window.addEventListener("scroll", dismiss, true);
    return () => window.removeEventListener("scroll", dismiss, true);
  }, [tooltipPos]);

  return (
    <>
      <span
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`w-9 shrink-0 text-right text-[11.5px] tabular-nums text-ink-3 ${className}`}
      >
        {isSoon ? "Soon" : `${days}d`}
      </span>
      {typeof document !== "undefined" &&
        tooltipPos &&
        createPortal(
          <div
            role="tooltip"
            data-instant={isInstant ? "" : undefined}
            className="pointer-events-none fixed z-[9999] -translate-x-1/2"
            style={{
              left: tooltipPos.x,
              bottom: tooltipPos.bottom,
              top: tooltipPos.top,
            }}
          >
            <div
              className="whitespace-nowrap rounded-full border border-line bg-surface/95 px-2.5 py-0.5 text-center text-[11.5px] font-medium text-ink shadow-overlay backdrop-blur-sm"
              style={
                isInstant
                  ? { transition: "none", animation: "none" }
                  : {
                      animation:
                        "pop-in 120ms cubic-bezier(0.23, 1, 0.32, 1) both",
                    }
              }
            >
              {tooltip}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Dedicated hit area for select-all, sharing the exact same padding and alignment as RowCheckbox. */
function SelectAllCheckbox({
  checked,
  mixed = false,
  onChange,
  label,
}: {
  checked: boolean;
  mixed?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label
      title={label}
      onClick={(event) => event.stopPropagation()}
      className="group/select flex h-full shrink-0 cursor-pointer items-center pl-2.5 pr-2 select-none"
    >
      <span className="records-checkbox pointer-events-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          aria-label={label}
          className="pointer-events-auto"
        />
        <span
          className={`records-checkbox-box ${checked || mixed ? "is-active" : ""}`}
        >
          {mixed ? (
            <span className="records-checkbox-dash" />
          ) : checked ? (
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m5 12 4 4L19 6" />
            </svg>
          ) : null}
        </span>
      </span>
      <span className="ml-2 text-[12px] font-medium text-ink-3 transition-colors duration-100 group-hover/select:text-ink">
        Select all
      </span>
    </label>
  );
}

/** Dedicated full-height hit area for row selection, capturing all clicks to the left of the title. */
function RowCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label
      title={label}
      onClick={(event) => event.stopPropagation()}
      className="flex h-full shrink-0 cursor-pointer items-center pl-2.5 pr-2 select-none"
    >
      <span className="records-checkbox pointer-events-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          aria-label={label}
          className="pointer-events-auto"
        />
        <span
          className={`records-checkbox-box ${checked ? "is-active" : ""}`}
        >
          {checked && (
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m5 12 4 4L19 6" />
            </svg>
          )}
        </span>
      </span>
    </label>
  );
}

/* Centered dialog carved from the wallet button: the same backdrop fade
 * and dialog-in entrance, the same radius and shadow. */
export function ConfirmDialog({
  title,
  body,
  busy,
  items,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  busy: boolean;
  items?: { id: string; label: string | null; deletedAt?: string }[];
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/60 dark:bg-black/75"
        style={{ animation: "fade-in 180ms ease-out both" }}
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        className="relative flex max-h-[calc(100dvh-2rem)] min-h-[154px] w-full max-w-md flex-col justify-between overflow-y-auto scroll-slim rounded-card bg-surface shadow-overlay"
        style={{ animation: "dialog-in 240ms var(--ease-out-strong) both" }}
      >
        <div className="primitive-card-pad">
          <div
            title={title}
            className="flex items-center gap-1.5 truncate text-[14px] font-medium text-ink"
          >
            <IconTrash
              size={14}
              stroke={2}
              className="shrink-0 text-red"
              aria-hidden
            />
            <span className="truncate">{title}</span>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{body}</p>
        </div>

        {/* Compartment extracted from RecommendationCard (alternatives drawer pattern) */}
        {items && items.length > 0 && (
          <div className="border-t border-line bg-surface px-2.5 py-2">
            <div className="max-h-40 overflow-y-auto scroll-slim [scrollbar-gutter:stable] flex flex-col gap-0.5">
              {items.slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  className="flex w-full items-center gap-2.5 rounded-control px-1.5 py-1.5 text-left transition-colors duration-100 hover:bg-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {item.label ?? "New chat"}
                  </span>
                  <TimeLeftBadge deletedAt={item.deletedAt} />
                </div>
              ))}
            </div>
            {items.length > 4 && (
              <div className="px-1.5 pt-1.5">
                <span className="inline-flex items-center rounded-full bg-field px-2 py-0.5 text-[11.5px] font-medium tabular-nums text-ink-2 shadow-hairline">
                  +{items.length - 4} more
                </span>
              </div>
            )}
          </div>
        )}
        <div className="primitive-card-footer flex items-center justify-end">
          <div className="-mr-0.5 flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? (
                <span className="inline-flex items-center gap-1.5">
                  <IconLoader2
                    size={14}
                    stroke={2}
                    className="animate-spin"
                    aria-hidden
                  />
                  {confirmLabel}
                </span>
              ) : (
                confirmLabel
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type DialogState =
  | { kind: "empty" }
  | { kind: "delete"; ids: string[] }
  | null;

export default function TrashView() {
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
  const { status } = useAuth();

  useEffect(() => {
    const onSignOut = () => router.replace("/");
    window.addEventListener("myntle:sign-out", onSignOut);
    return () => window.removeEventListener("myntle:sign-out", onSignOut);
  }, [router]);

  const [threads, setThreads] = useState<ThreadItem[]>(() => readThreadsCache());
  const [items, setItems] = useState<TrashedItem[]>(() => readTrashedCache());
  const queryClient = useQueryClient();
  // The stored list is the result. An empty array means the trash was read
  // and had nothing in it, not that the read never happened, so a repeat
  // visit paints that answer instead of a skeleton.
  const [loaded, setLoaded] = useState(() => hasTrashedCache());
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [lockedHeights, setLockedHeights] = useState<Record<string, number>>({});
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // Deleted-chat previews are the heaviest hover fetch in the app. Rest on a
  // row before warming it; crossing the list must not issue one per row.
  const hoverTrash = useCallback(
    (id: string) => prefetchTrashedThread(id),
    [],
  );
  const hoverIntent = useHoverIntent(hoverTrash);

  const refresh = useCallback(async () => {
    const [nextItems, nextThreads] = await Promise.all([
      fetchTrashed(),
      fetchThreads(),
    ]);
    queryClient.setQueryData(TRASHED_QUERY_KEY, nextItems);
    queryClient.setQueryData(THREADS_QUERY_KEY, nextThreads);
    setItems(nextItems);
    setThreads(nextThreads);
    const alive = new Set(nextItems.map((item) => item.id));
    setSelected((current) => {
      if ([...current].every((id) => alive.has(id))) return current;
      return new Set([...current].filter((id) => alive.has(id)));
    });
    setExiting((current) => {
      if ([...current].every((id) => !alive.has(id))) return current;
      return new Set([...current].filter((id) => alive.has(id)));
    });
    setLockedHeights((current) => {
      const next: Record<string, number> = {};
      for (const id of Object.keys(current)) if (alive.has(id)) next[id] = current[id];
      return next;
    });
    setLoaded(true);
  }, [queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onSignIn = () => void refresh();
    window.addEventListener("myntle:sign-in", onSignIn);
    return () => window.removeEventListener("myntle:sign-in", onSignIn);
  }, [refresh]);

  const visible = query.trim()
    ? items.filter((item) =>
        (item.label ?? "New chat").toLowerCase().includes(query.trim().toLowerCase()),
      )
    : items;

  // Once the auth check says there is no session, there is nothing to wait
  // for: the trash route would only answer 401. Show the empty result
  // instead of a skeleton that has to time out first.
  const waiting = !loaded && status !== "signed-out";

  const allSelected =
    visible.length > 0 && visible.every((item) => selected.has(item.id));
  const partiallySelected =
    !allSelected && visible.some((item) => selected.has(item.id));

  const toggleRow = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) visible.forEach((item) => next.delete(item.id));
      else visible.forEach((item) => next.add(item.id));
      return next;
    });
  }, [allSelected, visible]);

  const restoreMany = useCallback(
    async (ids: string[]) => {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/conversations/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ restore: true }),
          }).catch(() => undefined),
        ),
      );
      ids.forEach((id) => trashedMessageCache.delete(id));
      setSelected(new Set());
      void refresh();
    },
    [refresh],
  );

  const destroyMany = useCallback(
    async (ids: string[]) => {
      await Promise.all(
        ids.map((id) =>
          fetch(
            `/api/conversations/${encodeURIComponent(id)}?permanent=true`,
            { method: "DELETE" },
          ).catch(() => undefined),
        ),
      );
      ids.forEach((id) => trashedMessageCache.delete(id));
    },
    [],
  );

  const animateOut = useCallback((ids: string[], done: () => void) => {
    const heights: Record<string, number> = {};
    ids.forEach((id) => {
      const el = rowRefs.current.get(id);
      if (el) heights[id] = el.offsetHeight;
    });
    setLockedHeights((current) => ({ ...current, ...heights }));
    requestAnimationFrame(() => {
      setExiting(new Set(ids));
      setTimeout(done, EXIT_MS);
    });
  }, []);

  const confirmDialog = useCallback(async () => {
    if (!dialog || busy) return;
    setBusy(true);
    try {
      if (dialog.kind === "empty") {
        await fetch("/api/conversations?empty=true", {
          method: "DELETE",
        }).catch(() => undefined);
        trashedMessageCache.clear();
        setDialog(null);
        animateOut(
          items.map((item) => item.id),
          () => void refresh(),
        );
      } else {
        await destroyMany(dialog.ids);
        const ids = dialog.ids;
        setDialog(null);
        animateOut(ids, () => void refresh());
      }
    } finally {
      setBusy(false);
    }
  }, [dialog, busy, destroyMany, animateOut, items, refresh]);

  const openChat = useCallback(
    (id: string) => {
      router.push(`/trash/${encodeURIComponent(id)}`);
    },
    [router],
  );

  const renameThread = useCallback(
    (id: string, next: string) => {
      const cleaned = next.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      if (!cleaned) return;
      const current = findThreadLabel(id);
      if (current != null && cleaned === current.trim()) return;
      // Paint instantly in place; no list refetch. The PATCH settles in the
      // background and a failed write rolls back to the previous label.
      const prevThreads = queryClient.getQueryData<ThreadItem[]>(THREADS_QUERY_KEY);
      const prevCache = readThreadsCache();
      const prevLabel = prevCache.find((t) => t.id === id)?.label ?? null;
      setThreads((prev) =>
        prev.some((t) => t.id === id)
          ? prev.map((t) => (t.id === id ? { ...t, label: cleaned } : t))
          : prev,
      );
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
          setThreads((prev) =>
            prev.some((t) => t.id === id && t.label === cleaned)
              ? prev.map((t) => (t.id === id ? { ...t, label: prevLabel ?? t.label } : t))
              : prev,
          );
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
          setThreads((prev) => prev.filter((t) => t.id !== id));
          setItems((prev) =>
            prev.some((t) => t.id === id) ? prev : [entry, ...prev],
          );
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

  const dialogTitle =
    dialog?.kind === "empty"
      ? "Empty trash?"
      : dialog && dialog.kind === "delete"
        ? dialog.ids.length === 1
          ? "Delete chat?"
          : `Delete ${dialog.ids.length} chats?`
        : "";

  const dialogBody =
    dialog?.kind === "empty"
      ? "Are you sure you want to empty trash? This will permanently delete all chats in trash."
      : dialog && dialog.kind === "delete" && dialog.ids.length === 1
        ? "Are you sure you want to delete this chat? This cannot be undone."
        : "Are you sure you want to delete these chats? This cannot be undone.";

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
        trashCount={items.length}
        trashActive
        onOpenTrash={() => router.push("/trash")}
        onOpenPortfolio={() => router.push("/portfolio")}
        onOpenHistory={() => router.push("/history")}
        footer={<WalletButton />}
        footerCompact={<WalletButton compact />}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
          {/* Title bar, isolated by the divider: same 44px height as Portfolio and History. */}
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
                  <IconTrash size={17} stroke={1.7} />
                </span>
                <h1 className="truncate text-[14px] font-medium text-ink">
                  Trash
                </h1>
              </div>
            </div>
          </header>

          {/* Search below the divider, unchanged from its original row. */}
          <div className="flex shrink-0 items-center px-4 pt-2.5">
            <div className="flex h-7.5 w-1/2 min-w-[200px] items-center overflow-hidden rounded-control bg-field px-2.5 text-ink-2 shadow-hairline transition-all duration-150 focus-within:bg-surface focus-within:text-ink focus-within:shadow-btn">
              <span className="flex shrink-0 items-center justify-center text-ink-3">
                <IconSearch size={13} stroke={2} />
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setQuery("");
                }}
                placeholder="Search deleted chats"
                aria-label="Search deleted chats"
                className="ml-2 min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="mr-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
                >
                  <IconX size={11} stroke={2.5} />
                </button>
              )}
            </div>
          </div>

          {/* ── Sub-header: Select all aligned with chat row checkboxes on left, Empty trash on extreme right ── */}
          {loaded && items.length > 0 && (
            <div className="flex h-8.5 shrink-0 items-center justify-between px-3 pt-1">
              {visible.length > 0 ? (
                <SelectAllCheckbox
                  checked={allSelected}
                  mixed={partiallySelected}
                  onChange={toggleAll}
                  label="Select all deleted chats"
                />
              ) : (
                <div />
              )}

              <div className="pr-2.5">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setDialog({ kind: "empty" })}
                  className="text-red hover:bg-red hover:text-white"
                >
                  <IconTrash size={13} stroke={1.9} />
                  Empty trash
                </Button>
              </div>
            </div>
          )}

          {/* ── Compact Chat List with tight row spacing and instant hover ── */}
          <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-3 py-1.5 [scrollbar-gutter:stable]">
            {waiting ? (
              <Skeleton loading label="Loading deleted chats.">
                <TrashSample />
              </Skeleton>
            ) : (
              <>
                <div className="flex flex-col gap-0.5">
                  {visible.map((item) => {
                    const isExiting = exiting.has(item.id);
                    const isSelected = selected.has(item.id);
                    return (
                      <div
                        key={item.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(item.id, el);
                          else rowRefs.current.delete(item.id);
                        }}
                        style={
                          isExiting
                            ? { height: 0, opacity: 0 }
                            : lockedHeights[item.id] != null
                              ? { height: lockedHeights[item.id] }
                              : undefined
                        }
                        className="trash-row-collapse"
                      >
                        {/* Compact row with dedicated checkbox hit zone and full-height chat trigger */}
                        <div
                          onClick={() => {
                            hoverIntent.cancel();
                            void openChat(item.id);
                          }}
                          onPointerEnter={(event) =>
                            hoverIntent.enter(item.id, event.pointerType)
                          }
                          onPointerLeave={() => hoverIntent.leave(item.id)}
                          className={`group relative flex h-9 cursor-pointer items-center rounded-[6px] pr-2.5 transition-colors duration-75 hover:bg-hover-2 ${
                            isSelected ? "bg-hover-2" : ""
                          }`}
                        >
                          {/* Dedicated hit area: captures all clicks to the left of the title for checkbox toggle */}
                          <RowCheckbox
                            checked={isSelected}
                            onChange={() => toggleRow(item.id)}
                            label={`Select ${item.label ?? "New chat"}`}
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              hoverIntent.cancel();
                              void openChat(item.id);
                            }}
                            title={item.label ?? "New chat"}
                            aria-label={`Open ${item.label ?? "New chat"}`}
                            className="flex h-full min-w-0 flex-1 items-center select-none text-left"
                          >
                            <span className="truncate text-[13px] font-medium text-ink">
                              {item.label ?? "New chat"}
                            </span>
                          </button>

                          {/* Retention countdown formatted as "Xd" / "Soon" */}
                          <TimeLeftBadge
                            deletedAt={item.deletedAt}
                            className="ml-2 transition-colors duration-75 group-hover:text-ink-2"
                          />

                          {/* Quick row hover actions */}
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="ml-2 flex shrink-0 items-center gap-1 opacity-0 pointer-events-none transition-opacity duration-75 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                          >
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                void restoreMany([item.id]);
                              }}
                              aria-label={`Restore ${item.label ?? "New chat"}`}
                              className="h-6 px-2 text-[11.5px]"
                            >
                              <IconArrowBackUp size={12} stroke={2} />
                              Restore
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDialog({ kind: "delete", ids: [item.id] });
                              }}
                              aria-label={`Delete ${item.label ?? "New chat"}`}
                              className="h-6 px-2 text-[11.5px] text-red hover:bg-red hover:text-white"
                            >
                              <IconTrash size={12} stroke={2} />
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {items.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-16 text-center">
                    <span className="mb-1 flex size-8 items-center justify-center rounded-control bg-inset text-ink-3 shadow-hairline">
                      <IconTrash size={16} stroke={1.8} />
                    </span>
                    <span className="text-[13px] font-medium text-ink">
                      Trash is empty
                    </span>
                  </div>
                )}

                {items.length > 0 && visible.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-16 text-center">
                    <span className="text-[13px] font-medium text-ink">
                      No matching chats
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Floating selection dock (SelectionActions pattern) ── */}
          {selected.size > 0 && (
            <div
              className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface/95 px-2.5 py-1 shadow-overlay backdrop-blur-sm"
              style={{ animation: "dialog-in 200ms var(--ease-out-strong) both" }}
            >
              <span className="pl-1 pr-1 text-[11.5px] font-medium text-ink-2 tabular-nums">
                {selected.size} selected
              </span>
              <span className="h-3.5 w-px bg-line" />
              <Button
                variant="secondary"
                size="xs"
                onClick={() => void restoreMany([...selected])}
              >
                <IconArrowBackUp size={13} stroke={2} />
                Restore
              </Button>
              <Button
                variant="destructive"
                size="xs"
                onClick={() =>
                  setDialog({ kind: "delete", ids: [...selected] })
                }
              >
                <IconTrash size={13} stroke={2} />
                Delete
              </Button>
            </div>
          )}
        </section>
      </div>

      {dialog && (
        <ConfirmDialog
          title={dialogTitle}
          body={dialogBody}
          busy={busy}
          items={
            dialog.kind === "delete"
              ? (dialog.ids
                  .map((id) => items.find((item) => item.id === id))
                  .filter(Boolean) as TrashedItem[])
              : undefined
          }
          confirmLabel={dialog.kind === "empty" ? "Empty trash" : "Delete"}
          onCancel={() => {
            if (!busy) setDialog(null);
          }}
          onConfirm={() => void confirmDialog()}
        />
      )}
    </main>
  );
}
