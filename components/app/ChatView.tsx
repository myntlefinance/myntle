"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import type {
  PrepareReconnectToStreamRequest,
  PrepareSendMessagesRequest,
  UIMessage,
} from "ai";
import Harness from "@/components/site/Harness";
import { AccountControl } from "@/components/app/AccountControl";
import { DEFAULT_MODEL } from "@/lib/ai/provider";
import {
  SUPER_CONTINUE_PROMPT,
  withoutSuperContinueMessages,
} from "@/lib/ai/messages/continuation";
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
  newestTranscript,
  loadThreadMessages,
  markThreadRead,
  prefetchThread,
  readThreadsCache,
  readTrashedCache,
  setCachedMessages,
  threadPagination,
  threadReadRecently,
  writeThreadsCache,
  writeTrashedCache,
  type ThreadItem,
  type TrashedItem,
} from "@/components/app/threadCache";
import {
  collectApprovalIds,
  collectApprovalAssetIds,
  type ApprovalDecisionContext,
  type ApprovalDecisions,
  type SettlementSnapshot,
} from "@/components/app/approvals";
import {
  approvalRecordNeedsRead,
  fetchApprovalRecords,
  readApprovalRecords,
  rememberApprovalDecision,
} from "@/components/app/approvalRecords";
import { useAssetMetaResolution } from "@/components/app/useAssetMeta";
import {
  harvestAssetMeta,
  isToolPart,
  outputOf,
  toolNameOf,
  type AssetMeta,
  type ToolPart,
} from "@/components/app/toolParts";

export type GatedExchange = { id: number; prompt: string };

/** A saved thread read on the server, so a hard load does not wait for the
 * same messages to come back through a client fetch after the wallet bundle. */
export type InitialThread = {
  messages: UIMessage[];
  title: string | null;
  hasMore: boolean;
  oldestSeq?: number;
  /**
   * When the server read this thread. A route payload can sit in the client
   * cache, so `Date.now()` at mount is not the age of the data: this is.
   */
  seededAt?: number;
  /** The durable run that owns the turn, when a turn is in flight. */
  activeRunId?: string | null;
  activeRunStartedAt?: string | null;
  activeRunFinishedAt?: string | null;
};

/** No card is waiting: every card on screen has a known record. */
const NO_PENDING_APPROVALS: ReadonlySet<string> = new Set();

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
  initialThread = null,
}: {
  initialConversationId?: string | null;
  initialThread?: InitialThread | null;
}) {
  const queryClient = useQueryClient();
  const { connected, account, identity, signedIn, status: sessionStatus, refresh: refreshSession } = useAuth();
  // The cached lists paint immediately; the network read waits until there
  // is a session to read. A signed-out visitor used to make two 401 requests
  // and clear the cache on every load. `sessionStatus` is the authentication
  // answer; `signedIn` additionally requires the wallet to be able to sign,
  // which a disconnected-on-reload wallet cannot, and the list does not need.
  const sessionAuthenticated = sessionStatus === "signed-in";
  const { data: threads = [] } = useThreads(sessionAuthenticated);
  const { data: trashed = [] } = useTrashed(50, sessionAuthenticated);
  const model = DEFAULT_MODEL;
  // Chats require a signed-in session, not merely a connected wallet. A
  // connected-but-unsigned visitor queues prompts exactly like a
  // disconnected one; the gate offers the signature instead of a send.
  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);
  // A passkey session is signed in with no connected wallet, so the
  // transport reads its identity from a ref rather than from `account`.
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  // Database settlements read in this tab, keyed by tool approval id. A read
  // is requested by a card that is actually on screen, and the map survives a
  // switch so a revisited card keeps its address and state.
  const [settlements, setSettlements] = useState<
    Record<string, SettlementSnapshot>
  >({});
  // Decisions returned by a card's visible read, keyed the same way. The
  // approval cache handles revisits; this keeps the current answer immediate
  // without waiting for the cache to be re-read.
  const [fetchedDecisions, setFetchedDecisions] = useState<ApprovalDecisions>(
    {},
  );
  // Cards whose record has been read for this visit, including an empty
  // answer. An empty answer still earns a read: the card falls back to its
  // message snapshot instead of holding a skeleton forever.
  const [readApprovalIds, setReadApprovalIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const readApprovalIdsRef = useRef(readApprovalIds);
  useEffect(() => {
    readApprovalIdsRef.current = readApprovalIds;
  }, [readApprovalIds]);
  // A screen can reveal several cards at once. Coalesce them into one read
  // rather than one request per card.
  const approvalReadQueueRef = useRef(new Set<string>());
  const approvalReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const conversationIdRef = useRef<string | null>(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  // Chats this tab has generated in, with when the turn started. Switching
  // back within the window reconnects to the durable run instead of showing
  // the partial cached at the moment of leaving.
  const liveRunsRef = useRef<Map<string, number>>(new Map());

  const [title, setTitle] = useState<string | null>(() =>
    initialThread
      ? initialThread.title
      : findThreadLabel(initialConversationId ?? null),
  );
  const titleRef = useRef<string | null>(title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  const titleDirtyRef = useRef(false);

  const [gated, setGated] = useState<GatedExchange[]>([]);
  const gatedIdRef = useRef(0);
  const pendingRef = useRef<string | null>(null);

  const [loadingThread, setLoadingThread] = useState(() => {
    if (!initialConversationId) return false;
    if (initialThread?.messages.length) return false;
    const cached = getCachedMessages(initialConversationId);
    return !cached || cached.length === 0;
  });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [assetGate, setAssetGate] = useState(!!initialConversationId);
  const [hasMoreOlder, setHasMoreOlder] = useState(() => {
    if (!initialConversationId) return false;
    if (initialThread) return initialThread.hasMore;
    return Boolean(threadPagination.get(initialConversationId)?.hasMore);
  });
  // A server-seeded thread has already been read for this visit. Marking it
  // loaded skips the duplicate client fetch without changing what a switch
  // to another chat does.
  const lastLoadedConvRef = useRef<string | null>(
    initialThread?.messages.length ? initialConversationId : null,
  );
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

  // Decided once on mount: the run the server named is live, not a marker
  // left behind by a dead one, and the chat should reconnect to it. Kept out
  // of render so the clock does not make the resume decision flicker.
  const [resumeInterruptedTurn] = useState(() =>
    Boolean(
      initialThread?.activeRunId &&
        !initialThread.activeRunFinishedAt &&
        initialThread.activeRunStartedAt &&
        Date.now() - new Date(initialThread.activeRunStartedAt).getTime() <
          6 * 60_000,
    ),
  );

  // The first render's transcript, chosen once: a later render must not swap
  // the seed under a live `useChat` instance.
  const [initialSeed] = useState(() =>
    newestTranscript(
      initialThread?.messages,
      initialConversationId
        ? getCachedMessages(initialConversationId)
        : undefined,
    ),
  );

  // The workflow transport does not take transport-level headers/body,
  // so the per-turn ones are prepared here. A fresh access token is
  // refreshed silently from the browser-held refresh token; the server
  // seals it for the run. A passkey session is keyed by its account.
  // The callbacks close over state (not refs) so the transport holds no
  // ref reads at all; it is rebuilt when the values it sends change.
  const prepareSendMessagesRequest =
    useCallback<PrepareSendMessagesRequest<UIMessage>>(
      async ({ messages: sentMessages, body, trigger, messageId }) => ({
        api: "/api/chat",
        headers: {
          "content-type": "application/json",
          ...(await chatRequestHeaders({ identity, account })),
        },
        body: {
          messages: sentMessages,
          model,
          conversationId,
          title,
          walletAddress: account?.address,
          walletChain: account?.kind,
          superUnlocked: chatSuperUnlocked({ identity, account }),
          trigger,
          messageId,
          ...(body ?? {}),
        },
      }),
      [model, conversationId, title, account, identity],
    );
  // A run is looked up through the chat it belongs to, never through a
  // run id the browser could invent. The chat page has the slug; a fresh
  // composer adopts it from the response headers below.
  const prepareReconnectToStreamRequest =
    useCallback<PrepareReconnectToStreamRequest>(
      ({ api }) => {
        const slug = conversationId;
        // A finished turn is replayed at a readable pace on the server. The
        // one case that should not animate is a reader who asked for less
        // motion.
        const reducedMotion =
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const headers = reducedMotion
          ? { "x-chat-replay-pace": "off" }
          : undefined;
        if (!slug) return { api, headers };
        return {
          api: `/api/chat/${encodeURIComponent(slug)}/stream`,
          headers,
        };
      },
      [conversationId],
    );
  // The slug the send response adopted, committed to the run-only refs in
  // the effect below. Kept as state (not a ref write in the callback) so
  // the transport never touches a ref.
  const [sentSlug, setSentSlug] = useState<string | null>(null);
  // The server names the chat before the first token. Adopting it now,
  // rather than after the turn, is what makes a reload mid-answer land
  // on the chat's own page with a run to resume.
  const onChatSendMessage = useCallback(
    (response: Response) => {
      const slug = response.headers.get("x-conversation-slug");
      if (!slug || slug === conversationId) return;
      setConversationId(slug);
      setSentSlug(slug);
      // The conversation row and its first message now exist, so the
      // sidebar can show this chat while the answer streams.
      void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
      try {
        localStorage.setItem("myntle-conv", slug);
      } catch {
        // Ignore.
      }
      try {
        window.history.replaceState(
          null,
          "",
          `/chat/${encodeURIComponent(slug)}`,
        );
      } catch {
        // Ignore.
      }
    },
    [conversationId, queryClient],
  );
  const transport = useMemo(
    () =>
      new WorkflowChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest,
        prepareReconnectToStreamRequest,
        onChatSendMessage,
      }),
    [
      prepareSendMessagesRequest,
      prepareReconnectToStreamRequest,
      onChatSendMessage,
    ],
  );

  const { messages, sendMessage, setMessages, status, clearError, regenerate, addToolApprovalResponse, stop, resumeStream } = useChat({
    // A turn is a durable workflow run now. When the page loads with an
    // unfinished run, the chat reconnects to its stream and replays from the
    // first chunk, so a reload mid-answer comes back to the same answer
    // instead of the snapshot that happened to be saved.
    resume: resumeInterruptedTurn,
    // Seed first paint from the newer of the server read and this tab's
    // persisted copy, so a route payload the router cached before the last
    // turn can never hide a message that is already on screen somewhere.
    messages: initialSeed,
    transport,
  });
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  // A switch handler reads the live status without being rebuilt on every
  // token, so the listeners that use it stay registered once.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  // Commit the slug the send response adopted to the run-only refs.
  // Runs in an effect (not in the transport callback) so the transport
  // never touches a ref, and runs before the thread loader below so the
  // loader does not fetch the half-saved history over the live stream.
  useEffect(() => {
    if (!sentSlug) return;
    // Remember this tab's live turn so switching back reconnects to the
    // run instead of showing the snapshot from the moment we left.
    liveRunsRef.current.set(sentSlug, Date.now());
    // The thread loader must not fetch the half-saved history over the
    // stream that is currently being written.
    lastLoadedConvRef.current = sentSlug;
  }, [sentSlug]);
  // The continuation turn is a transport instruction, not something the
  // person typed. It stays out of the transcript so it cannot render a user
  // bubble or count as a newer message that expires an unlock card.
  const visibleMessages = useMemo(
    () => withoutSuperContinueMessages(messages),
    [messages],
  );

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
      setFetchedDecisions({});
      setReadApprovalIds(new Set());
      readApprovalIdsRef.current = new Set();
      approvalReadQueueRef.current.clear();
      if (approvalReadTimerRef.current !== null) {
        clearTimeout(approvalReadTimerRef.current);
        approvalReadTimerRef.current = null;
      }
      setLoadingThread(false);
      setHasMoreOlder(false);
      setLoadingOlder(false);
      lastLoadedConvRef.current = null;
      liveRunsRef.current.clear();
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
      // The turn in the chat on screen is over; a switch back no longer
      // needs to replay it.
      const slug = conversationIdRef.current;
      if (slug) liveRunsRef.current.delete(slug);
      void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
      // The title is generated after the stream closes, in its own workflow
      // step, so one delayed refresh lets the row pick it up.
      const timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
      }, 2500);
      return () => clearTimeout(timer);
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

  // The record for a money card, read when that card is actually on screen:
  // the decision that was taken and the settlement it produced. The read is
  // keyed by tool approval id, so a card rejoins its row even when the chat
  // link is missing (a first turn, a trashed chat) and on a device that never
  // saw the click. A card above or below the fold is not read.
  const approvalIds = useMemo(
    () => collectApprovalIds(messages).slice(-200),
    [messages],
  );
  // The assets a card's sentence names. Resolving them before the thread
  // paints is what keeps the first card from reading as a raw contract id.
  const approvalAssetIds = useMemo(
    () => messages.flatMap((message) => collectApprovalAssetIds(message.parts)),
    [messages],
  );
  // A quote turn usually carries the catalogue rows for the assets it names.
  // Merge those first, so the thread does not wait on /api/assets for an id
  // the transcript already describes.
  const inTurnAssetMeta = useMemo(() => {
    const merged = new Map<string, AssetMeta>();
    for (const message of messages) {
      for (const [id, meta] of harvestAssetMeta(message.parts)) {
        if (!merged.has(id)) merged.set(id, meta);
      }
    }
    return merged;
  }, [messages]);
  const { pending: assetsPending } = useAssetMetaResolution(
    approvalAssetIds,
    inTurnAssetMeta,
  );
  // A record read once is kept by approval id, so a switch paints the cards
  // from what the last read said. The cache fills in the cards from earlier
  // threads; a card with no cache entry asks only when it is on screen.
  const cachedRecords = useMemo(
    () => readApprovalRecords(approvalIds),
    [approvalIds],
  );
  const decisions = useMemo(() => {
    if (sessionStatus === "signed-out") return {};
    const merged: ApprovalDecisions = { ...cachedRecords.decisions };
    Object.assign(merged, fetchedDecisions);
    return merged;
  }, [sessionStatus, cachedRecords, fetchedDecisions]);
  const mergedSettlements = useMemo(
    () => ({ ...cachedRecords.settlements, ...settlements }),
    [cachedRecords, settlements],
  );
  const knownApprovalIds = useMemo(() => {
    const known = new Set(cachedRecords.known);
    for (const id of Object.keys(fetchedDecisions)) known.add(id);
    for (const id of Object.keys(settlements)) known.add(id);
    return known;
  }, [cachedRecords, fetchedDecisions, settlements]);
  // A card with no known record and no read yet shows its footer skeleton
  // instead of a body that names a state nobody checked. A card that has been
  // read, even with an empty answer, falls back to its message snapshot.
  const pendingApprovalIds = useMemo(() => {
    if (sessionStatus === "signed-out") return NO_PENDING_APPROVALS;
    return new Set(
      approvalIds.filter(
        (id) => !knownApprovalIds.has(id) && !readApprovalIds.has(id),
      ),
    );
  }, [sessionStatus, approvalIds, knownApprovalIds, readApprovalIds]);

  /**
   * A money card scrolled into view. Queue its id so a screen with several
   * cards makes one read, and let the cache answer a card that already has a
   * decision and a settlement.
   */
  const requestApprovalRecord = useCallback(
    (approvalId: string): boolean => {
      if (sessionStatus !== "signed-in" || !approvalId) return false;
      if (readApprovalIdsRef.current.has(approvalId)) return true;
      if (!approvalRecordNeedsRead(approvalId)) return true;
      approvalReadQueueRef.current.add(approvalId);
      if (approvalReadTimerRef.current !== null) return true;
      approvalReadTimerRef.current = setTimeout(() => {
        approvalReadTimerRef.current = null;
        const ids = [...approvalReadQueueRef.current];
        approvalReadQueueRef.current.clear();
        if (ids.length === 0) return;
        void (async () => {
          let body = await fetchApprovalRecords(ids);
          // One bounded retry covers a transient 401/500. If the read still
          // fails, the card falls back to its message snapshot instead of
          // staying a skeleton forever; every money route re-checks the
          // server record before it acts.
          if (!body) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            body = await fetchApprovalRecords(ids);
          }
          if (body) {
            setFetchedDecisions((current) => ({
              ...current,
              ...body.decisions,
            }));
            setSettlements((current) => ({
              ...current,
              ...body.settlements,
            }));
          }
          setReadApprovalIds((current) => {
            const next = new Set(current);
            for (const id of ids) next.add(id);
            return next;
          });
        })();
      }, 0);
      return true;
    },
    [sessionStatus, setFetchedDecisions, setSettlements, setReadApprovalIds],
  );

  useEffect(
    () => () => {
      if (approvalReadTimerRef.current !== null) {
        clearTimeout(approvalReadTimerRef.current);
        approvalReadTimerRef.current = null;
      }
      approvalReadQueueRef.current.clear();
    },
    [],
  );

  const switchConversation = useCallback(
    (targetId: string | null, pushHistory = true) => {
      if (targetId === conversationIdRef.current) return;
      setAssetGate(targetId !== null);

      // Stash current conversation messages in cache before switching
      if (conversationIdRef.current && messagesRef.current.length > 0) {
        setCachedMessages(conversationIdRef.current, messagesRef.current);
      }
      // An active client stream belongs to the chat being left. Stop this
      // reader so its chunks cannot land in the transcript now on screen;
      // the durable run keeps generating and is reconnected when that chat
      // is opened again. stop() rejects with the transport's AbortError, so
      // its rejection is expected and must not surface as an uncaught error.
      let stopPromise: Promise<void> | null = null;
      if (statusRef.current === "submitted" || statusRef.current === "streaming") {
        stopPromise = stop().catch(() => {});
      }

      // Cancel any pending rename retry state on switch.
      titleDirtyRef.current = false;
      pendingRef.current = null;
      setGated([]);
      setLoadingOlder(false);
      // A read queued for the thread we are leaving has no card left to
      // paint. Drop it rather than spend a request on the old screen.
      approvalReadQueueRef.current.clear();
      if (approvalReadTimerRef.current !== null) {
        clearTimeout(approvalReadTimerRef.current);
        approvalReadTimerRef.current = null;
      }

      if (targetId) {
        setConversationId(targetId);
        conversationIdRef.current = targetId;
        const threadLabel = findThreadLabel(targetId);
        setTitle(threadLabel);

        const cached = getCachedMessages(targetId);
        const liveStartedAt = liveRunsRef.current.get(targetId);
        // A chat this tab was generating in, reopened inside the resume
        // window. Reconnect rather than let the thread loader replace the
        // live transcript with the snapshot saved when we left.
        const resumeLiveRun =
          Boolean(cached && cached.length > 0) &&
          liveStartedAt !== undefined &&
          Date.now() - liveStartedAt < 6 * 60_000;
        if (resumeLiveRun) lastLoadedConvRef.current = targetId;

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
        // Each open gets its own visibility reads; the cache still answers a
        // card whose record is already known without a request.
        setReadApprovalIds(new Set());
        readApprovalIdsRef.current = new Set();

        if (resumeLiveRun) {
          const resume = () => {
            if (conversationIdRef.current !== targetId) return;
            void resumeStream().catch(() => {});
          };
          // Wait for the reader we just aborted to settle, so resuming never
          // races the stop from the chat we left.
          if (stopPromise) void stopPromise.then(resume);
          else resume();
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
        setReadApprovalIds(new Set());
        readApprovalIdsRef.current = new Set();
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
    [setMessages, stop, resumeStream],
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

  // The server seeded this thread for the first paint. Mark it fresh so a
  // quick switch away and back does not refetch what the page already read.
  useEffect(() => {
    if (initialConversationId && initialThread?.messages.length) {
      // The seed's own timestamp, not the mount time: a route payload served
      // from the client cache can be minutes old, and marking it read now
      // would suppress the background revalidation it needs.
      markThreadRead(initialConversationId, initialThread.seededAt);
    }
  }, [initialConversationId, initialThread]);

  // Seeding the transcript from the tab cache is derived during render:
  // the moment the conversation changes, a warmed preview paints at once
  // and the loader below only handles the network. The switch handler
  // above already seeds its own target; this covers mounts and adopted
  // slugs, where no event carried the cached messages.
  const [seededConv, setSeededConv] = useState<string | null>(null);
  if (seededConv !== conversationId) {
    setSeededConv(conversationId);
    if (conversationId && messages.length === 0) {
      const seeded = getCachedMessages(conversationId);
      if (seeded && seeded.length > 0) {
        setMessages(seeded);
        setLoadingThread(false);
        const pag = threadPagination.get(conversationId);
        if (pag) setHasMoreOlder(pag.hasMore);
      }
    }
  }

  useEffect(() => {
    if (!conversationId) return;
    // Wait for the session answer. A signed-out deep link is about to be
    // redirected; fetching its history first only buys a 401. A signed-in
    // thread normally arrives server-seeded and never reaches this fetch.
    if (sessionStatus !== "signed-in") return;
    // Visited before: the render seed above already painted the cache.
    const cached = getCachedMessages(conversationId);
    if (messages.length > 0 && lastLoadedConvRef.current === conversationId) return;
    // A history that was just read by a hover prefetch, or by the previous
    // open, is already this read. A stale cache still revalidates below.
    if (cached && cached.length > 0 && threadReadRecently(conversationId)) {
      lastLoadedConvRef.current = conversationId;
      return;
    }
    lastLoadedConvRef.current = conversationId;

    let cancelled = false;
    void loadThreadMessages(conversationId).then((result) => {
      if (cancelled) return;
      if (result.kind === "unauthorized") {
        setMessages([]);
        setConversationId(null);
        setTitle(null);
        setLoadingThread(false);
        // The cookie is gone or expired. Say so everywhere at once instead
        // of only on this screen.
        void refreshSession();
        try {
          window.history.replaceState(null, "", "/");
        } catch {
          // Ignore.
        }
        return;
      }
      if (result.kind === "error") {
        setLoadingThread(false);
        return;
      }
      const body = result.body;
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
    });
    return () => {
      cancelled = true;
    };
  }, [
    conversationId,
    messages.length,
    sessionStatus,
    setMessages,
    threads,
    refreshSession,
  ]);

  /**
   * Releases the thread's asset gate.
   *
   * Asset metadata is the one thing that still holds the whole transcript:
   * painting a card before its ticker resolves is what made it read
   * `nep141:1720…a33a1` and a deposit offer "Start" on an address it had
   * already issued. The turn's own catalogue rows and the session-persisted
   * cache usually satisfy this immediately; only a genuinely unseen id waits.
   *
   * Approval records do not gate the transcript at all: a card that is on
   * screen reads its own record, and an off-screen card is not read.
   *
   * The release is derived during render, so no effect syncs the loading
   * flags into the gate.
   */
  if (assetGate && !loadingThread && !assetsPending) {
    setAssetGate(false);
  }

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
    [signedIn, sendMessage, setGated],
  );

  // After unlocking, continue the paused turn as a new assistant message.
  // Regenerating the old message would delete the unlock card at the moment
  // it is supposed to morph and become part of the transcript. The synthetic
  // user turn is hidden by `visibleMessages` and kept out of the database, so
  // the original request stays exactly where it was.
  const continuingRef = useRef(false);
  useEffect(() => {
    const onContinue = () => {
      if (continuingRef.current) return;
      const lastAssistant = [...messagesRef.current]
        .reverse()
        .find((message) => message.role === "assistant");
      if (!lastAssistant || !stoppedOnUnlock(lastAssistant)) return;
      continuingRef.current = true;
      void sendMessage(
        {
          text: SUPER_CONTINUE_PROMPT,
          metadata: {
            superContinue: true,
            createdAt: new Date().toISOString(),
          },
        },
        { body: { superJustUnlocked: true } },
      ).finally(() => {
        continuingRef.current = false;
      });
    };
    window.addEventListener(SUPER_CONTINUE_EVENT, onContinue);
    return () => window.removeEventListener(SUPER_CONTINUE_EVENT, onContinue);
  }, [sendMessage]);

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

  const rememberDecision = useCallback(
    (approvalId: string, decision: "approved" | "denied") => {
      rememberApprovalDecision(approvalId, decision);
      setFetchedDecisions((current) => ({
        ...current,
        [approvalId]: decision,
      }));
      setReadApprovalIds((current) => {
        if (current.has(approvalId)) return current;
        const next = new Set(current);
        next.add(approvalId);
        return next;
      });
    },
    [setFetchedDecisions, setReadApprovalIds],
  );

  const respondToApproval = useCallback(
    async (
      approvalId: string,
      approved: boolean,
      context: ApprovalDecisionContext,
    ): Promise<"approved" | "denied"> => {
      if (approved) {
        // The money route already wrote the decision before this host was
        // told; the part is only the transcript, so a failure here cannot
        // undo the record and must not surface as one.
        void addToolApprovalResponse({ id: approvalId, approved: true });
        rememberDecision(approvalId, "approved");
        return "approved";
      }
      // A refusal is written before the card may call it one. The route
      // answers with the decision actually on record, so a second device that
      // answered first wins and this card paints that answer.
      if (signedIn) {
        const res = await fetch("/api/approvals/deny", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            approvalId,
            toolName: context.toolName,
            conversationId: conversationIdRef.current,
            quoteId: context.quoteId,
            requestedAt: context.requestedAt,
          }),
        });
        if (!res.ok) throw new Error("deny-failed");
        const body = (await res.json().catch(() => null)) as {
          decision?: "approved" | "denied";
        } | null;
        const decision = body?.decision === "approved" ? "approved" : "denied";
        rememberDecision(approvalId, decision);
        // The answer is on record either way. A failure to update the local
        // transcript is not a failure to decide.
        try {
          await addToolApprovalResponse({
            id: approvalId,
            approved: decision === "approved",
          });
        } catch {
          // The transcript catches up on the next read.
        }
        return decision;
      }
      try {
        await addToolApprovalResponse({ id: approvalId, approved: false });
      } catch {
        // The transcript catches up on the next read.
      }
      return "denied";
    },
    [addToolApprovalResponse, signedIn, rememberDecision],
  );

  const live = useMemo(
    () => ({
      messages: visibleMessages,
      status,
      send,
      // Failed turns are materialized as durable "An error occurred."
      // bubbles (matching the persisted row), so the transient red state is
      // never shown — it would vanish on the next send while the bubble stays.
      error: undefined,
      regenerate: regenerateTurn,
      editAndSend,
      respondToApproval,
      conversationId,
      decisions,
      settlements: mergedSettlements,
      pendingApprovalIds,
      onApprovalVisible: requestApprovalRecord,
    }),
    [
      visibleMessages,
      status,
      send,
      regenerateTurn,
      editAndSend,
      respondToApproval,
      conversationId,
      decisions,
      mergedSettlements,
      pendingApprovalIds,
      requestApprovalRecord,
    ],
  );

  // Seeded mounts skip the history fetch (messages already present) but
  // still need the saved title. The sidebar list carries it. NULL is
  // untitled; a stored "New chat" string is a manual rename. Derived
  // during render so no effect syncs the list into the title.
  {
    const needsTitle = !title || title.trim() === "New chat";
    if (conversationId && needsTitle && messages.length > 0) {
      const found = threads.find((t) => t.id === conversationId);
      if (found && found.label != null && found.label !== title) {
        setTitle(found.label);
      } else if (!found?.label && title?.trim() === "New chat") {
        // Stale placeholder from before untitled became NULL.
        setTitle(null);
      }
    }
  }

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
  }, [conversationId, loadingOlder, hasMoreOlder, messages, setMessages, setLoadingOlder, setHasMoreOlder]);

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
      loadingThread={loadingThread || (assetGate && assetsPending)}
      onLoadOlder={loadOlderMessages}
      hasMoreOlder={hasMoreOlder}
      loadingOlder={loadingOlder}
      footer={<AccountControl />}
      footerCompact={<AccountControl compact />}
    />
  );
}
