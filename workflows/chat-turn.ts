import { getWritable, getWorkflowMetadata } from "workflow";
import {
  convertToModelMessages,
  generateId,
  isStepCount,
  smoothStream,
  streamText,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamOutcome,
} from "ai";
import { nearAI } from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { routeIntent } from "@/lib/ai/route-intent";
import { createTools, TOOL_APPROVALS } from "@/lib/ai/tools";
import {
  backfillApprovedSwapOutputs,
  pruneHistoricalToolOutputs,
  sanitizeHistoricalToolData,
} from "@/lib/ai/messages/prune";
import {
  isSuperContinueMessage,
  lastRealUserMessage,
} from "@/lib/ai/messages/continuation";
import {
  extractPromptText,
  type ChatTurnInput,
} from "@/lib/ai/chat-turn";
import { openTurnSecret } from "@/lib/ai/turn-secret";
import { generateTitle } from "@/lib/ai/title";
import {
  markConversationRunFinished,
  saveNewUIMessages,
  saveUIMessage,
} from "@/lib/db/conversations";
import { getSupabaseAdmin } from "@/lib/db/client";

/**
 * One chat turn, durable.
 *
 * The generation itself is a single step that pumps the AI SDK's UI chunk
 * stream into the run's stream. The route returns a copy of that stream to
 * the browser, so a reload or a dropped connection no longer owns the turn:
 * the run keeps writing, and the reconnect route replays from the last chunk
 * the browser saw.
 *
 * The step deliberately does not retry. It writes as it generates, so a retry
 * after a partial write would append a second answer to the same stream.
 * A failed turn fails the run; the next user turn starts a new one.
 */
export async function runChatTurnStep(
  input: ChatTurnInput,
  writable: WritableStream<UIMessageChunk>,
) {
  "use step";

  // The turn's clock starts once. Returning a fresh timestamp here would
  // change on every part; the UI stream would then emit a second metadata
  // chunk after every text delta, resetting the message's age on each token.
  const startedAt = new Date().toISOString();

  const intentsAccessToken = input.intentsSecret
    ? openTurnSecret(input.intentsSecret)
    : undefined;

  const lastUserText = extractPromptText(lastRealUserMessage(input.messages));
  const intent = routeIntent(lastUserText);

  const instructions = buildSystemPrompt({
    accountKind: input.accountKind,
    accountId: input.accountKind === "passkey" ? (input.accountId ?? undefined) : undefined,
    activeAddress: input.activeAddress ?? undefined,
    activeChain: input.activeChain ?? undefined,
    superUnlocked: input.superUnlocked,
    superJustUnlocked: input.superJustUnlocked,
    domains: intent.domains,
  });

  const prunedMessages = sanitizeHistoricalToolData(
    backfillApprovedSwapOutputs(pruneHistoricalToolOutputs(input.messages)),
  );

  const result = streamText({
    model: nearAI(input.model),
    instructions,
    messages: await convertToModelMessages(prunedMessages),
    tools: createTools(
      {
        userId: input.userId ?? undefined,
        accountKind: input.accountKind,
        intentsAccountId: input.intentsAccountId ?? undefined,
        accountId: input.accountKind === "passkey" ? (input.accountId ?? undefined) : undefined,
        activeAddress: input.activeAddress,
        activeChain: input.activeChain,
        superUnlocked: input.superUnlocked,
        intentsAccessToken,
      },
      { domains: intent.toolDomains },
    ),
    // The provider delivers text in uneven bursts. Releasing it word by word
    // at a steady cadence makes the answer feel written rather than pasted;
    // tool calls and step boundaries pass through untouched.
    experimental_transform: smoothStream({ delayInMs: 20, chunking: "word" }),
    // The same bound the streaming route used: one step would silently end
    // the assistant after a single tool round.
    stopWhen: isStepCount(15),
    toolApproval: { ...TOOL_APPROVALS },
    // The client resubmits the whole conversation every turn, so without this
    // a modified client could fabricate an approval for a trade.
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
    onError: (error) => {
      console.error(
        "[chat] stream failed",
        error instanceof Error ? error.message.slice(0, 200) : "unknown",
      );
    },
  });

  // The final message state is captured when the UI stream ends. Persistence
  // happens after the durable stream closes, so the browser settles the
  // answer before the database write instead of waiting inside `onFinish`.
  const finished: {
    value: {
      finalMessages: UIMessage[];
      outcome: UIMessageStreamOutcome;
      responseMessage: UIMessage | undefined;
    } | null;
  } = { value: null };

  const stream = toUIMessageStream({
    stream: result.stream,
    originalMessages: input.messages,
    // A regenerated turn reuses the id of the reply it replaces, so the
    // database row is overwritten instead of showing two answers.
    generateMessageId: input.regeneratedMessageId
      ? () => input.regeneratedMessageId as string
      : generateId,
    // The start chunk already carries this, so it is the only place the
    // client needs it. Returning metadata on later parts makes the AI SDK
    // enqueue an extra `message-metadata` chunk after every single part.
    messageMetadata: ({ part }) =>
      part.type === "start" ? { createdAt: startedAt } : undefined,
    // Capture only. The write below is still awaited by this step, so the
    // turn is not stored best-effort; it just no longer holds the stream open.
    onFinish: ({ messages: finalMessages, outcome, responseMessage }) => {
      if (!input.conversationId) return;
      finished.value = {
        finalMessages: finalMessages as UIMessage[],
        outcome,
        responseMessage: responseMessage as UIMessage | undefined,
      };
    },
  });

  const writer = writable.getWriter();
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
    }
  } catch (error) {
    // The durable stream is gone; stop the model instead of generating into
    // a stream nobody can read.
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }

  // Close here, in the same step, so the browser's response ends the moment
  // the answer does instead of waiting for another step transition. The
  // finish chunk is written before this close; the database write happens
  // after it, and the step still awaits the write before returning.
  await writable.close().catch(() => {});

  if (finished.value) {
    await persistTurn(
      input,
      finished.value.finalMessages,
      finished.value.outcome,
      finished.value.responseMessage,
    );
  }
}
runChatTurnStep.maxRetries = 0;

async function persistTurn(
  input: ChatTurnInput,
  finalMessages: UIMessage[],
  outcome: UIMessageStreamOutcome,
  responseMessage: UIMessage | undefined,
) {
  const conversationId = input.conversationId;
  if (!conversationId) return;
  try {
    if (outcome.status === "failed") {
      const lastUser = [...finalMessages]
        .reverse()
        .find((message) => message.role === "user");
      await saveUIMessage(conversationId, {
        id: lastUser
          ? `error-${lastUser.id}`
          : responseMessage?.id || generateId(),
        role: "assistant",
        parts: [{ type: "text", text: "An error occurred." }],
      } as UIMessage);
    } else {
      await saveNewUIMessages(
        conversationId,
        finalMessages.filter((message) => !isSuperContinueMessage(message)),
      );
      // A genuinely aborted generation still leaves its partial, exactly as
      // the streaming route used to; the next read must not hide the cut.
      if (
        (outcome.status === "aborted" || outcome.status === "unknown") &&
        responseMessage &&
        Array.isArray(responseMessage.parts) &&
        responseMessage.parts.length > 0
      ) {
        await saveUIMessage(conversationId, responseMessage);
      }
    }

    const sb = getSupabaseAdmin();
    await sb
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
  } catch {
    // Never throw from persistence into the stream.
  }
}

async function closeChatTurnStreamStep() {
  "use step";

  // The success path closes the stream inside the generation step. This is
  // the failure path: a turn that never reached its final close still must
  // not leave a reader waiting. Closing twice is a no-op.
  try {
    await getWritable<UIMessageChunk>().close();
  } catch {
    // Already closed, or the run is gone.
  }
}

async function markChatTurnFinishedStep(
  conversationId: string,
  runId: string,
) {
  "use step";

  await markConversationRunFinished(conversationId, runId);
}

async function nameChatStep(conversationId: string, prompt: string) {
  "use step";

  // After the stream has closed, so a title call never holds the answer open.
  try {
    const generated = await generateTitle(prompt);
    if (!generated) return;
    const sb = getSupabaseAdmin();
    await sb
      .from("conversations")
      .update({ title: generated })
      .eq("id", conversationId)
      .is("title", null);
  } catch {
    // Title failure leaves NULL; the next turn or repair retries.
  }
}

/**
 * The turn's run. Closing the stream comes before marking the run finished so
 * the browser's response ends the moment the answer does. The clear is still
 * guarded by the run id, so an older, slower turn cannot clear a newer one.
 * Naming a new chat is a separate step after the stream closes, because a
 * title call must never keep the composer busy.
 */
export async function chatTurn(input: ChatTurnInput) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();

  try {
    await runChatTurnStep(input, getWritable<UIMessageChunk>());
  } finally {
    try {
      await closeChatTurnStreamStep();
    } finally {
      try {
        if (input.conversationId) {
          await markChatTurnFinishedStep(input.conversationId, workflowRunId);
        }
      } finally {
        if (
          input.conversationId &&
          input.nameNewChat &&
          input.titlePrompt.trim()
        ) {
          await nameChatStep(input.conversationId, input.titlePrompt);
        }
      }
    }
  }
}
