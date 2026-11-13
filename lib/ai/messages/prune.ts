import type { UIMessage } from "ai";

/**
 * Backfills outputs for approved swaps that never produced one.
 *
 * Approvals granted before prepare_swap had an execute function were saved
 * as approval-responded with no output. Resubmitting that history gives the
 * provider a tool call with no result, which it rejects — so every message
 * after an approval fails. This attaches a synthetic acknowledgement to
 * those historical parts so old conversations recover.
 *
 * Only parts before the last user message are touched. Anything at or after
 * it belongs to the live approval flow and must reach streamText unchanged.
 */
export function backfillApprovedSwapOutputs(
  messages: UIMessage[],
): UIMessage[] {
  const lastUserIndex = messages.reduce(
    (last, m, i) => (m.role === "user" ? i : last),
    -1,
  );
  if (lastUserIndex <= 0) return messages;

  return messages.map((msg, idx) => {
    if (msg.role !== "assistant" || idx >= lastUserIndex) return msg;
    if (!Array.isArray(msg.parts)) return msg;

    let changed = false;
    const parts = msg.parts.map((part) => {
      const p = part as Record<string, unknown>;
      const type = typeof p.type === "string" ? p.type : "";
      const isSwap =
        type === "tool-prepare_swap" ||
        (type === "dynamic-tool" &&
          (p as { toolName?: unknown }).toolName === "prepare_swap");
      if (!isSwap || p.state !== "approval-responded") return part;
      const approval = p.approval as { approved?: unknown } | undefined;
      if (approval?.approved !== true || "output" in p) return part;

      changed = true;
      const input = (p.input ?? {}) as Record<string, unknown>;
      return {
        ...p,
        state: "output-available",
        output: {
          acknowledged: true,
          action: input.action,
          fromAssetId: input.fromAssetId,
          toAssetId: input.toAssetId,
          amount: input.amount,
          recipient: input.recipient,
          note: "The user approved this trade in the interface. Settlement is handled separately by the application.",
        },
      };
    });

    if (!changed) return msg;
    return { ...msg, parts: parts as typeof msg.parts };
  });
}

/**
 * Prunes bulky historical tool results before messages are converted and sent to the LLM.
 *
 * Why this is essential for scalability:
 * In multi-turn chat sessions, tools like `get_wallet_balances` and `get_supported_assets`
 * return large JSON structures (2KB–8KB each). Resending raw JSON dumps on every
 * subsequent turn wastes thousands of tokens, increases latency, and confuses the model's
 * reasoning.
 *
 * This function preserves full fidelity for the active/latest turn, while summarizing
 * or compacting stale historical tool results for earlier turns.
 */
const NEWS_TOOL_NAMES = new Set([
  "get_google_news",
  "get_reddit_posts",
  "get_x_posts",
  "get_x_user_posts",
  "get_page_content",
  "getGoogleNews",
  "getRedditPosts",
  "getXPosts",
  "getXUserPosts",
  "getPageContent",
]);

function compactNewsOutput(output: Record<string, unknown>) {
  const rawItems = Array.isArray(output.items) ? output.items : [];
  const titles = rawItems
    .slice(0, 8)
    .map((item) =>
      item && typeof item === "object"
        ? (item as Record<string, unknown>).title
        : undefined,
    )
    .filter((t): t is string => typeof t === "string" && t.length > 0);
  const summary: Record<string, unknown> = {
    source: output.source,
    query: output.query,
    count:
      typeof output.totalItems === "number"
        ? output.totalItems
        : rawItems.length,
    titles,
    note: "Historical block compacted; re-search for full text.",
  };
  if (typeof output.searchId === "string" && output.searchId) {
    summary.searchId = output.searchId;
  }
  return { summary };
}

export function pruneHistoricalToolOutputs(messages: UIMessage[]): UIMessage[] {
  if (messages.length <= 2) {
    return messages;
  }

  // We consider the last assistant message as "recent/active" and do not compact it.
  const lastAssistantIndex = messages.map((m) => m.role).lastIndexOf("assistant");

  return messages.map((msg, idx) => {
    // Only assistant messages contain tool invocation / result parts
    if (msg.role !== "assistant" || idx === lastAssistantIndex || !Array.isArray(msg.parts)) {
      return msg;
    }

    let hasCompacted = false;
    const compactedParts = msg.parts.map((part) => {
      const p = part as Record<string, unknown>;

      // Check if this part is a tool call with output
      const isTool =
        p.type === "tool-invocation" ||
        p.type === "dynamic-tool" ||
        (typeof p.type === "string" && p.type.startsWith("tool-"));

      if (!isTool) return part;

      const toolName =
        p.type === "dynamic-tool" && typeof p.toolName === "string"
          ? p.toolName
          : typeof p.type === "string" && p.type.startsWith("tool-")
            ? p.type.slice("tool-".length)
            : typeof (p.toolInvocation as Record<string, unknown>)?.toolName === "string"
              ? ((p.toolInvocation as Record<string, unknown>).toolName as string)
              : "";

      // Extract output reference
      const output =
        p.output && typeof p.output === "object"
          ? (p.output as Record<string, unknown>)
          : (p.toolInvocation as Record<string, unknown>)?.result &&
              typeof (p.toolInvocation as Record<string, unknown>).result === "object"
            ? ((p.toolInvocation as Record<string, unknown>).result as Record<string, unknown>)
            : null;

      if (!output) return part;

      // Compact get_wallet_balances in historical turns
      if (toolName === "get_wallet_balances" || toolName === "getWalletBalances") {
        hasCompacted = true;
        const compactedOutput = {
          source: output.source,
          connected: output.connected,
          address: output.address,
          chain: output.chain,
          title: output.title,
          totalValueUsd: output.totalValueUsd,
          showCard: output.showCard,
          summary:
            output.showCard === false
              ? `Single-asset balance check was retrieved ($${output.totalValueUsd ?? 0} total). The figure was stated in the reply; no table was drawn.`
              : `Portfolio balance was retrieved ($${output.totalValueUsd ?? 0} total). Detailed card was rendered to the user.`,
        };

        if (p.output) {
          return { ...p, output: compactedOutput };
        }
        if (p.toolInvocation) {
          return {
            ...p,
            toolInvocation: {
              ...(p.toolInvocation as Record<string, unknown>),
              result: compactedOutput,
            },
          };
        }
      }

      // Compact get_supported_assets in historical turns
      if (toolName === "get_supported_assets" || toolName === "getSupportedAssets") {
        if (Array.isArray(output.assets) && output.assets.length > 5) {
          hasCompacted = true;
          const compactedOutput = {
            totalAssetsFound: output.assets.length,
            assets: output.assets.slice(0, 5),
            note: "Truncated older catalog query for token efficiency.",
          };

          if (p.output) {
            return { ...p, output: compactedOutput };
          }
          if (p.toolInvocation) {
            return {
              ...p,
              toolInvocation: {
                ...(p.toolInvocation as Record<string, unknown>),
                result: compactedOutput,
              },
            };
          }
        }
      }

      // Compact news/page results in historical turns. Blocks are ~6k
      // chars each and stay verbatim in history otherwise, re-sent on every
      // follow-up turn. The summary keeps what a later turn needs (what was
      // asked, how many hits, their titles) without the full post text.
      if (NEWS_TOOL_NAMES.has(toolName)) {
        hasCompacted = true;
        const compactedOutput = compactNewsOutput(output);

        if (p.output) {
          return { ...p, output: compactedOutput };
        }
        if (p.toolInvocation) {
          return {
            ...p,
            toolInvocation: {
              ...(p.toolInvocation as Record<string, unknown>),
              result: compactedOutput,
            },
          };
        }
      }

      return part;
    });

    if (!hasCompacted) return msg;

    return {
      ...msg,
      parts: compactedParts as typeof msg.parts,
    };
  });
}

/* ------------------------------------------------------------------ */
/* sanitising history for the model                                     */
/* ------------------------------------------------------------------ */

const GET_QUOTE_NAMES = new Set(["get_quote", "getQuote"]);

const MODE_BEARING_TOOL_NAMES = new Set([
  "get_withdrawal_quote",
  "getWithdrawalQuote",
  "prepare_deposit",
  "prepareDeposit",
  "prepare_withdrawal",
  "prepareWithdrawal",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The tool a history part names, in either the modern or legacy shape. */
function toolNameOfPart(part: Record<string, unknown>): string {
  const type = typeof part.type === "string" ? part.type : "";
  if (type === "dynamic-tool") {
    return typeof part.toolName === "string" ? part.toolName : "";
  }
  if (type === "tool-invocation") {
    const invocation = asRecord(part.toolInvocation);
    return typeof invocation?.toolName === "string" ? invocation.toolName : "";
  }
  return type.startsWith("tool-") ? type.slice("tool-".length) : "";
}

/** Old quote inputs named the mechanism and let a model pick privacy. */
function sanitizeQuoteInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...input };
  if (next.funding === "confidential") next.funding = "account";
  delete next.confidentiality;
  return next;
}

/** Old quote outputs named the internal mode; the route is the public word. */
function sanitizeQuoteOutput(
  output: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...output };
  if (next.mode === "confidential-intents") next.route = "account";
  else if (next.mode === "chain") next.route = "wallet";
  delete next.mode;
  return next;
}

/** Other money tools only need their internal mode removed. */
function stripMode(output: Record<string, unknown>): Record<string, unknown> {
  const next = { ...output };
  delete next.mode;
  return next;
}

function sanitizePart(part: unknown): unknown {
  const record = asRecord(part);
  if (!record) return part;
  const next = { ...record };
  const name = toolNameOfPart(next);
  if (!name) return next;

  const isGetQuote = GET_QUOTE_NAMES.has(name);
  const stripsMode = MODE_BEARING_TOOL_NAMES.has(name);

  if (isGetQuote || stripsMode) {
    const input = asRecord(next.input);
    if (isGetQuote && input) next.input = sanitizeQuoteInput(input);
    const output = asRecord(next.output);
    if (output) {
      next.output = isGetQuote
        ? sanitizeQuoteOutput(output)
        : stripMode(output);
    }
  }

  const invocation = asRecord(next.toolInvocation);
  if (invocation) {
    const copy = { ...invocation };
    if (isGetQuote) {
      const args = asRecord(copy.args);
      if (args) copy.args = sanitizeQuoteInput(args);
      const result = asRecord(copy.result);
      if (result) copy.result = sanitizeQuoteOutput(result);
    } else if (stripsMode) {
      const result = asRecord(copy.result);
      if (result) copy.result = stripMode(result);
    }
    next.toolInvocation = copy;
  }

  return next;
}

/**
 * Removes the internal funding mechanism from a model-bound copy of history.
 *
 * New tool outputs never name it, but stored turns from before the rename
 * still carry `funding: "confidential"`, a `confidentiality` input, and
 * `mode: "confidential-*"` outputs. The model receives this copy, so every
 * part is cloned and sanitised — including the latest turn — while the
 * messages held for display are left untouched.
 */
export function sanitizeHistoricalToolData(
  messages: UIMessage[],
): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: Array.isArray(message.parts)
      ? (message.parts.map(sanitizePart) as typeof message.parts)
      : message.parts,
  }));
}
