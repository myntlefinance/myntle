-- Decisions on proposed money actions, and the link from a card to its record.
--
-- A proposal is a tool call that pauses for the user. The paused message
-- snapshot is saved before the decision exists and is never rewritten, so the
-- decision needs its own row: an approval was only ever implied by the
-- transaction it produced, and a denial had no record at all. One row per
-- (user, tool approval id); the first decision wins, so two tabs answering
-- the same card converge instead of overwriting each other.
create table if not exists public.tool_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- Null when the decision was taken before the chat had a server row. The
  -- tool approval id below is the key the interface reads by, so the card
  -- still joins without one.
  conversation_id uuid references public.conversations (id) on delete cascade,
  tool_approval_id text not null
    check (char_length(tool_approval_id) between 1 and 200),
  tool_name text not null
    check (tool_name in ('prepare_swap', 'prepare_deposit', 'prepare_withdrawal')),
  decision text not null check (decision in ('approved', 'denied')),
  -- The dry preview the user was looking at, when the turn priced one. The
  -- declined parameters are reconstructable from quotes.request, so the
  -- browser never supplies the record of what it refused.
  quote_id uuid references public.quotes (id) on delete set null,
  requested_at timestamptz,
  decided_at timestamptz not null default now(),
  unique (user_id, tool_approval_id)
);

create index if not exists tool_approvals_conversation_idx
  on public.tool_approvals (conversation_id, decided_at desc);
create index if not exists tool_approvals_user_decided_idx
  on public.tool_approvals (user_id, decided_at desc);

alter table public.tool_approvals enable row level security;

-- The transaction's own copy of the tool approval id. Cards rejoin their
-- record by this id, so a missing conversation link can never strand one.
-- Idempotent: safe to re-run.
alter table public.transactions
  add column if not exists tool_approval_id text;

update public.transactions
   set tool_approval_id = refs ->> 'toolApprovalId'
 where tool_approval_id is null
   and refs ->> 'toolApprovalId' is not null;

create index if not exists transactions_tool_approval_idx
  on public.transactions (user_id, tool_approval_id);
