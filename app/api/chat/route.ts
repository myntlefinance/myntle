import { after } from "next/server";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  toUIMessageStream,
  streamText,
  type UIMessage,
} from "ai";
import { nearAI, DEFAULT_MODEL } from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { routeIntent } from "@/lib/ai/route-intent";
import { createTools, TOOL_APPROVALS } from "@/lib/ai/tools";
import {
  backfillApprovedSwapOutputs,
  pruneHistoricalToolOutputs,
} from "@/lib/ai/messages/prune";
import {
  isSuperContinueMessage,
  lastRealUserMessage,
} from "@/lib/ai/messages/continuation";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import {
  ensureConversation,
  saveNewUIMessages,
  saveUIMessage,
} from "@/lib/db/conversations";
import { TITLE_MAX_CHARS, generateTitle } from "@/lib/ai/title";
import { getSupabaseAdmin } from "@/lib/db/client";

export const maxDuration = 300;

function extractPromptText(message: UIMessage | undefined): string {
  if (!message) return "";
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const texts: string[] = [];
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text"
    ) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) texts.push(text.trim());
    }
  }
  return texts.join("\n");
}

type ChatBody = {
  messages: UIMessage[];
  model?: string;
  conversationId?: string;
  title?: string | null;
  walletAddress?: string;
  walletChain?: string;
  superUnlocked?: boolean;
  /** Set by the client when it resumes a turn after the unlock lands. */
  superJustUnlocked?: boolean;
  /** The transport's request kind; regenerating reuses the old message id. */
  trigger?: "submit-message" | "regenerate-message";
  messageId?: string;
};

export async function POST(req: Request) {
  const {
    messages,
    model,
    conversationId,
    title,
    walletAddress,
    walletChain,
    superUnlocked,
    superJustUnlocked,
    trigger,
    messageId,
  }: ChatBody = await req.json();

  // Borrowed for this turn only: used by the private read tools and never
  // stored, logged, or forwarded anywhere else. The refresh token that mints
  // these stays in the browser.
  const intentsAccessToken =
    req.headers.get("x-intents-access-token")?.trim() || undefined;

  if (!process.env.NEAR_AI_CLOUD_API_KEY) {
    return Response.json(
      {
        error:
          "The assistant is not configured. Please check environment keys and try again.",
      },
      { status: 503 },
    );
  }

  if (!process.env.TOOL_APPROVAL_SECRET) {
    return Response.json(
      {
        error:
          "Approvals are not configured. Please check necessary permissions and try again.",
      },
      { status: 503 },
    );
  }

  const { limited: chatLimited } = checkRateLimit(`chat:${clientIp(req)}`, 30, 60_000);
  if (chatLimited) {
    return Response.json({ error: "An error occurred." }, { status: 429 });
  }

  // Logged-out visitors keep the old stream-only behavior so the demo never
  // blocks on login. Logged-in users get persistence below.
  const cookieId = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const session = cookieId
    ? await getSession(decodeURIComponent(cookieId))
    : null;

  if (conversationId && !session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  let conv: { id: string; slug: string } | null = null;
  // A new chat is named by the server backup in after(), so switching chats
  // or closing the tab mid-stream cannot orphan it as untitled.
  const isNewChat = !conversationId;
  let newChatPrompt = "";
  if (session) {
    try {
      // Untitled stays NULL and the interface shows "New chat" as a
      // fallback. A stored "New chat" string always means the user typed
      // exactly that, so generation never overwrites it.
      const firstTitle = title?.trim().slice(0, TITLE_MAX_CHARS) || null;
      conv = await ensureConversation({
        userId: session.userId,
        conversationId,
        title: firstTitle,
      });
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const lastTypedUser = lastRealUserMessage(messages);
      if (isNewChat) newChatPrompt = extractPromptText(lastTypedUser).slice(0, 500);
      // The unlock continuation is a transport instruction. It is not a real
      // user message, so it must never become a bubble in saved history.
      if (lastUser && !isSuperContinueMessage(lastUser)) {
        try {
          await saveUIMessage(conv.id, lastUser);
          const sb = getSupabaseAdmin();
          await sb
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conv.id);
        } catch {
          // Save failure never blocks the stream. Next turn retries.
        }
      }
    } catch {
      conv = null;
    }
  }

  const activeAddress = session?.address || walletAddress || null;
  const activeChain = session?.chain || walletChain || null;
  const accountKind = session?.accountKind ?? "wallet";

  // The token is the real signal: a live access token means the account is
  // unlocked for this turn, even if the client's cached flag is stale.
  const superUnlockedNow = Boolean(intentsAccessToken) || superUnlocked === true;

  // The flag only shapes prose, and only when a live token really is here;
  // the token remains the gate for the read itself.
  const justUnlocked = Boolean(intentsAccessToken) && superJustUnlocked === true;

  // Per-turn scoping: a balance question pays no trading/news schema
  // cost. Ambiguous input keeps the full set; money intents always keep
  // trading+intents so prepare_swap is never scoped out from under a trade.
  const lastUserText = extractPromptText(lastRealUserMessage(messages));
  const intent = routeIntent(lastUserText);

  const instructions = buildSystemPrompt({
    // A passkey account has no wallet, so the prompt describes the account
    // instead of a connected wallet. Absent means wallet.
    accountKind,
    accountId: session?.accountKind === "passkey" ? session.address : undefined,
    activeAddress,
    activeChain,
    superUnlocked: superUnlockedNow,
    superJustUnlocked: justUnlocked,
    domains: intent.domains,
  });

  const prunedMessages = backfillApprovedSwapOutputs(
    pruneHistoricalToolOutputs(messages),
  );

  const result = streamText({
    model: nearAI(model ?? DEFAULT_MODEL),
    instructions,
    messages: await convertToModelMessages(prunedMessages),
    tools: createTools({
      userId: session?.userId,
      accountKind,
      intentsAccountId: session?.intentsAccountId,
      accountId: session?.accountKind === "passkey" ? session.address : undefined,
      activeAddress,
      activeChain,
      superUnlocked: superUnlockedNow,
      intentsAccessToken,
    }, { domains: intent.toolDomains }),
    // The default is one step, which would end the assistant after a single
    // tool round and leave a question like "swap some and tell me my balance"
    // half answered.
    stopWhen: isStepCount(15),
    toolApproval: { ...TOOL_APPROVALS },
    // The client resubmits the whole conversation every turn, so without this
    // a modified client could fabricate an approval for a trade.
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
    // Errors stay masked at the boundary: the stream keeps the default
    // "An error occurred." message, and this only observes server-side.
    onError: (error) => {
      console.error(
        "[chat] stream failed",
        error instanceof Error ? error.message.slice(0, 200) : "unknown",
      );
    },
  });

  const regeneratedMessageId =
    trigger === "regenerate-message" ? messageId : undefined;

  const stream = toUIMessageStream({
    stream: result.stream,
    originalMessages: messages,
    // A regenerated turn reuses the id of the reply it replaces, so the
    // database row is overwritten instead of showing two answers.
    generateMessageId: regeneratedMessageId
      ? () => regeneratedMessageId
      : generateId,
    messageMetadata: () => ({
      createdAt: new Date().toISOString(),
    }),
    onFinish: ({ messages: finalMessages, outcome, responseMessage }) => {
      if (!conv) return;
      const conversationIdForSave = conv.id;
      const titlePrompt = newChatPrompt;
      const shouldNameNewChat = isNewChat;
      // Runs after the response, even if the tab closed mid-stream.
      after(async () => {
        try {
          if (outcome.status === "failed") {
            const lastUser = [...finalMessages]
              .reverse()
              .find((m) => m.role === "user");
            await saveUIMessage(conversationIdForSave, {
              id: lastUser ? `error-${lastUser.id}` : (responseMessage?.id || generateId()),
              role: "assistant",
              parts: [{ type: "text", text: "An error occurred." }],
            } as UIMessage);
          } else {
            await saveNewUIMessages(
              conversationIdForSave,
              finalMessages.filter((m) => !isSuperContinueMessage(m)),
            );
            // Aborted mid-stream still leaves a partial to keep history honest.
            if (
              (outcome.status === "aborted" || outcome.status === "unknown") &&
              responseMessage &&
              Array.isArray((responseMessage as UIMessage).parts) &&
              ((responseMessage as UIMessage).parts?.length ?? 0) > 0
            ) {
              await saveUIMessage(
                conversationIdForSave,
                responseMessage as UIMessage,
              );
            }
          }
          const sb = getSupabaseAdmin();
          await sb
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationIdForSave);
          // Sole owner of title generation (the client no longer calls
          // /api/title). Conditional so a manual rename (including to the
          // literal "New chat") always wins.
          if (shouldNameNewChat && titlePrompt.trim()) {
            try {
              const generated = await generateTitle(titlePrompt);
              if (generated) {
                await sb
                  .from("conversations")
                  .update({ title: generated })
                  .eq("id", conversationIdForSave)
                  .is("title", null);
              }
            } catch {
              // Title failure leaves NULL; the next turn or repair retries.
            }
          }
        } catch {
          // Never throw from persistence.
        }
      });
    },
  });

  const headers = new Headers();
  if (conv) {
    headers.set("x-conversation-id", conv.id);
    headers.set("x-conversation-slug", conv.slug);
  }

  return createUIMessageStreamResponse({ stream, headers });
}
