"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import {
  IconArrowBackUp,
  IconChevronLeft,
  IconTrash,
} from "@tabler/icons-react";
import SidebarNav from "@/components/primitives/SidebarNav";
import { WalletButton } from "@/components/app/WalletButton";
import { LiveResponse } from "@/components/app/LiveResponse";
import { UserBubble } from "@/components/app/MessageActions";
import {
  TimestampPill,
  computeMessageClusters,
  getMessageTimestamp,
} from "@/components/app/TimestampPill";
import { ConfirmDialog } from "@/components/app/TrashView";
import { Button } from "@/components/atoms/Button";
import { useQueryClient } from "@tanstack/react-query";
import {
  THREADS_QUERY_KEY,
  TRASHED_QUERY_KEY,
  useThreads,
  useTrashed,
} from "@/components/app/threadQueries";
import {
  deleteCachedMessages,
  findThreadLabel,
  loadTrashedMessages,
  prefetchThread,
  readThreadsCache,
  readTrashedCache,
  trashedMessageCache,
  writeThreadsCache,
  writeTrashedCache,
  type ThreadItem,
  type TrashedItem,
} from "@/components/app/threadCache";
import { useRoutePrefetch } from "@/components/app/routePrefetch";
import { ThreadSkeleton } from "@/components/app/ThreadSkeleton";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";


export default function TrashDetailView({ slug }: { slug: string }) {
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

  useEffect(() => {
    const onSignOut = () => router.replace("/");
    window.addEventListener("myntle:sign-out", onSignOut);
    return () => window.removeEventListener("myntle:sign-out", onSignOut);
  }, [router]);
  const queryClient = useQueryClient();
  const id = decodeURIComponent(slug);
  const { data: threads = [] } = useThreads();
  const { data: trashed = [] } = useTrashed();
  const [messages, setMessages] = useState<UIMessage[] | null>(
    () => trashedMessageCache.get(id) ?? null,
  );
  const [title, setTitle] = useState<string | null>(null);
  const [deletedAt, setDeletedAt] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // A new trashed thread paints its warmed preview at once, instead of an
  // effect syncing the cache into state after mount.
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    setMessages(trashedMessageCache.get(id) ?? null);
    setMissing(false);
  }

  const clusteredMessages = useMemo(
    () => (messages ? computeMessageClusters(messages, getMessageTimestamp) : []),
    [messages],
  );

  const renameThread = useCallback(
    (threadId: string, next: string) => {
      const cleaned = next.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      if (!cleaned) return;
      const current =
        (threadId === id ? title : null) ??
        findThreadLabel(threadId) ??
        threads.find((t) => t.id === threadId)?.label;
      if (current && cleaned === current.trim()) return;
      void fetch(`/api/conversations/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: cleaned }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("rename failed");
        })
        .then(() => queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY }))
        .catch(() => queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY }));
    },
    [id, queryClient, threads, title],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      const label =
        queryClient.getQueryData<ThreadItem[]>(THREADS_QUERY_KEY)?.find((t) => t.id === threadId)?.label ??
        findThreadLabel(threadId) ??
        "New chat";
      void fetch(`/api/conversations/${encodeURIComponent(threadId)}`, {
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
          deleteCachedMessages(threadId);
          const entry: TrashedItem = { id: threadId, label, deletedAt };
          queryClient.setQueryData<ThreadItem[]>(THREADS_QUERY_KEY, (old) =>
            old ? old.filter((t) => t.id !== threadId) : old,
          );
          writeThreadsCache(readThreadsCache().filter((t) => t.id !== threadId));
          queryClient.setQueryData<TrashedItem[]>(TRASHED_QUERY_KEY, (old) =>
            old
              ? [entry, ...old.filter((t) => t.id !== threadId)]
              : [entry],
          );
          const prevTrashed = readTrashedCache().filter((t) => t.id !== threadId);
          writeTrashedCache([entry, ...prevTrashed]);
        })
        .catch(() => {
          // No list change was made, so nothing to roll back. SidebarNav's
          // safety timer releases the collapsed row so it glides back.
        });
    },
    [queryClient],
  );

  useEffect(() => {
    let cancelled = false;
    if (trashedMessageCache.get(id)) {
      // A trashed chat cannot gain messages. A preview warmed on hover is
      // already the read; fetching it again would only repeat the page.
      return;
    }
    void loadTrashedMessages(id).then((result) => {
      if (cancelled) return;
      if (result.kind !== "ok") {
        setMissing(true);
        return;
      }
      const body = result.body;
      setMessages(body.messages ?? []);
      setTitle(body.title ?? null);
      if (body.deletedAt) setDeletedAt(body.deletedAt);
      setMissing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const restore = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restore: true }),
      }).catch(() => null);
      if (!res || !res.ok) return;
      trashedMessageCache.delete(id);
      void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: TRASHED_QUERY_KEY });
    } finally {
      setBusy(false);
    }
    router.push(`/chat/${encodeURIComponent(id)}`);
  }, [busy, id, router, queryClient]);

  const destroy = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(
        `/api/conversations/${encodeURIComponent(id)}?permanent=true`,
        { method: "DELETE" },
      ).catch(() => undefined);
      trashedMessageCache.delete(id);
      void queryClient.invalidateQueries({ queryKey: TRASHED_QUERY_KEY });
    } finally {
      setBusy(false);
    }
    setConfirming(false);
    router.push("/trash");
  }, [busy, id, router, queryClient]);

  const headerTitle = title ?? trashed.find((t) => t.id === id)?.label ?? "New chat";
  const effectiveDeletedAt =
    deletedAt ?? trashed.find((t) => t.id === id)?.deletedAt;

  return (
    <main className="flex h-[100dvh] gap-0 bg-canvas p-2.5 text-ink lg:pl-0">
      <SidebarNav
        fill
        className="hidden lg:flex"
        recents={threads.map((t) => ({ id: t.id, label: t.label ?? "New chat" }))}
        onPick={(threadId) => router.push(`/chat/${encodeURIComponent(threadId)}`)}
        onNewChat={() => router.push("/")}
        onHoverThread={hoverThread}
        onRenameChat={renameThread}
        onDeleteChat={deleteThread}
        trashCount={trashed.length}
        trashActive
        onOpenTrash={() => router.push("/trash")}
        onOpenPortfolio={() => router.push("/portfolio")}
        onOpenHistory={() => router.push("/history")}
        footer={<WalletButton />}
        footerCompact={<WalletButton compact />}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex min-h-0 flex-1 gap-2.5">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
            <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:px-4">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/trash")}
                  aria-label="Back to trash"
                  className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink mr-0.5"
                >
                  <IconChevronLeft size={16} stroke={2} />
                </button>
                <span
                  className="block min-w-0 max-w-full truncate text-[14px] font-medium text-ink"
                  title={headerTitle}
                >
                  {headerTitle}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => void restore()}
                  disabled={busy || missing}
                >
                  <IconArrowBackUp size={13} stroke={2} />
                  Restore
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => setConfirming(true)}
                  disabled={busy || missing}
                  aria-label={`Delete ${headerTitle}`}
                >
                  <IconTrash size={13} stroke={2} />
                  Delete
                </Button>
              </div>
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-slim [scrollbar-gutter:stable]">
                {messages === null && !missing ? (
                  <ThreadSkeleton />
                ) : (
                  <div
                    key={id}
                    className="flex flex-col gap-8 px-4 pt-8 pb-8 sm:px-8 lg:px-12"
                    style={{ animation: "fade-in 150ms ease both" }}
                  >
                    {missing ? (
                      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center justify-center gap-1 py-16">
                        <span className="text-[13.5px] font-medium text-ink">
                          This chat is gone.
                        </span>
                        <span className="text-[12.5px] text-ink-3">
                          It was deleted permanently or expired.
                        </span>
                      </div>
                    ) : messages!.length === 0 ? (
                      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center justify-center gap-1 py-16">
                        <span className="text-[13.5px] font-medium text-ink">
                          No messages.
                        </span>
                        <span className="text-[12.5px] text-ink-3">
                          This chat has nothing to preview.
                        </span>
                      </div>
                    ) : (
                      clusteredMessages.map(({ message, showTimestamp, timestamp }) => (
                        <Fragment key={message.id}>
                          {showTimestamp && (
                            <div className="mx-auto w-full max-w-[720px]">
                              <TimestampPill timestamp={timestamp} />
                            </div>
                          )}
                          <div className="mx-auto w-full max-w-[720px]">
                            {message.role === "user" ? (
                              <UserBubble
                                text={message.parts
                                  .filter((part) => part.type === "text")
                                  .map((part) => part.text)
                                  .join("")}
                              />
                            ) : (
                              <LiveResponse
                                message={message}
                                status="ready"
                              />
                            )}
                          </div>
                        </Fragment>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Delete chat?"
          body="Are you sure you want to delete this chat? This cannot be undone."
          busy={busy}
          items={[
            {
              id,
              label: headerTitle,
              deletedAt: effectiveDeletedAt,
            },
          ]}
          confirmLabel="Delete"
          onCancel={() => {
            if (!busy) setConfirming(false);
          }}
          onConfirm={() => void destroy()}
        />
      )}
    </main>
  );
}
