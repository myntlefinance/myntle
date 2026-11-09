/**
 * Whether a terminal outcome patch needs to be written.
 *
 * The transaction row is the only status record, so a replayed workflow step
 * must not churn it. Compare only the fields the caller intends to write, and
 * ignore representation differences that are not semantic:
 *
 * - object key order is irrelevant (`jsonb` normalizes it anyway),
 * - the explorer URL list is a set: 1Click may return the same links in a
 *   different order on a later poll.
 *
 * Extra keys already stored are deliberately left alone; this is a repair
 * check for the fields the caller owns, not a full replacement comparison.
 */
export function outcomeNeedsWrite(
  stored: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): boolean {
  if (!next) return false;
  if (!stored) return Object.keys(next).length > 0;
  return Object.entries(next).some(([key, value]) => {
    if (!Object.hasOwn(stored, key)) return true;
    if (key === "explorerUrls" && isUrlList(stored[key]) && isUrlList(value)) {
      return !sameUrlSet(stored[key], value);
    }
    return !sameValue(stored[key], value);
  });
}

function isUrlList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function sameUrlSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((url) => set.has(url));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((entry, index) => sameValue(entry, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]),
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
