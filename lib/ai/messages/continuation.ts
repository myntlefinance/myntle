import type { UIMessage } from "ai";

/**
 * The hidden user turn that resumes a request after the super account unlocks.
 *
 * The unlock card must stay in the transcript: it is the record of the paused
 * request, and it is the thing that morphs to "unlocked" or settles to
 * "expired". Regenerating the assistant message would replace that record, so
 * the continuation is sent as a new turn instead. This marker lets the client
 * hide that turn and keeps it out of the database, while still giving the model
 * a clear instruction to answer the waiting request.
 */
export const SUPER_CONTINUE_PROMPT =
  "Continue the previous request now that the account is unlocked.";

export function isSuperContinueMessage(
  message: UIMessage | null | undefined,
): boolean {
  if (!message || message.role !== "user") return false;
  const metadata = message.metadata as { superContinue?: unknown } | undefined;
  return metadata?.superContinue === true;
}

/** The transcript without the synthetic continuation turn. */
export function withoutSuperContinueMessages(
  messages: UIMessage[],
): UIMessage[] {
  return messages.filter((message) => !isSuperContinueMessage(message));
}

/** The newest user message the person actually wrote. */
export function lastRealUserMessage(
  messages: UIMessage[],
): UIMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user" && !isSuperContinueMessage(message)) {
      return message;
    }
  }
  return undefined;
}

/**
 * True when the unlock card at `index` was answered by a later assistant turn.
 *
 * The continuation is appended as a new assistant message, so the first
 * assistant after the card with no real user message in between is the
 * evidence that this request was unlocked. A card the user ignored is
 * followed by the reply to their next prompt instead, with that user message
 * in between, so it stays expired. This reads the saved transcript, which is
 * why the green card survives a reload without a separate marker.
 */
export function unlockResolvedAfter(
  messages: UIMessage[],
  index: number,
): boolean {
  if (index < 0 || index >= messages.length) return false;
  if (messages[index].role !== "assistant") return false;
  for (let i = index + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role === "user") return false;
    if (message.role === "assistant") return true;
  }
  return false;
}
