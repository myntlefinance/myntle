"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Harness from "@/components/site/Harness";
import { AccountControl } from "@/components/app/AccountControl";
import { MODELS, DEFAULT_MODEL } from "@/lib/ai/provider";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";
import { focusComposer } from "@/lib/composer";
import { openWalletPicker } from "@/components/app/ConnectGate";
import { openSignIn } from "@/components/app/SignInDialog";
import { SUPER_CONTINUE_EVENT } from "@/lib/intents/user-session";
import { useAuth } from "@/lib/auth/auth-provider";
import { chatRequestHeaders, chatSuperUnlocked } from "@/components/app/chatTransport";
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
  readThreadsCache,
  readTrashedCache,
  setCachedMessages,
  threadPagination,
  writeThreadsCache,
  writeTrashedCache,
  type ThreadItem,
  type TrashedItem,
} from "@/components/app/threadCache";
import type { SettlementSnapshot } from "@/components/app/approvals";
import type { DepositMetadata } from "@/lib/intents/deposit-metadata";
import {
  isToolPart,
  outputOf,
  toolNameOf,
  type ToolPart,
} from "@/components/app/toolParts";

export type GatedExchange = { id: number; prompt: string };

/**
 * True when the assistant's last turn stopped on the super account: either it
 * asked for the unlock, or the private read came back locked. Only then is
 * there a paused request worth resuming after the user unlocks.
 */
function stoppedOnUnlock(message: UIMessage | undefined): boolean {
  if (!message || message.role !== "assistant") return false;
  return message.parts.some((part) => {
    if (!isToolPart(part.type)) return false;
    const tool = toolNameOf(part as ToolPart);
    if (tool === "request_super_unlock") return true;
    return (
      tool === "get_super_balances" &&
      outputOf(part as ToolPart)?.needsSuperUnlock === true
    );
  });
}

export default function ChatView({
  initialConversationId = null,
}: {
  initialConversationId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { data: threads = [] } = useThreads();
  const { data: trashed = [] } = useTrashed();
  const [model, setModel] = useState(DEFAULT_MODEL);
  const { connected, account, identity, signedIn, status: sessionStatus, refresh: refreshSession } = useAuth();
  // Chats require a signed-in session, not merely a connected wallet. A
  // connected-but-unsigned visitor queues prompts exactly like a
  // disconnected one; the gate offers the signature instead of a send.
  const accountRef = useRef(account);
  accountRef.current = account;
  // A passkey session is signed in with no connected wallet, so the
  // transport reads its identity from a ref rather than from `account`.
  const identityRef = useRef(identity);
  identityRef.current = identity;
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

  const { messages, sendMessage, setMessages, status, clearError, regenerate, addToolApprovalResponse } = useChat({
    // Seed first paint from cache so a thread route never flashes the
    // composer. useChat only reads this once; later switches go through
    // setMessages in switchConversation.
    messages: initialConversationId
      ? (getCachedMessages(initialConversationId) ?? [])
      : [],
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // A fresh access token per request, refreshed silently from the
      // browser-held refresh token. The server borrows it for the turn. A
      // passkey session is keyed by its account, not by a wallet.
      headers: async (): Promise<Record<string, string>> =>
        chatRequestHeaders({
          identity: identityRef.current,
          account: accountRef.current,
        }),
      body: () => ({
        model,
        conversationId: conversationIdRef.current,
        title: titleRef.current,
        walletAddress: accountRef.current?.address,
        walletChain: accountRef.current?.kind,
        superUnlocked: chatSuperUnlocked({
          identity: identityRef.current,
          account: accountRef.current,
        }),
      }),
    }),
  });
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // A failed turn must look the same live as it does after a refresh. The
  // server persists `error-<userId>` ("An error occurred.") when the stream
  // fails, but the client only held the transient `error` state — so the red
  // line vanished on the next send while the database kept the bubble.
  // Materialize the same deterministic bubble here and clear the transient
  // error, dropping any trailing partial from the failed turn to match the
  // persisted shape (user + error, no partial).
  useEffect(() => {
    if (status !== "error") return;
    setMessages((current) => {
      const lastUser = [...current].reverse().find((m) => m.role === "user");
      if (!lastUser) return current;
      const errorId = `error-${lastUser.id}`;
      if (current.some((m) => m.id === errorId)) return current;
      const errorMessage: UIMessage = {
        id: errorId,
        role: "assistant",
        parts: [{ type: "text", text: "An error occurred." }],
        metadata: { createdAt: new Date().toISOString() },
      };
      const last = current[current.length - 1];
      const lastUserIdx = current.map((m) => m.id).lastIndexOf(lastUser.id);
      if (
        last &&
        last.role === "assistant" &&
        current.length - 1 > lastUserIdx
      ) {
        return [...current.slice(0, -1), errorMessage];
      }
      return [...current, errorMessage];
    });
    clearError();
  }, [status, setMessages, clearError]);

  // Private chat route guard: a signed-out visitor cannot view a saved
  // thread. While the session check is still in flight, nothing redirects.
  useEffect(() => {
    if (initialConversationId && sessionStatus === "signed-out") {
      clearThreadCache();
      router.replace("/");
    }
  }, [initialConversationId, sessionStatus, router]);

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
              deposit?: DepositMetadata | null;
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
                deposit: s.deposit,
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

      // Cancel any pending rename retry state on switch.
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
      // NULL is untitled; a stored "New chat" string is a manual rename and
      // must survive untouched.
      if (threadLabel != null) {
        titleDirtyRef.current = false;
        setTitle(threadLabel);
      } else if (titleRef.current?.trim() === "New chat") {
        // Stale placeholder from before untitled became NULL.
        titleDirtyRef.current = false;
        setTitle(null);
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
          // The cookie is gone or expired. Say so everywhere at once
          // instead of only on this screen.
          void refreshSession();
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
          // NULL means untitled; only a stored string counts as named.
          if (body.title != null) {
            titleDirtyRef.current = false;
            setTitle(body.title);
          } else if (titleRef.current?.trim() === "New chat") {
            titleDirtyRef.current = false;
            setTitle(null);
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
  }, [conversationId, messages.length, setMessages, threads, refreshSession]);

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
      // The server `after()` in /api/chat owns title generation; the
      // post-turn threads invalidation carries it to the sidebar. No local
      // wait or PATCH here.
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

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!signedIn) {
        gatedIdRef.current += 1;
        setGated((current) => [
          ...current,
          { id: gatedIdRef.current, prompt: trimmed },
        ]);
        pendingRef.current = trimmed;
        return;
      }
      void sendMessage({
        text: trimmed,
        metadata: { createdAt: new Date().toISOString() },
      });
    },
    [signedIn, sendMessage],
  );

  // After unlocking, continue the paused turn instead of resending the
  // prompt as a new user message. Regenerating drops the "locked" reply and
  // answers the same request now that the token exists.
  useEffect(() => {
    const onContinue = () => {
      const lastAssistant = [...messagesRef.current]
        .reverse()
        .find((message) => message.role === "assistant");
      if (!lastAssistant || !stoppedOnUnlock(lastAssistant)) return;
      void regenerate({
        messageId: lastAssistant.id,
        body: { superJustUnlocked: true },
      });
    };
    window.addEventListener(SUPER_CONTINUE_EVENT, onContinue);
    return () => window.removeEventListener(SUPER_CONTINUE_EVENT, onContinue);
  }, [regenerate]);

  // Once the sign-in lands, the gated turns clear and the latest prompt starts
  // the real conversation, so the thread reads as a fresh chat.
  useEffect(() => {
    if (!signedIn || !pendingRef.current) return;
    const next = pendingRef.current;
    pendingRef.current = null;
    setGated([]);
    void sendMessage({
      text: next,
      metadata: { createdAt: new Date().toISOString() },
    });
  }, [signedIn, sendMessage]);

  const newChat = useCallback(() => {
    switchConversation(null);
    focusComposer({ clearDraft: true });
  }, [switchConversation]);

  const rename = useCallback(
    (next: string) => {
      const cleaned = next.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      if (!cleaned || cleaned === titleRef.current?.trim()) return;
      setTitle(cleaned);
      titleDirtyRef.current = true;
    },
    [],
  );

  // Rename from a sidebar row. A row can name any saved chat, not only the
  // open one, so this writes through directly instead of going through the
  // title state the open thread owns. Paints instantly via the query cache
  // + memory cache; no list refetch — the row keeps its place and the PATCH
  // settles in the background. A failed write rolls back to the previous
  // label so the row never sticks on a name the server rejected.
  const renameThread = useCallback(
    (id: string, next: string) => {
      const cleaned = next.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      if (!cleaned) return;
      const current =
        (id === conversationId ? titleRef.current : null) ?? findThreadLabel(id);
      if (current && cleaned === current.trim()) return;
      const prevTitle = titleRef.current;
      if (id === conversationId) {
        // Already saved below; the dirty-title effect must not send it twice.
        titleDirtyRef.current = false;
        setTitle(cleaned);
      }
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
          if (id === conversationId) setTitle(prevTitle);
        });
    },
    [conversationId, queryClient],
  );

  // Delete from a sidebar row. The row collapses first and only then calls
  // in, so this runs after the exit animation. A soft delete moves the chat
  // to trash; deleting the open thread returns to the composer, and the
  // cache entry goes too, so a stale history cannot be served. No list
  // refetch: the DELETE response carries the authoritative deletedAt, so
  // both lists are patched locally (query cache + persisted cache).
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
          if (id === conversationId) newChat();
          const entry: TrashedItem = { id, label, deletedAt };
          queryClient.setQueryData<ThreadItem[]>(THREADS_QUERY_KEY, (old) =>
            old ? old.filter((t) => t.id !== id) : old,
          );
          writeThreadsCache(readThreadsCache().filter((t) => t.id !== id));
          queryClient.setQueryData<TrashedItem[]>(TRASHED_QUERY_KEY, (old) =>
            old
              ? [entry, ...old.filter((t) => t.id !== id)]
              : [entry],
          );
          const prevTrashed = readTrashedCache().filter((t) => t.id !== id);
          writeTrashedCache([entry, ...prevTrashed]);
        })
        .catch(() => {
          // No list change was made, so nothing to roll back. SidebarNav's
          // safety timer releases the collapsed row so it glides back.
        });
    },
    [conversationId, newChat, queryClient],
  );

  const openTrash = useCallback(() => {
    router.push("/trash");
  }, [router]);

  const openPortfolio = useCallback(() => {
    router.push("/portfolio");
  }, [router]);

  const openHistory = useCallback(() => {
    router.push("/history");
  }, [router]);

  // Persist header renames once. Titles loaded from the database never
  // mark dirty, so opening a chat doesn't touch it. Generated titles land
  // via the server `after()` + sidebar refresh, not from here. Paints instantly via the query cache + memory cache; no list
  // refetch — a rename keeps its row in place. New rows arrive through the
  // post-turn list refresh, not from here. A failed write marks dirty again
  // so the next run retries.
  useEffect(() => {
    if (!conversationId || !title || !titleDirtyRef.current) return;
    titleDirtyRef.current = false;
    const id = conversationId;
    const label = title;
    queryClient.setQueryData<ThreadItem[]>(THREADS_QUERY_KEY, (old) => {
      if (!old) return old;
      if (!old.some((t) => t.id === id)) return old;
      return old.map((t) => (t.id === id ? { ...t, label } : t));
    });
    const cached = readThreadsCache();
    if (cached.some((t) => t.id === id)) {
      writeThreadsCache(
        cached.map((t) => (t.id === id ? { ...t, label } : t)),
      );
    }
    void fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: label }),
    }).catch(() => {
      titleDirtyRef.current = true;
    });
  }, [conversationId, title, queryClient]);

  // A connected wallet still has to sign in, so the prompt matches the
  // gate rather than sending an unsigned visitor to the connect picker.
  const askToSignIn = useCallback(() => {
    if (connected) openSignIn();
    else openWalletPicker();
  }, [connected]);

  const regenerateTurn = useCallback(
    (messageId?: string) => {
      if (!signedIn) {
        askToSignIn();
        return;
      }
      void regenerate({ messageId });
    },
    [signedIn, askToSignIn, regenerate],
  );

  const editAndSend = useCallback(
    (messageId: string, nextText: string) => {
      const trimmed = nextText.trim();
      if (!trimmed) return;
      if (!signedIn) {
        askToSignIn();
        return;
      }
      void sendMessage({
        text: trimmed,
        messageId,
        metadata: { createdAt: new Date().toISOString() },
      });
    },
    [signedIn, askToSignIn, sendMessage],
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
      // Failed turns are materialized as durable "An error occurred."
      // bubbles (matching the persisted row), so the transient red state is
      // never shown — it would vanish on the next send while the bubble stays.
      error: undefined,
      regenerate: regenerateTurn,
      editAndSend,
      respondToApproval,
      settlements,
    }),
    [messages, status, send, regenerateTurn, editAndSend, respondToApproval, settlements],
  );

  // Seeded mounts skip the history fetch (messages already present) but
  // still need the saved title. The sidebar list carries it. NULL is
  // untitled; a stored "New chat" string is a manual rename.
  useEffect(() => {
    const needsTitle = !title || title.trim() === "New chat";
    if (!conversationId || !needsTitle || messages.length === 0) return;
    const found = threads.find((t) => t.id === conversationId);
    if (!found) return;
    if (found.label != null) {
      titleDirtyRef.current = false;
      setTitle(found.label);
    } else if (title?.trim() === "New chat") {
      titleDirtyRef.current = false;
      setTitle(null);
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
      onOpenPortfolio={openPortfolio}
      onOpenHistory={openHistory}
      loadingThread={loadingThread}
      onLoadOlder={loadOlderMessages}
      hasMoreOlder={hasMoreOlder}
      loadingOlder={loadingOlder}
      footer={<AccountControl />}
      footerCompact={<AccountControl compact />}
      models={MODELS}
      onModelChange={setModel}
    />
  );
}
