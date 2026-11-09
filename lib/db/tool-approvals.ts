import { getSupabaseAdmin } from "./client";

/**
 * The interface's decision on one proposed money action.
 *
 * A proposal is a tool call that pauses for the user, and the paused message
 * snapshot is written before the decision exists. That snapshot is never
 * rewritten, so the decision lives here instead: one row per
 * (user, tool approval id), written by the route that carried it out — an
 * approval by the money route once the transaction record exists, a denial by
 * `/api/approvals/deny`, which moves nothing.
 *
 * The first decision wins. Two tabs, or two devices, answering the same card
 * converge on one row rather than overwriting each other, and a card that was
 * refused can never be approved afterwards.
 *
 * The interface reads by `toolApprovalId` alone, never by conversation, so a
 * decision taken before the chat had a server row still rejoins its card.
 */

export const TOOL_APPROVAL_NAMES = [
  "prepare_swap",
  "prepare_deposit",
  "prepare_withdrawal",
] as const;

export type ToolApprovalName = (typeof TOOL_APPROVAL_NAMES)[number];

export type ToolApprovalDecision = "approved" | "denied";

export type ToolApprovalRecord = {
  decision: ToolApprovalDecision;
  toolName: ToolApprovalName;
  decidedAt: string;
};

type ToolApprovalRow = {
  tool_approval_id: string;
  tool_name: ToolApprovalName;
  decision: ToolApprovalDecision;
  decided_at: string;
};

const COLUMNS = "tool_approval_id, tool_name, decision, decided_at";

function toRecord(row: ToolApprovalRow): ToolApprovalRecord {
  return {
    decision: row.decision,
    toolName: row.tool_name,
    decidedAt: row.decided_at,
  };
}

/** The decision already on record, or null while the card is undecided. */
export async function getToolApproval(
  userId: string,
  toolApprovalId: string,
): Promise<ToolApprovalRecord | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("tool_approvals")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("tool_approval_id", toolApprovalId)
    .maybeSingle();
  if (error || !data) return null;
  return toRecord(data as ToolApprovalRow);
}

/**
 * Records one decision and returns what is actually on record.
 *
 * A second write for the same proposal is a no-op that reads the first one
 * back, so a retry after a lost response, or a second device, sees the same
 * answer instead of replacing it. Every field but the decision is the
 * server's: the caller names the proposal and the tool, never the figures.
 */
export async function recordToolApproval(args: {
  userId: string;
  toolApprovalId: string;
  toolName: ToolApprovalName;
  decision: ToolApprovalDecision;
  conversationId?: string | null;
  quoteId?: string | null;
  requestedAt?: string | null;
}): Promise<ToolApprovalRecord | null> {
  const sb = getSupabaseAdmin();
  const requestedAt = args.requestedAt ? Date.parse(args.requestedAt) : NaN;
  const { error } = await sb.from("tool_approvals").insert({
    user_id: args.userId,
    conversation_id: args.conversationId ?? null,
    tool_approval_id: args.toolApprovalId,
    tool_name: args.toolName,
    decision: args.decision,
    quote_id: args.quoteId ?? null,
    // A card birth the browser cannot parse is stored as absent rather than
    // failing the decision: the decision is the record, the clock is context.
    requested_at: Number.isFinite(requestedAt)
      ? new Date(requestedAt).toISOString()
      : null,
  });
  // 23505 is the unique (user_id, tool_approval_id) constraint doing its job:
  // this proposal already has a decision, and the first one stands.
  if (error && (error as { code?: string }).code !== "23505") {
    throw new Error("The decision could not be saved.");
  }
  return getToolApproval(args.userId, args.toolApprovalId);
}

/**
 * The decisions for a set of proposals, keyed by tool approval id.
 *
 * The interface asks by the ids it is rendering, so the read is exact: no
 * conversation scoping, no guess about which turn owns a card, and nothing
 * about the account beyond its own rows.
 */
export async function listToolApprovals(
  userId: string,
  toolApprovalIds: string[],
): Promise<Record<string, ToolApprovalRecord>> {
  const ids = [...new Set(toolApprovalIds)].slice(0, 200);
  if (ids.length === 0) return {};
  const sb = getSupabaseAdmin();
  const out: Record<string, ToolApprovalRecord> = {};
  // Chunked: a 200-id filter is a ~5 KB query string, which some proxies
  // reject. The ids partition, so the order of the batches is irrelevant.
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const { data, error } = await sb
      .from("tool_approvals")
      .select(COLUMNS)
      .eq("user_id", userId)
      .in("tool_approval_id", batch);
    if (error || !data) continue;
    for (const row of data as ToolApprovalRow[]) {
      out[row.tool_approval_id] = toRecord(row);
    }
  }
  return out;
}
