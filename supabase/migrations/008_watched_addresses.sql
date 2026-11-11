-- Watchlist: addresses the viewer tracks read-only.
--
-- A watched address is someone else's public portfolio: the app reads the
-- public ledger for it and never the private one, and no signing or spending
-- path touches these rows. The same address on two chains is two rows, like
-- wallets. RLS is enabled with no public policies; the service role owns
-- every read and write, scoped by user_id in application code.

create table if not exists public.watched_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  chain text not null check (chain in ('evm', 'solana', 'near')),
  address text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (user_id, chain, address)
);
create index if not exists watched_addresses_user_created_idx
  on public.watched_addresses (user_id, created_at desc);

alter table public.watched_addresses enable row level security;
