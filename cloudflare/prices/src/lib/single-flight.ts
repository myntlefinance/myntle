/**
 * One shared promise for one task class. The Durable Object refreshes on an
 * alarm and on an HTTP request, and the two can overlap; a shared flight means
 * the second caller waits for the first batch instead of spending the same
 * upstream call twice.
 *
 * The promise is cleared when it settles, so a later caller starts fresh
 * work. A rejection is settled and cleared the same way: the next caller must
 * be able to retry, and a failed batch must never wedge the object.
 */
export type SingleFlight<T> = {
  run(task: () => Promise<T>): Promise<T>;
  /** True while a task is running. Diagnostics only. */
  readonly pending: boolean;
};

export function createSingleFlight<T>(): SingleFlight<T> {
  let current: Promise<T> | null = null;

  return {
    get pending(): boolean {
      return current !== null;
    },

    run(task: () => Promise<T>): Promise<T> {
      if (current !== null) return current;

      // A synchronous throw inside the task becomes a rejection, so the
      // cleanup below runs for every outcome.
      const started = (async () => task())();
      const tracked = started.finally(() => {
        // Only clear our own flight: a task that already settled must not
        // erase a newer one that a concurrent caller started.
        if (current === tracked) current = null;
      });

      current = tracked;
      return tracked;
    },
  };
}

/** The part of a batch result the drain needs: the ids it looked at. */
export type DecidedBatch = { decided: ReadonlySet<string> };

export type DrainOutcome<T> = {
  /** The last batch this caller ran or joined; null when nothing was needed. */
  result: T | null;
  rounds: number;
};

/**
 * Run batches until every wanted id has been decided, or until the bound is
 * reached.
 *
 * A shared flight can join a caller to a batch that was started for someone
 * else's ids: with concurrent callers A, B and C, C can join B's batch and
 * come back without its own ids ever being looked at. One re-check is not
 * enough, so this loop re-checks after every batch and starts (or joins) the
 * next one for whatever is still missing. Sixteen rounds covers a burst of
 * distinct callers, each of which may need one round to shake off the others'
 * flights; the bound keeps a permanently undecidable id from spinning.
 */
export async function drainMisses<T extends DecidedBatch>(
  wanted: readonly string[],
  run: (missing: string[]) => Promise<T>,
  maxRounds = 16,
): Promise<DrainOutcome<T>> {
  const settled = new Set<string>();
  let result: T | null = null;
  let rounds = 0;

  while (rounds < maxRounds) {
    const missing = wanted.filter((assetId) => !settled.has(assetId));
    if (missing.length === 0) break;

    result = await run(missing);
    rounds += 1;

    for (const assetId of result.decided) settled.add(assetId);
  }

  return { result, rounds };
}

