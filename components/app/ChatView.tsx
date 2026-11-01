"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Harness from "@/components/site/Harness";
import { WalletButton } from "@/components/app/WalletButton";
import { MODELS, DEFAULT_MODEL } from "@/lib/ai/provider";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";
import { openWalletPicker } from "@/components/app/ConnectGate";
import { useWallet } from "@/lib/wallet/registry";
import {
  clearThreadCache,
  fetchThreads,
  fetchTrashed,
  findThreadLabel,
  messageCache,
  prefetchInflight,
  prefetchThread,
  readThreadsCache,
  type ThreadItem,
  type TrashedItem,
} from "@/components/app/threadCache";

export type GatedExchange = { id: number; prompt: string };

export default function ChatView({
  initialConversationId = null,
}: {
  initialConversationId?: string | null;
}) {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const { connected } = useWallet();
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );

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

  const { messages, sendMessage, setMessages, status, error, regenerate } = useChat({
    // Seed first paint from cache so a thread route never flashes the
    // composer. useChat only reads this once; later switches go through
    // setMessages in the effects below.
    messages: initialConversationId
      ? (messageCache.get(initialConversationId) ?? [])
      : [],
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ model, conversationId, title }),
    }),
  });

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
      setLoadingThread(false);
      router.replace("/");
      // Allow the reverse cascade exit animation in the sidebar to play smoothly
      timer = setTimeout(() => {
        setThreads([]);
        setTrashed([]);
      }, 350);
    };

    window.addEventListener("myntle:sign-out", handleSignOut);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("myntle:sign-out", handleSignOut);
    };
  }, [router, setMessages]);

  const [threads, setThreads] = useState<ThreadItem[]>(() => readThreadsCache());
  const [trashed, setTrashed] = useState<TrashedItem[]>([]);

  const refreshThreads = useCallback(async () => {
    setThreads(await fetchThreads());
  }, []);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  const refreshTrash = useCallback(async () => {
    setTrashed(await fetchTrashed(50));
  }, []);

  useEffect(() => {
    void refreshTrash();
  }, [refreshTrash]);

  // Refresh sidebar threads and trash when wallet connection/sign-in lands.
  useEffect(() => {
    if (!connected) return;
    void refreshThreads();
    void refreshTrash();
  }, [connected, refreshThreads, refreshTrash]);

  useEffect(() => {
    const handleSignIn = () => {
      void refreshThreads();
      void refreshTrash();
    };

    window.addEventListener("myntle:sign-in", handleSignIn);
    return () => window.removeEventListener("myntle:sign-in", handleSignIn);
  }, [refreshThreads, refreshTrash]);

  // Keep the sidebar fresh after each finished turn.
  useEffect(() => {
    if (status === "submitted" || status === "streaming") return;
    if (messages.length === 0) return;
    refreshThreads();
  }, [status, messages.length, refreshThreads]);

  // Surface a brand-new chat in the sidebar while its first answer streams
  // instead of waiting for the turn to finish. The row is in Supabase from
  // the moment the user message is saved, which happens before streaming
  // starts. The immediate fetch usually races the insert, hence one delayed
  // retry; the post-turn refresh above stays as the backstop.
  useEffect(() => {
    if (conversationId || messages.length === 0) return;
    if (status !== "submitted" && status !== "streaming") return;
    refreshThreads();
    const timer = setTimeout(refreshThreads, 2000);
    return () => clearTimeout(timer);
  }, [conversationId, messages.length, status, refreshThreads]);

  const onPickThread = useCallback(
    (id: string) => {
      router.push(`/chat/${encodeURIComponent(id)}`);
    },
    [router],
  );

  // Keep this chat's cache entry fresh as the conversation grows.
  useEffect(() => {
    if (conversationId && messages.length > 0)
      messageCache.set(conversationId, messages);
  }, [conversationId, messages]);

  useEffect(() => {
    if (!conversationId || messages.length > 0) return;
    // Visited before: render instantly, revalidate quietly underneath.
    const cached = messageCache.get(conversationId);
    if (cached && cached.length > 0) {
      setMessages(cached);
      setLoadingThread(false);
      const threadLabel = threads.find((t) => t.id === conversationId)?.label;
      if (threadLabel) {
        titleDirtyRef.current = false;
        setTitle(threadLabel);
      }
    }
    let cancelled = false;
    void fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`)
      .then((res) => {
        if (res.status === 401) {
          clearThreadCache();
          setMessages([]);
          setConversationId(null);
          setTitle(null);
          setLoadingThread(false);
          router.replace("/");
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then(
        (
          body: {
            messages?: UIMessage[];
            title?: string | null;
          } | null,
        ) => {
          if (!body || cancelled) return;
          if (body.messages && body.messages.length > 0) {
            messageCache.set(conversationId, body.messages);
            setMessages(body.messages);
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
      await refreshThreads();
      if (cancelled) return;
      setConversationId(slug);
      try {
        localStorage.setItem("myntle-conv", slug);
      } catch {
        // Ignore.
      }
      try {
        router.push(`/chat/${encodeURIComponent(slug)}`);
      } catch {
        // Ignore.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, status, messages.length, router, refreshThreads]);

  const [gated, setGated] = useState<GatedExchange[]>([]);
  // Seed from the sidebar cache so a thread route paints its real name on
  // the first frame instead of flashing "New chat".
  const [title, setTitle] = useState<string | null>(() =>
    findThreadLabel(initialConversationId ?? null),
  );
  // Thread routes start loading unless cache already covers first paint;
  // the composer never loads.
  const [loadingThread, setLoadingThread] = useState(() => {
    if (!initialConversationId) return false;
    const cached = messageCache.get(initialConversationId);
    return !cached || cached.length === 0;
  });
  const pendingRef = useRef<string | null>(null);
  const gatedIdRef = useRef(0);
  const titleReqRef = useRef(0);
  // Latest title value for the post-stream finalizer, which runs async.
  const titleRef = useRef<string | null>(null);
  // In-flight /api/title promise, so finalization can wait for it instead
  // of navigating while the generated title is still unresolved.
  const titlePromiseRef = useRef<Promise<void> | null>(null);
  // True only when the title was set locally (generated or renamed) and not
  // yet saved. Titles loaded from the database never set this.
  const titleDirtyRef = useRef(false);
  const routeSlugRef = useRef<string | null | undefined>(undefined);
  // Mirror for async readers (the post-stream finalizer runs after awaits).
  titleRef.current = title;

  // Stay on the thread the route points at when moving between chats.
  // Guarded by ref so it only fires when the slug actually changes —
  // never in a loop that wipes freshly loaded history. The first mount
  // keeps its seeded state; only real switches clear.
  useEffect(() => {
    if (routeSlugRef.current === initialConversationId) return;
    const firstMount = routeSlugRef.current === undefined;
    routeSlugRef.current = initialConversationId ?? null;
    setConversationId(initialConversationId ?? null);
    if (firstMount) return;
    setMessages([]);
    // Keep the outgoing title out of the incoming thread: use the cached
    // name when we have it, so the bar never flashes "New chat" mid-switch.
    setTitle(findThreadLabel(initialConversationId ?? null));
    titleDirtyRef.current = false;
    // Thread routes show the skeleton until history lands; the composer
    // never loads, so it stays false there.
    setLoadingThread(initialConversationId != null);
  }, [initialConversationId, setMessages]);

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
      void sendMessage({ text: trimmed });
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
    void sendMessage({ text: next });
  }, [connected, sendMessage, title, requestTitle]);

  const newChat = useCallback(() => {
    titleReqRef.current += 1;
    titlePromiseRef.current = null;
    pendingRef.current = null;
    setGated([]);
    setTitle(null);
    setConversationId(null);
    try {
      localStorage.removeItem("myntle-conv");
    } catch {
      // Ignore.
    }
    setMessages([]);
    setLoadingThread(false);
    router.push("/");
  }, [setMessages, router]);

  const rename = useCallback(
    (next: string) => {
      const cleaned = next.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      if (!cleaned) return;
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
        .then(() => refreshThreads())
        .catch(() => refreshThreads());
    },
    [conversationId, refreshThreads],
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
          messageCache.delete(id);
          prefetchInflight.delete(id);
          if (id === conversationId) newChat();
          refreshThreads();
          refreshTrash();
        })
        .catch(() => refreshThreads());
    },
    [conversationId, newChat, refreshThreads, refreshTrash],
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
      .then(() => refreshThreads())
      .catch(() => {
        titleDirtyRef.current = true;
      });
  }, [conversationId, title, refreshThreads]);

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
      void sendMessage({ text: trimmed, messageId });
    },
    [connected, sendMessage],
  );

  const live = useMemo(
    () => ({
      messages,
      status,
      send,
      error: error?.message,
      regenerate: regenerateTurn,
      editAndSend,
    }),
    [messages, status, send, error, regenerateTurn, editAndSend],
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
      footer={<WalletButton />}
      footerCompact={<WalletButton compact />}
      models={MODELS}
      onModelChange={setModel}
    />
  );
}
