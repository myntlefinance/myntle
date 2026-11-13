-- The durable run that owns the chat turn currently being generated.
--
-- A chat turn now streams from a workflow run instead of the HTTP response.
-- The browser needs to know which run to reconnect to after a reload or a
-- dropped connection, and the reconnect route needs an ownership check, so
-- the active run is recorded on the conversation and cleared when it ends.
-- finished_at is a marker, not a cleanup: the run's stream is still readable
-- after completion, which is what lets a tab that slept through the end
-- replay the answer.
alter table public.conversations
  add column active_run_id text,
  add column active_run_started_at timestamptz,
  add column active_run_finished_at timestamptz;
