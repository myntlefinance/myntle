-- History reads: listUserTransactions filters user_id + orders
-- (created_at desc, id desc) with keyset pagination, and
-- listConversationSettlements filters (user_id, conversation_id).
-- The init migration only indexed (user_id, updated_at), so these
-- sorted/scanned. Idempotent; safe to re-run.
create index if not exists transactions_user_created_idx
  on public.transactions (user_id, created_at desc, id desc);

create index if not exists transactions_conversation_idx
  on public.transactions (conversation_id);
