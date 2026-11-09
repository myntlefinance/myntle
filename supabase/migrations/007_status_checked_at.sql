-- A real status-check timestamp.
--
-- `updated_at` moves for any write on the row, including a run id or a
-- metadata repair. A pending deposit needs to know when 1Click was actually
-- asked, so it can decide whether the waiting label is trustworthy. Both the
-- workflow poll and the on-demand `?refresh=1` route write this field; the
-- read-before-write guard does not.
alter table public.transactions
  add column if not exists status_checked_at timestamptz;

comment on column public.transactions.status_checked_at is
  'When the settlement status was last read from the authoritative source.';
