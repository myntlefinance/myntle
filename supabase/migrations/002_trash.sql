-- Trash: soft-delete for conversations. A deleted chat leaves the list
-- immediately but its rows stay for 30 days, then a purge hard-deletes them.
alter table public.conversations
  add column if not exists deleted_at timestamptz;

-- Active list stays fast: only rows with no deletion timestamp.
create index if not exists conversations_user_active_idx
  on public.conversations (user_id, updated_at desc, id desc)
  where deleted_at is null;

-- Trash list + the 30-day sweep both read by deletion time.
create index if not exists conversations_user_deleted_idx
  on public.conversations (user_id, deleted_at desc, id desc)
  where deleted_at is not null;

create index if not exists conversations_deleted_at_idx
  on public.conversations (deleted_at asc)
  where deleted_at is not null;
