import type { UIMessage } from "ai";

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
          summary: `Portfolio balance was retrieved ($${output.totalValueUsd ?? 0} total). Detailed card was rendered to the user.`,
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

      return part;
    });

    if (!hasCompacted) return msg;

    return {
      ...msg,
      parts: compactedParts as typeof msg.parts,
    };
  });
}
