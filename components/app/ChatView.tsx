"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Harness from "@/components/site/Harness";
import { WalletButton } from "@/components/app/WalletButton";
import { MODELS, DEFAULT_MODEL } from "@/lib/ai/provider";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";
import { focusComposer } from "@/lib/composer";
import { openWalletPicker } from "@/components/app/ConnectGate";
import { useWallet } from "@/lib/wallet/registry";
import { useQueryClient } from "@tanstack/react-query";
import {
  useThreads,
  useTrashed,
  THREADS_QUERY_KEY,
  TRASHED_QUERY_KEY,
} from "@/components/app/threadQueries";
import {
  clearThreadCache,
  deleteCachedMessages,
  findThreadLabel,
  getCachedMessages,
  messageCache,
  prefetchInflight,
  prefetchThread,
  setCachedMessages,
  threadPagination,
  type ThreadItem,
  type TrashedItem,
} from "@/components/app/threadCache";
import type { SettlementSnapshot } from "@/components/app/approvals";

export type GatedExchange = { id: number; prompt: string };

export default function ChatView({
  initialConversationId = null,
}: {
  initialConversationId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { data: threads = [] } = useThreads();
  const { data: trashed = [] } = useTrashed();
  const [model, setModel] = useState(DEFAULT_MODEL);
  const { connected, account } = useWallet();
  const accountRef = useRef(account);
  accountRef.current = account;
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  // Database settlements for the open conversation, keyed by tool approval
  // id. One fetch covers every card in the thread — historical cards paint
  // their terminal state at once instead of each polling /api/tx on load.
  const [settlements, setSettlements] = useState<
    Record<string, SettlementSnapshot>
  >({});
  const conversationIdRef = useRef<string | null>(conversationId);
  conversationIdRef.current = conversationId;

  const [title, setTitle] = useState<string | null>(() =>
    findThreadLabel(initialConversationId ?? null),
  );
  const titleRef = useRef<string | null>(title);
  titleRef.current = title;
  const titleDirtyRef = useRef(false);
  const titleReqRef = useRef(0);
  const titlePromiseRef = useRef<Promise<void> | null>(null);

  const [gated, setGated] = useState<GatedExchange[]>([]);
  const gatedIdRef = useRef(0);
  const pendingRef = useRef<string | null>(null);

  const [loadingThread, setLoadingThread] = useState(() => {
    if (!initialConversationId) return false;
    const cached = getCachedMessages(initialConversationId);
    return !cached || cached.length === 0;
  });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(() => {
    if (!initialConversationId) return false;
    return Boolean(threadPagination.get(initialConversationId)?.hasMore);
  });
  const lastLoadedConvRef = useRef<string | null>(null);
  const routeSlugRef = useRef<string | null | undefined>(undefined);

  // Old ?c= links become /chat/<slug>.
  useEffect(() => {
    if (initialConversationId) return;
    try {
      const param = new URLSearchParams(window.location.search).get("c");
      if (param) router.replace(`/chat/${encodeURIComponent(param)}`);
    } catch {
      // Ignore.
    }
  }, [initialConversationId, router]);

  const { messages, sendMessage, setMessages, status, error, regenerate, addToolApprovalResponse } = useChat({
    // Seed first paint from cache so a thread route never flashes the
    // composer. useChat only reads this once; later switches go through
    // setMessages in switchConversation.
    messages: initialConversationId
      ? (getCachedMessages(initialConversationId) ?? [])
      : [],
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({
        model,
        conversationId: conversationIdRef.current,
        title: titleRef.current,
        walletAddress: accountRef.current?.address,
        walletChain: accountRef.current?.kind,
      }),
    }),
  });
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Private chat route guard: an unauthenticated visitor cannot view a saved thread.
  useEffect(() => {
    if (initialConversationId && !connected) {
      clearThreadCache();
      router.replace("/");
    }
  }, [initialConversationId, connected, router]);

  // Global sign-out: clear React state, empty lists, and return to composer.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleSignOut = () => {
      setMessages([]);
      setConversationId(null);
      setTitle(null);
      setGated([]);
      setSettlements({});
      setLoadingThread(false);
      setHasMoreOlder(false);
      setLoadingOlder(false);
      lastLoadedConvRef.current = null;
      router.replace("/");
      clearThreadCache();
      // Allow the reverse cascade exit animation in the sidebar to play smoothly
      timer = setTimeout(() => {
        queryClient.setQueryData(THREADS_QUERY_KEY, []);
        queryClient.setQueryData(TRASHED_QUERY_KEY, []);
      }, 350);
    };

    window.addEventListener("myntle:sign-out", handleSignOut);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("myntle:sign-out", handleSignOut);
    };
  }, [router, setMessages, queryClient]);

  // Refresh sidebar threads and trash when wallet connection lands.
  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (!prevConnectedRef.current && connected) {
      void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: TRASHED_QUERY_KEY });
    }
    prevConnectedRef.current = connected;
  }, [connected, queryClient]);

  useEffect(() => {
    const handleSignIn = () => {
      void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: TRASHED_QUERY_KEY });
    };

    window.addEventListener("myntle:sign-in", handleSignIn);
    return () => window.removeEventListener("myntle:sign-in", handleSignIn);
  }, [queryClient]);

  // Keep the sidebar fresh after each finished turn.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasBusy = prevStatusRef.current === "submitted" || prevStatusRef.current === "streaming";
    prevStatusRef.current = status;
    if (wasBusy && status === "ready" && messages.length > 0) {
      void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
    }
  }, [status, messages.length, queryClient]);

  // Surface a brand-new chat in the sidebar while its first answer streams
  // instead of waiting for the turn to finish. The row is in Supabase from
  // the moment the user message is saved, which happens before streaming
  // starts. The immediate fetch usually races the insert, hence one delayed
  // retry; the post-turn refresh above stays as the backstop.
  useEffect(() => {
    if (conversationId || messages.length === 0) return;
    if (status !== "submitted" && status !== "streaming") return;
    void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
    }, 2000);
    return () => clearTimeout(timer);
  }, [conversationId, messages.length, status, queryClient]);

  // Settlement rows for the open conversation, in one request. Cards join
  // by tool approval id; rows approved before the join existed stay on the
  // localStorage fallback inside the card.
  useEffect(() => {
    if (!conversationId) {
      setSettlements({});
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/transactions`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          body: {
            settlements?: Array<{
              toolApprovalId: string;
              transactionId: string;
              state: string;
              depositAddress?: string | null;
              explorerUrls?: string[];
            }>;
          } | null,
        ) => {
          if (!body || cancelled) return;
          const next: Record<string, SettlementSnapshot> = {};
          for (const s of body.settlements ?? []) {
            if (typeof s.toolApprovalId === "string" && s.toolApprovalId) {
              next[s.toolApprovalId] = {
                state: s.state,
                transactionId: s.transactionId,
                depositAddress: s.depositAddress,
                explorerUrls: s.explorerUrls,
              };
            }
          }
          setSettlements(next);
        },
      )
      .catch(() => {
        // Cards fall back to their own status poll.
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const switchConversation = useCallback(
    (targetId: string | null, pushHistory = true) => {
      if (targetId === conversationIdRef.current) return;

      // Stash current conversation messages in cache before switching
      if (conversationIdRef.current && messagesRef.current.length > 0) {
        setCachedMessages(conversationIdRef.current, messagesRef.current);
      }

      // Cancel any in-flight title generation
      titleReqRef.current += 1;
      titlePromiseRef.current = null;
      titleDirtyRef.current = false;
      pendingRef.current = null;
      setGated([]);
      setSettlements({});
      setLoadingOlder(false);

      if (targetId) {
        setConversationId(targetId);
        conversationIdRef.current = targetId;
        const threadLabel = findThreadLabel(targetId);
        setTitle(threadLabel);

        const cached = getCachedMessages(targetId);
        if (cached && cached.length > 0) {
          setMessages(cached);
          setLoadingThread(false);
          const pag = threadPagination.get(targetId);
          setHasMoreOlder(pag ? pag.hasMore : false);
        } else {
          setMessages([]);
          setLoadingThread(true);
          setHasMoreOlder(false);
        }

        try {
          localStorage.setItem("myntle-conv", targetId);
        } catch {
          // Ignore.
        }

        if (pushHistory) {
          try {
            window.history.pushState(null, "", `/chat/${encodeURIComponent(targetId)}`);
          } catch {
            // Ignore.
          }
        }
      } else {
        setConversationId(null);
        conversationIdRef.current = null;
        setTitle(null);
        lastLoadedConvRef.current = null;
        try {
          localStorage.removeItem("myntle-conv");
        } catch {
          // Ignore.
        }
        setMessages([]);
        setLoadingThread(false);
        setHasMoreOlder(false);

        if (pushHistory) {
          try {
            window.history.pushState(null, "", "/");
          } catch {
            // Ignore.
          }
        }
      }
    },
    [setMessages],
  );

  const onPickThread = useCallback(
    (id: string) => {
      switchConversation(id);
    },
    [switchConversation],
  );

  // Keep this chat's cache entry fresh as the conversation grows.
  useEffect(() => {
    if (conversationId && messages.length > 0)
      setCachedMessages(conversationId, messages);
  }, [conversationId, messages]);

  useEffect(() => {
    if (!conversationId) return;
    // Visited before: render instantly from cache
    const cached = getCachedMessages(conversationId);
    if (cached && cached.length > 0 && messages.length === 0) {
      setMessages(cached);
      setLoadingThread(false);
      const threadLabel = threads.find((t) => t.id === conversationId)?.label;
      if (threadLabel) {
        titleDirtyRef.current = false;
        setTitle(threadLabel);
      }
      const pag = threadPagination.get(conversationId);
      if (pag) setHasMoreOlder(pag.hasMore);
    }

    if (messages.length > 0 && lastLoadedConvRef.current === conversationId) return;
    lastLoadedConvRef.current = conversationId;

    let cancelled = false;
    void fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=20`)
      .then((res) => {
        if (res.status === 401) {
          clearThreadCache();
          setMessages([]);
          setConversationId(null);
          setTitle(null);
          setLoadingThread(false);
          try {
            window.history.replaceState(null, "", "/");
          } catch {
            // Ignore.
          }
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then(
        (
          body: {
            messages?: UIMessage[];
            title?: string | null;
            hasMore?: boolean;
            oldestSeq?: number;
          } | null,
        ) => {
          if (!body || cancelled) return;
          if (body.messages && body.messages.length > 0) {
            setCachedMessages(conversationId, body.messages);
            setMessages(body.messages);
          }
          if (body.hasMore !== undefined) {
            setHasMoreOlder(body.hasMore);
            threadPagination.set(conversationId, {
              hasMore: body.hasMore,
              oldestSeq: body.oldestSeq,
            });
          }
          // Title comes from the database here, so it must not mark dirty.
          if (body.title) {
            titleDirtyRef.current = false;
            setTitle(body.title);
          }
          setLoadingThread(false);
        },
      )
      .catch(() => {
        if (!cancelled) setLoadingThread(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, messages.length, setMessages, threads]);

  // Learn the server conversation after the first saved turn, persist the
  // local title, refresh the list, then move off the composer onto its
  // page — in that order. Navigating before the PATCH + refresh settle
  // remounts onto a stale sidebar cache: the new instance seeds its title
  // from the old (prompt) entry while the sidebar later flips to the
  // generated one, so the two visibly swap.
  useEffect(() => {
    if (conversationId || messages.length === 0) return;
    if (status === "submitted" || status === "streaming") return;
    let cancelled = false;
    void (async () => {
      let latest: { id: string; slug: string } | null = null;
      try {
        const res = await fetch("/api/conversations?limit=1");
        const body = (res.ok ? await res.json() : null) as {
          conversations?: Array<{ id: string; slug: string }>;
        } | null;
        latest = body?.conversations?.[0] ?? null;
      } catch {
        latest = null;
      }
      if (!latest || cancelled) return;
      const slug = latest.slug;
      // The generated title is usually back long before the stream ends,
      // but a fast reply can win the race. Wait for it (bounded) so it is
      // not lost on the unmounted composer and both surfaces agree.
      if (!titleRef.current && titlePromiseRef.current) {
        try {
          await Promise.race([
            titlePromiseRef.current,
            new Promise((resolve) => setTimeout(resolve, 4000)),
          ]);
        } catch {
          // Title failure already falls back to the prompt inside requestTitle.
        }
      }
      // Persist the locally generated title first so every later read —
      // the refresh below, the remount after navigation — sees it.
      if (titleRef.current && titleDirtyRef.current) {
        titleDirtyRef.current = false;
        try {
          await fetch(`/api/conversations/${encodeURIComponent(slug)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: titleRef.current }),
          });
        } catch {
          // The title effect below retries on its next run.
          titleDirtyRef.current = true;
        }
      }
      await queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
      if (cancelled) return;
      setConversationId(slug);
      conversationIdRef.current = slug;
      try {
        localStorage.setItem("myntle-conv", slug);
      } catch {
        // Ignore.
      }
      try {
        window.history.replaceState(null, "", `/chat/${encodeURIComponent(slug)}`);
      } catch {
        // Ignore.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, status, messages.length, queryClient]);

  // Stay on the thread the route points at when moving between chats.
  // Guarded by ref so it only fires when the slug actually changes —
  // never in a loop that wipes freshly loaded history. The first mount
  // keeps its seeded state; only real switches clear.
  useEffect(() => {
    if (routeSlugRef.current === initialConversationId) return;
    const firstMount = routeSlugRef.current === undefined;
    routeSlugRef.current = initialConversationId ?? null;
    if (firstMount) return;
    switchConversation(initialConversationId ?? null, false);
  }, [initialConversationId, switchConversation]);

  // Browser back/forward navigation between chats (popstate).
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      let targetId: string | null = null;
      if (path.startsWith("/chat/")) {
        const rawSlug = path.slice(6);
        if (rawSlug) {
          targetId = decodeURIComponent(rawSlug);
        }
      }
      switchConversation(targetId, false);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [switchConversation]);

  const requestTitle = useCallback((prompt: string) => {
    const id = (titleReqRef.current += 1);
    titlePromiseRef.current = fetch("/api/title", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { title?: string } | null) => {
        if (id !== titleReqRef.current) return;
        const cleaned = body?.title?.trim();
        // No prompt fallback: a failed generation leaves the title null
        // ("New chat") and the next turn retries, when the latest prompt
        // describes the thread better anyway.
        if (!cleaned) return;
        setTitle(cleaned);
        titleDirtyRef.current = true;
      })
      .catch(() => {
        // Keep null so the next turn retries.
      });
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!connected) {
        gatedIdRef.current += 1;
        setGated((current) => [
          ...current,
          { id: gatedIdRef.current, prompt: trimmed },
        ]);
        pendingRef.current = trimmed;
        return;
      }
      if (!title) requestTitle(trimmed);
      void sendMessage({
        text: trimmed,
        metadata: { createdAt: new Date().toISOString() },
      });
    },
    [connected, sendMessage, title, requestTitle],
  );

  // Once the wallet lands, the gated turns clear and the latest prompt starts
  // the real conversation, so the thread reads as a fresh chat.
  useEffect(() => {
    if (!connected || !pendingRef.current) return;
    const next = pendingRef.current;
    pendingRef.current = null;
    setGated([]);
    if (!title) requestTitle(next);
    void sendMessage({
      text: next,
      metadata: { createdAt: new Date().toISOString() },
    });
  }, [connected, sendMessage, title, requestTitle]);

  const newChat = useCallback(() => {
    switchConversation(null);
    focusComposer({ clearDraft: true });
  }, [switchConversation]);

  const rename = useCallback(
    (next: string) => {
      const cleaned = next.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      if (!cleaned || cleaned === titleRef.current?.trim()) return;
      // A manual rename wins over an in-flight generated title.
      titleReqRef.current += 1;
      setTitle(cleaned);
      titleDirtyRef.current = true;
    },
    [],
  );

  // Rename from a sidebar row. A row can name any saved chat, not only the
  // open one, so this writes through directly instead of going through the
  // title state the open thread owns.
  const renameThread = useCallback(
    (id: string, next: string) => {
      const cleaned = next.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      if (!cleaned) return;
      const current =
        (id === conversationId ? titleRef.current : null) ?? findThreadLabel(id);
      if (current && cleaned === current.trim()) return;
      titleReqRef.current += 1;
      if (id === conversationId) {
        // Already saved below; the dirty-title effect must not send it twice.
        titleDirtyRef.current = false;
        setTitle(cleaned);
      }
      void fetch(`/api/conversations/${encodeURIComponent(id)}`, {
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
    [conversationId, queryClient],
  );

  // Delete from a sidebar row. The row collapses first and only then calls
  // in, so this runs after the exit animation. A soft delete moves the chat
  // to trash; deleting the open thread returns to the composer, and the
  // cache entry goes too, so a stale history cannot be served.
  const deleteThread = useCallback(
    (id: string) => {
      void fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
        .then((res) => {
          if (!res.ok) throw new Error("delete failed");
        })
        .then(() => {
          deleteCachedMessages(id);
          if (id === conversationId) newChat();
          void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: TRASHED_QUERY_KEY });
        })
        .catch(() => queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY }));
    },
    [conversationId, newChat, queryClient],
  );

  const openTrash = useCallback(() => {
    router.push("/trash");
  }, [router]);

  // Persist locally-set titles (generated or renamed) once. Titles loaded
  // from the database never mark dirty, so opening a chat doesn't reorder it.
  useEffect(() => {
    if (!conversationId || !title || !titleDirtyRef.current) return;
    titleDirtyRef.current = false;
    void fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY }))
      .catch(() => {
        titleDirtyRef.current = true;
      });
  }, [conversationId, title, queryClient]);

  const regenerateTurn = useCallback(
    (messageId?: string) => {
      if (!connected) {
        openWalletPicker();
        return;
      }
      void regenerate({ messageId });
    },
    [connected, regenerate],
  );

  const editAndSend = useCallback(
    (messageId: string, nextText: string) => {
      const trimmed = nextText.trim();
      if (!trimmed) return;
      if (!connected) {
        openWalletPicker();
        return;
      }
      void sendMessage({
        text: trimmed,
        messageId,
        metadata: { createdAt: new Date().toISOString() },
      });
    },
    [connected, sendMessage],
  );

  const respondToApproval = useCallback(
    (approvalId: string, approved: boolean) => {
      void addToolApprovalResponse({ id: approvalId, approved });
    },
    [addToolApprovalResponse],
  );

  const live = useMemo(
    () => ({
      messages,
      status,
      send,
      error: error?.message,
      regenerate: regenerateTurn,
      editAndSend,
      respondToApproval,
      settlements,
    }),
    [messages, status, send, error, regenerateTurn, editAndSend, respondToApproval, settlements],
  );

  // Seeded mounts skip the history fetch (messages already present) but
  // still need the saved title. The sidebar list carries it.
  useEffect(() => {
    if (!conversationId || title || messages.length === 0) return;
    const threadLabel = threads.find((t) => t.id === conversationId)?.label;
    if (threadLabel) {
      titleDirtyRef.current = false;
      setTitle(threadLabel);
    }
  }, [conversationId, title, messages.length, threads]);

  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasMoreOlder) return;
    const pag = threadPagination.get(conversationId);
    let beforeSeq = pag?.oldestSeq;
    if (beforeSeq === undefined) {
      for (const m of messages) {
        const s = (m.metadata as { seq?: number } | undefined)?.seq;
        if (s !== undefined && (beforeSeq === undefined || s < beforeSeq)) {
          beforeSeq = s;
        }
      }
    }
    if (beforeSeq === undefined) return;

    setLoadingOlder(true);
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=20&beforeSeq=${beforeSeq}`,
      );
      if (!res.ok) {
        setLoadingOlder(false);
        return;
      }
      const body = (await res.json()) as {
        messages?: UIMessage[];
        hasMore?: boolean;
        oldestSeq?: number;
      };
      if (body.messages && body.messages.length > 0) {
        const older = body.messages;
        setMessages((current) => {
          const existingIds = new Set(current.map((m) => m.id));
          const uniqueOlder = older.filter((m) => !existingIds.has(m.id));
          const merged = [...uniqueOlder, ...current];
          if (conversationId) setCachedMessages(conversationId, merged);
          return merged;
        });
        const nextHasMore = Boolean(body.hasMore);
        setHasMoreOlder(nextHasMore);
        threadPagination.set(conversationId, {
          hasMore: nextHasMore,
          oldestSeq: body.oldestSeq ?? beforeSeq,
        });
      } else {
        setHasMoreOlder(false);
        threadPagination.set(conversationId, {
          hasMore: false,
          oldestSeq: beforeSeq,
        });
      }
    } catch {
      // Ignore network error; retryable on next scroll
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, loadingOlder, hasMoreOlder, messages, setMessages]);

  return (
    <Harness
      live={live}
      gated={gated}
      title={title}
      onNewChat={newChat}
      onRename={rename}
      threads={threads}
      onPickThread={onPickThread}
      activeChatId={conversationId}
      onHoverThread={prefetchThread}
      onRenameThread={renameThread}
      onDeleteThread={deleteThread}
      trashCount={trashed.length}
      onOpenTrash={openTrash}
      loadingThread={loadingThread}
      onLoadOlder={loadOlderMessages}
      hasMoreOlder={hasMoreOlder}
      loadingOlder={loadingOlder}
      footer={<WalletButton />}
      footerCompact={<WalletButton compact />}
      models={MODELS}
      onModelChange={setModel}
    />
  );
}
