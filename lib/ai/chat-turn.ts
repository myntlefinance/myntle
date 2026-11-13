import type { UIMessage } from "ai";
import type { SealedTurnSecret } from "./turn-secret";

/**
 * One chat turn, described entirely by serializable values.
 *
 * The generation runs in a workflow step so the turn outlives the request
 * that started it. Nothing here may hold a live object: the token is sealed,
 * tools are rebuilt inside the step from the context, and the messages are
 * the same array the browser sent.
 */
export type ChatTurnInput = {
  messages: UIMessage[];
  model: string;
  /** The database id, used for persistence. Null for a logged-out preview. */
  conversationId: string | null;
  userId: string | null;
  accountKind: "wallet" | "passkey";
  intentsAccountId: string | null;
  accountId: string | null;
  activeAddress: string | null;
  activeChain: string | null;
  superUnlocked: boolean;
  superJustUnlocked: boolean;
  /** The prompt that names a brand-new chat, empty when it is already named. */
  titlePrompt: string;
  nameNewChat: boolean;
  /** A regenerated turn reuses the id of the reply it replaces. */
  regeneratedMessageId?: string;
  /** Present only when the turn carries a live Intents access token. */
  intentsSecret: SealedTurnSecret | null;
};

/** The text a UI message contributes, joined the same way every consumer reads it. */
export function extractPromptText(message: UIMessage | undefined): string {
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
