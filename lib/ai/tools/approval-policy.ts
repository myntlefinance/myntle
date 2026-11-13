/**
 * Which tools pause the turn for the user's decision.
 *
 * This is the one map `streamText` receives as `toolApproval`. It lives
 * beside the tool registry so a capability declared `user-approval` and the
 * route's configuration cannot drift apart: `capabilities.test.ts` checks
 * that the two sets are identical.
 */
export const TOOL_APPROVALS = {
  prepare_swap: "user-approval",
  prepare_deposit: "user-approval",
  prepare_withdrawal: "user-approval",
  prepare_limit_order: "user-approval",
} as const;

export type ToolApprovalName = keyof typeof TOOL_APPROVALS;
