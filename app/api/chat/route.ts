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
import { SYSTEM_INSTRUCTIONS } from "@/lib/ai/prompts";
import { tools } from "@/lib/ai/tools";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";
import {
  ensureConversation,
  saveNewUIMessages,
  saveUIMessage,
} from "@/lib/db/conversations";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";
import { getSupabaseAdmin } from "@/lib/db/client";

export const maxDuration = 300;

type ChatBody = {
  messages: UIMessage[];
  model?: string;
  conversationId?: string;
  title?: string;
};

export async function POST(req: Request) {
  const { messages, model, conversationId, title }: ChatBody = await req.json();

  if (!process.env.NEAR_AI_CLOUD_API_KEY) {
    return Response.json(
      {
        error:
          "The assistant is not configured. Add NEAR_AI_CLOUD_API_KEY to .env.local.",
      },
      { status: 503 },
    );
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
  if (session) {
    try {
      // Without a generated title yet, the row starts as "New chat" and
      // the /api/title PATCH names it once generation lands. The prompt
      // is never used as the title.
      const firstTitle = title?.trim().slice(0, TITLE_MAX_CHARS) || "New chat";
      conv = await ensureConversation({
        userId: session.userId,
        conversationId,
        title: firstTitle,
      });
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser) {
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

  const result = streamText({
    model: nearAI(model ?? DEFAULT_MODEL),
    instructions: SYSTEM_INSTRUCTIONS,
    messages: await convertToModelMessages(messages),
    tools,
    // The default is one step, which would end the assistant after a single
    // tool round and leave a question like "swap some and tell me my balance"
    // half answered.
    stopWhen: isStepCount(8),
    toolApproval: {
      prepare_swap: "user-approval",
    },
    // The client resubmits the whole conversation every turn, so without this
    // a modified client could fabricate an approval for a trade.
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
  });

  const stream = toUIMessageStream({
    stream: result.stream,
    originalMessages: messages,
    generateMessageId: generateId,
    messageMetadata: () => ({ createdAt: new Date().toISOString() }),
    onFinish: ({ messages: finalMessages, outcome, responseMessage }) => {
      if (!conv) return;
      const conversationIdForSave = conv.id;
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
            await saveNewUIMessages(conversationIdForSave, finalMessages);
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
