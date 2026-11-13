-- Watchlist names: the name a row was tracked from.
--
-- A row tracked from `vitalik.eth` stores the resolved checksummed address
-- as its identity plus the normalized name and the read time alongside it.
-- Identity and uniqueness stay `(user_id, chain, address)` exactly as
-- before; `label` stays the user-facing display name (defaulting to the
-- name when one was tracked and no label was given); no new index, since
-- rows are always read by user, never by name.

alter table public.watched_addresses
  add column if not exists resolved_name text null,
  add column if not exists resolved_at timestamptz null;
