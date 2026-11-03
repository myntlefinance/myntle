-- Initial backend tables: users, wallets, auth, chats, quotes, approvals,
-- transactions + events, media (future), agent runs + policies (future).
-- One user has many wallets. Same address on two chains is two wallet rows.
-- Pagination is cursor-based: (updated_at, id) and (seq) indexes, no OFFSET.
-- RLS is enabled with no public policies. App uses service_role server-only,
-- which bypasses RLS. Browser gets nothing direct.

create extension if not exists "pgcrypto";

-- Auto-touch updated_at on update.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Users: internal id only, never a wallet address.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Wallets: one row per chain + address, all pointing to one user.
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  chain text not null check (chain in ('evm', 'solana', 'near')),
  address text not null,
  created_at timestamptz not null default now(),
  unique (chain, address)
);
create index wallets_user_id_idx on public.wallets (user_id);

-- Challenges: nonce for wallet login, consume-once via consumed_at.
create table public.challenges (
  nonce_hex text primary key check (char_length(nonce_hex) = 64),
  chain text not null check (chain in ('evm', 'solana', 'near')),
  address text not null,
  recipient text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index challenges_expires_at_idx on public.challenges (expires_at);

-- Sessions: cookie id stays 64-char hex so existing cookies keep working.
create table public.sessions (
  id text primary key check (char_length(id) = 64),
  user_id uuid not null references public.users (id) on delete cascade,
  wallet_id uuid references public.wallets (id) on delete set null,
  chain text not null check (chain in ('evm', 'solana', 'near')),
  address text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz
);
create index sessions_user_expires_idx on public.sessions (user_id, expires_at);
create index sessions_expires_at_idx on public.sessions (expires_at);

-- Conversations: slug is random 12-char in app, never the title.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  slug text not null unique check (char_length(slug) >= 8),
  -- NULL means untitled; the interface shows "New chat" as a fallback. A
  -- stored "New chat" string is a manual rename and stays distinct.
  title text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc, id desc);
create trigger conversations_touch
  before update on public.conversations
  for each row execute function public.touch_updated_at();

-- Messages: seq is global order, client_msg_id dedupes retries on close.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  parts jsonb not null default '[]'::jsonb,
  client_msg_id text,
  seq bigint generated always as identity,
  tokens jsonb,
  created_at timestamptz not null default now(),
  unique (conversation_id, client_msg_id)
);
create index messages_conv_seq_idx on public.messages (conversation_id, seq asc);
create index messages_conv_created_idx
  on public.messages (conversation_id, created_at asc, id asc);

-- Quotes: request/response stored whole, expiry swept by index.
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  engine text not null default 'intents' check (engine = 'intents'),
  request jsonb not null,
  response jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index quotes_user_created_idx on public.quotes (user_id, created_at desc);
create index quotes_expires_at_idx on public.quotes (expires_at);
create index quotes_conversation_idx on public.quotes (conversation_id);

-- Approvals: parameters are the exact source for signing, not browser payload.
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'denied')),
  parameters jsonb not null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index approvals_quote_idx on public.approvals (quote_id);
create index approvals_user_created_idx on public.approvals (user_id, created_at desc);

-- Transactions: deposit flow first. One-time deposit_address is the dedupe key.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  approval_id uuid references public.approvals (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  engine text not null default 'intents' check (engine = 'intents'),
  state text not null default 'draft'
    check (state in (
      'draft', 'quoted', 'awaiting_approval', 'authorized',
      'submitted', 'pending', 'processing', 'confirming',
      'settled', 'refunded', 'failed', 'expired',
      'incomplete_deposit', 'needs_reconciliation'
    )),
  deposit_address text unique,
  workflow_run_id text unique,
  recipient text,
  refund_to text,
  origin_asset text,
  destination_asset text,
  amount_in text,
  expected_out text,
  refs jsonb not null default '{}'::jsonb,
  outcome jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_user_updated_idx
  on public.transactions (user_id, updated_at desc, id desc);
create index transactions_state_updated_idx
  on public.transactions (state, updated_at asc);
create trigger transactions_touch
  before update on public.transactions
  for each row execute function public.touch_updated_at();

-- Transaction events: timeline for the detail page.
create table public.transaction_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  state text not null,
  message text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index transaction_events_tx_created_idx
  on public.transaction_events (transaction_id, created_at asc);

-- Media assets (future tab): table holds pointers, files live in Storage.
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  kind text not null check (kind in ('upload', 'ai_generated')),
  media_type text not null check (media_type in ('image', 'video', 'audio')),
  storage_path text not null,
  mime text,
  bytes bigint,
  prompt text,
  model text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index media_user_created_idx
  on public.media_assets (user_id, created_at desc, id desc);
create index media_type_idx on public.media_assets (media_type);
create index media_tags_idx on public.media_assets using gin (tags);
create index media_conversation_idx on public.media_assets (conversation_id);

-- Agent keys (future autonomy): one key can sign within policy.
create table public.agent_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  public_key text not null unique,
  curve text not null check (curve in ('ed25519', 'secp256k1')),
  scope jsonb not null default '{}'::jsonb,
  allowance jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index agent_keys_user_idx on public.agent_keys (user_id);

-- Agent policies (future settings tab): limits + awake schedule + portfolio rules.
create table public.agent_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  agent_key_id uuid references public.agent_keys (id) on delete set null,
  per_tx_cap text,
  daily_cap text,
  asset_allowlist jsonb not null default '[]'::jsonb,
  destination_allowlist jsonb not null default '[]'::jsonb,
  schedule jsonb not null default '{}'::jsonb,
  portfolio_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger agent_policies_touch
  before update on public.agent_policies
  for each row execute function public.touch_updated_at();

create table public.agent_policy_revisions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.agent_policies (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index agent_policy_revisions_policy_created_idx
  on public.agent_policy_revisions (policy_id, created_at desc);

-- Agent runs (future agent tab): autonomous chats with live step.
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  trigger text not null default 'manual'
    check (trigger in ('schedule', 'manual', 'webhook')),
  status text not null default 'running'
    check (status in ('running', 'sleeping', 'done', 'failed')),
  current_step text,
  heartbeat_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index agent_runs_user_status_idx
  on public.agent_runs (user_id, status, heartbeat_at desc);
create index agent_runs_conversation_idx on public.agent_runs (conversation_id);

-- Lock everything down. Service role bypasses RLS, browser gets nothing direct.
alter table public.users enable row level security;
alter table public.wallets enable row level security;
alter table public.challenges enable row level security;
alter table public.sessions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.quotes enable row level security;
alter table public.approvals enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_events enable row level security;
alter table public.media_assets enable row level security;
alter table public.agent_keys enable row level security;
alter table public.agent_policies enable row level security;
alter table public.agent_policy_revisions enable row level security;
alter table public.agent_runs enable row level security;
