/**
 * What the record may call the settled amount.
 *
 * A swap's status snapshot normally carries `amountOutFormatted`, and the
 * quote's expected output is a reasonable fallback when the snapshot omits
 * it. A withdrawal is different: the number the user cares about is what
 * actually arrived at the external address, and the quote's `expectedOut` is
 * only a promise. Falling back to it would turn an unconfirmed withdrawal
 * into a claimed settlement, so a withdrawal with no snapshot amount reports
 * no amount at all.
 */

export const WITHDRAWAL_QUOTE_MODE = "confidential-withdrawal";

export function settledAmountOut(input: {
  mode?: string | null;
  snapshotAmountOut?: string | null;
  expectedOut?: string | null;
}): string {
  const snapshot = input.snapshotAmountOut?.trim();
  if (snapshot) return snapshot;

  if (input.mode === WITHDRAWAL_QUOTE_MODE) return "";

  return input.expectedOut?.trim() ?? "";
}
