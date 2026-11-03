-- Passkey-owned NEAR Intents accounts.
create table public.passkey_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  credential_id text not null unique,       -- base64url
  cose_public_key text not null,            -- base64url COSE key for WebAuthn login
  p256_public_key text not null,            -- base64 64-byte x||y
  account_id text not null unique,          -- 0x... implicit Intents account
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text check (device_type in ('singleDevice', 'multiDevice')),
  backed_up boolean not null default false,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index passkey_accounts_user_idx
  on public.passkey_accounts (user_id) where revoked_at is null;
create index passkey_accounts_account_idx
  on public.passkey_accounts (account_id) where revoked_at is null;

-- One-time WebAuthn challenges. Registration is unauthenticated; login is
-- unauthenticated and discoverable. Both are single-use and expire in 5 min.
create table public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('registration', 'authentication')),
  user_id uuid references public.users (id) on delete cascade,
  challenge text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index webauthn_challenges_expires_idx
  on public.webauthn_challenges (expires_at);

-- Sessions: the account kind and the signer. Existing rows are wallets.
alter table public.sessions
  add column account_kind text not null default 'wallet'
    check (account_kind in ('wallet', 'passkey')),
  add column passkey_id uuid references public.passkey_accounts (id) on delete set null,
  add column intents_account_id text;

create index sessions_passkey_idx on public.sessions (passkey_id);
create index sessions_intents_account_idx on public.sessions (intents_account_id);

alter table public.passkey_accounts enable row level security;
alter table public.webauthn_challenges enable row level security;
