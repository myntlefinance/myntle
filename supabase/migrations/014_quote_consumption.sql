-- Single-use dry quotes.
--
-- An approval is minted from the server-saved dry preview, so the same
-- preview must not approve twice: replaying the signed approval POST would
-- mint a second wet quote, approval, transaction, and settlement workflow.
-- The approve, intents-approve, and orders routes claim the preview with one
-- atomic `consumed_at IS NULL` update before writing records; the loser gets
-- a 409 and the card asks for a fresh quote. Existing rows stay unconsumed,
-- and a database without this column keeps the old behavior with a warning
-- (see `consumeQuote`), so the migration can land without downtime.
alter table public.quotes
  add column if not exists consumed_at timestamptz;

comment on column public.quotes.consumed_at is
  'When the dry preview was claimed by an approval; a second approval of the same preview is rejected.';
