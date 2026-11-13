-- NEAR setup: the signer's public key, and one network-fee grant per key.
--
-- A named NEAR account needs `intents.near.add_public_key` before it can
-- authenticate. The grant row is the durable record that Myntle sent the
-- network fee; a zero balance later must never trigger a second send.

alter table public.sessions
  add column if not exists public_key text;

create table if not exists public.near_setup_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  account_id text not null,
  public_key text not null,
  amount text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'final', 'failed', 'registered')),
  tx_hash text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, public_key)
);

create index if not exists near_setup_grants_status_idx
  on public.near_setup_grants (status, created_at desc);
create index if not exists near_setup_grants_account_idx
  on public.near_setup_grants (account_id);

drop trigger if exists near_setup_grants_touch on public.near_setup_grants;
create trigger near_setup_grants_touch
  before update on public.near_setup_grants
  for each row execute function public.touch_updated_at();

alter table public.near_setup_grants enable row level security;
