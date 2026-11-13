import { FatalError, sleep } from "workflow";

/**
 * The durable limit-order lifecycle.
 *
 * The workflow holds no state of its own. Every check writes through to
 * Postgres, so a reload, a dropped connection, or a redeploy resumes from the
 * record. A step that throws is retried; the payout failure is the one
 * verdict that throws FatalError and stops the run.
 *
 * The pacing is fixed, not measured: twenty-five seconds short of five
 * minutes of fast checks catch the deposit and the first fill, and the rest
 * of a thirty-minute window catches the payout legs. Sleeps cost no compute,
 * so nothing loops inside a request. At the end the order is returned as
 * pending rather than failed: a resting order is not a failed one.
 */

export type LimitOrderLifecycleInput = {
  transactionId: string;
  orderId: string;
};

export type LimitOrderLifecycleOutcome = {
  status: "settled" | "refunded" | "failed" | "pending";
  orderId: string;
  state: string;
  fillStatus: string;
  payoutStatus: string;
};

/** Twenty checks at fifteen seconds, then twenty-five at one minute. */
const FAST_CHECKS = 20;
const SLOW_CHECKS = 25;

type LimitOrderSnapshot = {
  state: string;
  terminal: boolean;
  fillStatus: string;
  payoutStatus: string;
};

export async function limitOrderLifecycle(
  input: LimitOrderLifecycleInput,
): Promise<LimitOrderLifecycleOutcome> {
  "use workflow";

  let last: LimitOrderSnapshot | null = null;

  for (let attempt = 0; attempt < FAST_CHECKS + SLOW_CHECKS; attempt += 1) {
    await sleep(attempt < FAST_CHECKS ? "15s" : "60s");

    const snapshot = await checkLimitOrderStep(input);
    last = snapshot;

    if (!snapshot.terminal) continue;

    if (snapshot.state === "failed") {
      // The payout leg failed. The money did not arrive and no later poll
      // will change that, so the run stops instead of retrying forever.
      throw new FatalError(
        `Limit order payout ended with status: ${snapshot.payoutStatus}`,
      );
    }

    return {
      status: snapshot.state === "settled" ? "settled" : "refunded",
      orderId: input.orderId,
      state: snapshot.state,
      fillStatus: snapshot.fillStatus,
      payoutStatus: snapshot.payoutStatus,
    };
  }

  // The order can rest for a week. The fast window catches the deposit and
  // the first fills; these five sparse checks keep the record fresh at the
  // milestones a person actually checks, without polling a resting order
  // every minute. The delays sum to seven days.
  for (const delay of [
    60 * 60_000,
    5 * 60 * 60_000,
    18 * 60 * 60_000,
    48 * 60 * 60_000,
    96 * 60 * 60_000,
  ]) {
    await sleep(delay);
    const snapshot = await checkLimitOrderStep(input);
    last = snapshot;
    if (!snapshot.terminal) continue;
    if (snapshot.state === "failed") {
      throw new FatalError(
        `Limit order payout ended with status: ${snapshot.payoutStatus}`,
      );
    }
    return {
      status: snapshot.state === "settled" ? "settled" : "refunded",
      orderId: input.orderId,
      state: snapshot.state,
      fillStatus: snapshot.fillStatus,
      payoutStatus: snapshot.payoutStatus,
    };
  }

  return {
    status: "pending",
    orderId: input.orderId,
    state: "pending",
    fillStatus: last?.fillStatus ?? "UNKNOWN",
    payoutStatus: last?.payoutStatus ?? "UNKNOWN",
  };
}

/**
 * One poll of `GET /v0/orders/{id}` plus its write-through.
 *
 * Read-before-write: identical consecutive polls issue no update and no event,
 * so the twenty-second beat does not churn `updated_at` or fill the timeline.
 * A replayed step re-reads the row inside the step, so a retry never
 * double-inserts an event.
 */
async function checkLimitOrderStep(
  input: LimitOrderLifecycleInput,
): Promise<LimitOrderSnapshot> {
  "use step";

  const {
    getLimitOrder,
    limitOrderOutcome,
    limitOrderTransactionState,
  } = await import("@/lib/intents/orders");

  // A failed request throws here and the step is retried. Nothing about the
  // order is guessed from a missing response.
  const order = await getLimitOrder(input.orderId);
  const mapped = limitOrderTransactionState(order);
  const outcomePatch = limitOrderOutcome(order);

  const [{ getSupabaseAdmin }, { outcomeNeedsWrite }, transactions] =
    await Promise.all([
      import("@/lib/db/client"),
      import("@/lib/db/outcome"),
      import("@/lib/db/transactions"),
    ]);

  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("transactions")
    .select("state, refs, outcome")
    .eq("id", input.transactionId)
    .single();
  const row = data as {
    state?: string;
    refs?: Record<string, unknown> | null;
    outcome?: Record<string, unknown> | null;
  } | null;
  const refs = row?.refs ?? {};
  const nextOutcome = { ...(row?.outcome ?? {}), ...outcomePatch };

  const refsChanged =
    refs.fillStatus !== order.fillStatus ||
    refs.payoutStatus !== order.payoutStatus ||
    refs.isPayoutStatusFinal !== order.isPayoutStatusFinal;
  if (refsChanged) {
    await transactions.updateTransactionRefs(input.transactionId, {
      fillStatus: order.fillStatus,
      payoutStatus: order.payoutStatus,
      isPayoutStatusFinal: order.isPayoutStatusFinal,
    });
  }

  const stateChanged = row?.state !== mapped.state;
  if (stateChanged) {
    await transactions.setTransactionStatus(
      input.transactionId,
      mapped.state,
      new Date().toISOString(),
      nextOutcome,
    );
    await transactions.addEvent(input.transactionId, mapped.state, undefined, {
      orderId: order.orderId,
      fillStatus: order.fillStatus,
      payoutStatus: order.payoutStatus,
      isPayoutStatusFinal: order.isPayoutStatusFinal,
    });
  } else if (outcomeNeedsWrite(row?.outcome, outcomePatch)) {
    await transactions.setTransactionOutcome(
      input.transactionId,
      nextOutcome,
    );
  }

  return {
    state: mapped.state,
    terminal: mapped.terminal,
    fillStatus: order.fillStatus,
    payoutStatus: order.payoutStatus,
  };
}
