-- Limit orders are a fourth proposal a card can answer.
--
-- The decision table shipped with a check constraint naming the three money
-- tools that existed then. Adding the tool in application code is not enough:
-- the insert would be rejected by a database that already has 006 applied, and
-- the card would lose its decision on reload. This migration widens the one
-- constraint and leaves every existing row untouched.

alter table public.tool_approvals
  drop constraint if exists tool_approvals_tool_name_check;

alter table public.tool_approvals
  add constraint tool_approvals_tool_name_check
  check (
    tool_name in (
      'prepare_swap',
      'prepare_deposit',
      'prepare_withdrawal',
      'prepare_limit_order'
    )
  );
