-- Watchlist default: the address a fresh reload opens to.
--
-- One row per user at most carries is_default, enforced by the partial
-- unique index. Listing orders the default first, so the first entry is
-- always the one a fresh visit selects. Deleting the default row needs
-- no cleanup: the flag dies with its row.

alter table public.watched_addresses
  add column if not exists is_default boolean not null default false;

create unique index if not exists watched_addresses_user_default_idx
  on public.watched_addresses (user_id) where is_default;
