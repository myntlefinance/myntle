import { getSupabaseAdmin } from "./client";

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
}): Promise<TxRow> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("transactions")
    .insert({
      user_id: args.userId,
      approval_id: args.approvalId,
      conversation_id: args.conversationId ?? null,
      state: "submitted",
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
  await addEvent(row.id, "submitted", "The trade was submitted for settlement.");
  return row;
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
