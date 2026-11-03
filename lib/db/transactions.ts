import { getSupabaseAdmin } from "./client";
import {
  readDepositMetadata,
  type DepositMetadata,
} from "@/lib/intents/deposit-metadata";

export type TxState =
  | "draft"
  | "quoted"
  | "awaiting_approval"
  | "authorized"
  | "submitted"
  | "pending"
  | "processing"
  | "confirming"
  | "settled"
  | "refunded"
  | "failed"
  | "expired"
  | "incomplete_deposit"
  | "needs_reconciliation";

export type TxRow = {
  id: string;
  user_id: string;
  approval_id: string | null;
  conversation_id: string | null;
  state: TxState;
  deposit_address: string | null;
  workflow_run_id: string | null;
  recipient: string | null;
  refund_to: string | null;
  origin_asset: string | null;
  destination_asset: string | null;
  amount_in: string | null;
  expected_out: string | null;
  refs: Record<string, unknown>;
  outcome: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function createQuote(args: {
  userId: string;
  conversationId?: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  expiresAt: string;
}): Promise<string> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("quotes")
    .insert({
      user_id: args.userId,
      conversation_id: args.conversationId ?? null,
      request: args.request,
      response: args.response,
      expires_at: args.expiresAt,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("The quote could not be saved.");
  return (data as { id: string }).id;
}

export type QuoteRow = {
  id: string;
  user_id: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  expires_at: string;
};

/**
 * Loads the server-saved dry preview the approval must match.
 *
 * The approve route treats the browser POST as an untrusted claim and this
 * row as truth: any field the client moved fails the comparison, so edited
 * payloads in devtools cannot redirect funds.
 */
export async function getQuote(
  userId: string,
  quoteId: string,
): Promise<QuoteRow | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("quotes")
    .select("id, user_id, request, response, expires_at")
    .eq("id", quoteId)
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return data as QuoteRow;
}

export async function createApproval(args: {
  quoteId: string;
  userId: string;
  parameters: Record<string, unknown>;
}): Promise<string> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("approvals")
    .insert({
      quote_id: args.quoteId,
      user_id: args.userId,
      status: "approved",
      parameters: args.parameters,
      decided_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("The approval could not be saved.");
  return (data as { id: string }).id;
}

export async function createTransaction(args: {
  userId: string;
  approvalId: string;
  conversationId?: string | null;
  recipient: string;
  refundTo: string;
  originAsset: string;
  destinationAsset: string;
  amountIn: string;
  expectedOut: string;
  depositAddress: string;
  workflowRunId?: string | null;
  refs?: Record<string, unknown>;
  /**
   * The wallet direct route starts life submitted because the wallet has
   * already signed. A signed-intent transaction starts in
   * `awaiting_approval`, because the passkey or wallet signature comes next.
   * The default preserves every existing caller.
   */
  state?: "submitted" | "awaiting_approval";
}): Promise<TxRow> {
  const state = args.state ?? "submitted";
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("transactions")
    .insert({
      user_id: args.userId,
      approval_id: args.approvalId,
      conversation_id: args.conversationId ?? null,
      state,
      recipient: args.recipient,
      refund_to: args.refundTo,
      origin_asset: args.originAsset,
      destination_asset: args.destinationAsset,
      amount_in: args.amountIn,
      expected_out: args.expectedOut,
      deposit_address: args.depositAddress,
      workflow_run_id: args.workflowRunId ?? null,
      refs: args.refs ?? {},
    })
    .select("*")
    .single();
  if (error || !data) {
    // Idempotent: the same deposit address means this trade already exists.
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: existing } = await sb
        .from("transactions")
        .select("*")
        .eq("deposit_address", args.depositAddress)
        .eq("user_id", args.userId)
        .single();
      if (existing) return existing as TxRow;
    }
    throw new Error("The trade could not be recorded.");
  }
  const row = data as TxRow;
  await addEvent(
    row.id,
    state,
    state === "awaiting_approval"
      ? "Waiting for the account signature."
      : "The trade was submitted for settlement.",
  );
  return row;
}

/**
 * Merges a patch into `transactions.refs`.
 *
 * Refs grow over a trade's life (the exact intent payload, then the intent
 * hash and signature time), so a read-modify-write merge is the only shape
 * that cannot drop an earlier field. The same pattern is used by the deposit
 * route, and it is server-only.
 */
export async function updateTransactionRefs(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("transactions")
    .select("refs")
    .eq("id", id)
    .single();
  const current =
    ((data ?? {}) as { refs?: Record<string, unknown> | null }).refs ?? {};
  await sb
    .from("transactions")
    .update({ refs: { ...current, ...patch } })
    .eq("id", id);
}

export async function setTransactionState(
  id: string,
  state: TxState,
  outcome?: Record<string, unknown>,
): Promise<void> {
  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = { state };
  if (outcome) patch.outcome = outcome;
  await sb.from("transactions").update(patch).eq("id", id);
}

export async function setTransactionRunId(
  id: string,
  runId: string,
): Promise<void> {
  const sb = getSupabaseAdmin();
  await sb.from("transactions").update({ workflow_run_id: runId }).eq("id", id);
}

export async function addEvent(
  transactionId: string,
  state: string,
  message?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const sb = getSupabaseAdmin();
  await sb.from("transaction_events").insert({
    transaction_id: transactionId,
    state,
    message: message ?? null,
    meta: meta ?? {},
  });
}

export async function getTransaction(
  userId: string,
  id: string,
): Promise<{ tx: TxRow; events: Array<{ state: string; message: string | null; created_at: string; meta: Record<string, unknown> }> } | null> {
  const sb = getSupabaseAdmin();
  const { data: tx, error } = await sb
    .from("transactions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (error || !tx) return null;
  const { data: events } = await sb
    .from("transaction_events")
    .select("state, message, created_at, meta")
    .eq("transaction_id", id)
    .order("created_at", { ascending: true });
  return {
    tx: tx as TxRow,
    events: ((events ?? []) as Array<{
      state: string;
      message: string | null;
      created_at: string;
      meta: Record<string, unknown>;
    }>),
  };
}

export type ConversationSettlement = {
  toolApprovalId: string;
  transactionId: string;
  state: TxState;
  depositAddress: string | null;
  explorerUrls: string[];
  /** The one-time address, token, chain, raw amount, and deadline. */
  deposit: DepositMetadata | null;
};

/** Every settlement in one conversation, keyed by tool approval id. */
export async function listConversationSettlements(
  userId: string,
  conversationIdOrSlug: string,
): Promise<ConversationSettlement[]> {
  const sb = getSupabaseAdmin();
  const filter = conversationIdOrSlug.replace(/"/g, "");
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const orFilter = uuidRe.test(filter)
    ? `id.eq.${filter}`
    : `slug.eq.${filter}`;
  const { data: conv } = await sb
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .or(orFilter)
    .maybeSingle();
  if (!conv) return [];
  const { data } = await sb
    .from("transactions")
    .select("id, state, deposit_address, refs, outcome")
    .eq("user_id", userId)
    .eq("conversation_id", (conv as { id: string }).id)
    .order("created_at", { ascending: true });
  const out: ConversationSettlement[] = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    state: TxState;
    deposit_address: string | null;
    refs: Record<string, unknown> | null;
    outcome: Record<string, unknown> | null;
  }>) {
    const toolApprovalId = row.refs?.toolApprovalId;
    if (typeof toolApprovalId !== "string" || toolApprovalId.length === 0) {
      continue;
    }
    const urls = (row.outcome as { explorerUrls?: unknown } | null)
      ?.explorerUrls;
    out.push({
      toolApprovalId,
      transactionId: row.id,
      state: row.state,
      depositAddress: row.deposit_address,
      explorerUrls: Array.isArray(urls)
        ? urls.filter((u): u is string => typeof u === "string").slice(0, 2)
        : [],
      deposit: readDepositMetadata(row.refs, row.deposit_address),
    });
  }
  return out;
}

export type HistoryItem = {
  id: string;
  state: string;
  depositAddress: string | null;
  recipient: string | null;
  originAsset: string | null;
  destinationAsset: string | null;
  amountIn: string | null;
  expectedOut: string | null;
  amountOut: string | null;
  explorerUrls: string[];
  conversationId: string | null;
  createdAt: string;
};

export type HistoryCursor = { createdAt: string; id: string };

/** Encodes a page cursor for the URL. Plain text, no secrets. */
export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return `${cursor.createdAt}|${cursor.id}`;
}

/** Parses a page cursor back, or null when it was tampered with. */
export function parseHistoryCursor(raw: string | null): HistoryCursor | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf("|");
  if (sep <= 0) return null;
  const createdAt = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

const HISTORY_STATES = new Set([
  "submitted",
  "pending",
  "processing",
  "confirming",
  "settled",
  "refunded",
  "failed",
  "expired",
  "incomplete_deposit",
  "needs_reconciliation",
]);

/**
 * One user's trades and deposits, newest first, cursor-paged.
 *
 * Every approval writes a transaction row first, so this is the same record
 * the chat cards, the assistant tool, and the history page all read.
 */
export async function listUserTransactions(
  userId: string,
  options: { limit?: number; cursor?: HistoryCursor | null; state?: string | null },
): Promise<{ items: HistoryItem[]; nextCursor: HistoryCursor | null }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const sb = getSupabaseAdmin();
  let query = sb
    .from("transactions")
    .select(
      "id, state, deposit_address, recipient, origin_asset, destination_asset, amount_in, expected_out, outcome, conversation_id, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (options.cursor) {
    // Cursor pagination, newest first: rows strictly older than the cursor.
    query = query.or(
      `created_at.lt.${options.cursor.createdAt},and(created_at.eq.${options.cursor.createdAt},id.lt.${options.cursor.id})`,
    );
  }
  if (options.state && HISTORY_STATES.has(options.state)) {
    query = query.eq("state", options.state);
  }

  const { data, error } = await query;
  if (error) throw new Error("The history could not be read.");
  const rows = (data ?? []) as Array<{
    id: string;
    state: string;
    deposit_address: string | null;
    recipient: string | null;
    origin_asset: string | null;
    destination_asset: string | null;
    amount_in: string | null;
    expected_out: string | null;
    outcome: Record<string, unknown> | null;
    conversation_id: string | null;
    created_at: string;
  }>;

  const items = rows.slice(0, limit).map((row) => {
    const outcome = row.outcome ?? {};
    const urls = outcome.explorerUrls;
    return {
      id: row.id,
      state: row.state,
      depositAddress: row.deposit_address,
      recipient: row.recipient,
      originAsset: row.origin_asset,
      destinationAsset: row.destination_asset,
      amountIn: row.amount_in,
      expectedOut: row.expected_out,
      amountOut:
        typeof outcome.amountOut === "string" ? outcome.amountOut : null,
      explorerUrls: Array.isArray(urls)
        ? urls.filter((u): u is string => typeof u === "string").slice(0, 2)
        : [],
      conversationId: row.conversation_id,
      createdAt: row.created_at,
    } satisfies HistoryItem;
  });

  const nextCursor =
    rows.length > limit
      ? {
          createdAt: rows[limit - 1].created_at,
          id: rows[limit - 1].id,
        }
      : null;
  return { items, nextCursor };
}
