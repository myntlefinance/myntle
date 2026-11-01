"use client";

import { useCallback, useEffect, useState } from "react";
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
import { ConfirmDialog } from "@/components/app/TrashView";
import { Button } from "@/components/atoms/Button";
import {
  fetchThreads,
  fetchTrashed,
  messageCache,
  prefetchInflight,
  prefetchThread,
  readThreadsCache,
  readTrashedCache,
  type ThreadItem,
  type TrashedItem,
} from "@/components/app/threadCache";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";


export default function TrashDetailView({ slug }: { slug: string }) {
  const router = useRouter();

  useEffect(() => {
    const onSignOut = () => router.replace("/");
    window.addEventListener("myntle:sign-out", onSignOut);
    return () => window.removeEventListener("myntle:sign-out", onSignOut);
  }, [router]);
  const id = decodeURIComponent(slug);
  const [threads, setThreads] = useState<ThreadItem[]>(() => readThreadsCache());
  const [trashed, setTrashed] = useState<TrashedItem[]>(() => readTrashedCache());
  const [messages, setMessages] = useState<UIMessage[] | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [deletedAt, setDeletedAt] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextThreads, nextTrashed] = await Promise.all([
      fetchThreads(),
      fetchTrashed(),
    ]);
    setThreads(nextThreads);
    setTrashed(nextTrashed);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const renameThread = useCallback(
    (threadId: string, next: string) => {
      const cleaned = next.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      if (!cleaned) return;
      void fetch(`/api/conversations/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: cleaned }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("rename failed");
        })
        .then(() => refresh())
        .catch(() => refresh());
    },
    [refresh],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      void fetch(`/api/conversations/${encodeURIComponent(threadId)}`, {
        method: "DELETE",
      })
        .then((res) => {
          if (!res.ok) throw new Error("delete failed");
        })
        .then(() => {
          messageCache.delete(threadId);
          prefetchInflight.delete(threadId);
          void refresh();
        })
        .catch(() => refresh());
    },
    [refresh],
  );

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setMissing(false);
    void fetch(`/api/conversations/${encodeURIComponent(id)}/messages?limit=100&trashed=1`)
      .then((res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then(
        (body: {
          messages?: UIMessage[];
          title?: string | null;
          deletedAt?: string | null;
        }) => {
          if (cancelled) return;
          setMessages(body.messages ?? []);
          setTitle(body.title ?? null);
          if (body.deletedAt) setDeletedAt(body.deletedAt);
        },
      )
      .catch(() => {
        if (!cancelled) setMissing(true);
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
    } finally {
      setBusy(false);
    }
    router.push(`/chat/${encodeURIComponent(id)}`);
  }, [busy, id, router]);

  const destroy = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(
        `/api/conversations/${encodeURIComponent(id)}?permanent=true`,
        { method: "DELETE" },
      ).catch(() => undefined);
    } finally {
      setBusy(false);
    }
    setConfirming(false);
    router.push("/trash");
  }, [busy, id, router]);

  const headerTitle = title ?? trashed.find((t) => t.id === id)?.label ?? "Deleted chat";
  const effectiveDeletedAt =
    deletedAt ?? trashed.find((t) => t.id === id)?.deletedAt;

  return (
    <main className="flex h-[100dvh] gap-0 bg-canvas p-2.5 text-ink lg:pl-0">
      <SidebarNav
        fill
        className="hidden lg:flex"
        recents={threads}
        onPick={(threadId) => router.push(`/chat/${encodeURIComponent(threadId)}`)}
        onNewChat={() => router.push("/")}
        onHoverThread={prefetchThread}
        onRenameChat={renameThread}
        onDeleteChat={deleteThread}
        trashCount={trashed.length}
        trashActive
        onOpenTrash={() => router.push("/trash")}
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
                <div className="flex flex-col gap-8 px-4 pt-8 sm:px-8 lg:px-12">
                  {messages === null && !missing ? (
                    <>
                      <span className="sr-only" role="status">
                        Loading deleted chat.
                      </span>
                      <div className="mx-auto w-full max-w-[720px]">
                        {[70, 45, 60].map((width) => (
                          <div
                            key={width}
                            aria-hidden
                            className="mb-4 h-4 animate-pulse rounded-[4px] bg-hover-2"
                            style={{ width: `${width}%` }}
                          />
                        ))}
                      </div>
                    </>
                  ) : missing ? (
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
                    messages!.map((message) => {
                      if (message.role === "user") {
                        const text = message.parts
                          .filter((part) => part.type === "text")
                          .map((part) => part.text)
                          .join("");
                        return (
                          <div key={message.id} className="mx-auto w-full max-w-[720px]">
                            <UserBubble text={text} />
                          </div>
                        );
                      }
                      return (
                        <div key={message.id} className="mx-auto w-full max-w-[720px]">
                          <LiveResponse
                            message={message}
                            status="ready"
                          />
                        </div>
                      );
                    })
                  )}
                </div>
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
