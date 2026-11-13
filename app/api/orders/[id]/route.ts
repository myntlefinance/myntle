import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  addEvent,
  getTransaction,
  setTransactionOutcome,
  setTransactionStatus,
  updateTransactionRefs,
} from "@/lib/db/transactions";
import { outcomeNeedsWrite } from "@/lib/db/outcome";
import {
  getLimitOrder,
  isLimitOrderPreSubmission,
  limitOrderOutcome,
  limitOrderRefsView,
  limitOrderTransactionState,
  type LimitOrderView,
} from "@/lib/intents/orders";

/**
 * One limit order, refreshed from 1Click for its owner.
 *
 * A reloaded card calls this once on mount. The route reads the authoritative
 * order, writes the fill and payout statuses through to the record, and
 * returns the same view every other surface reads. It never returns the
 * signed intent payload: that material stays on the server.
 */

function orderIdFrom(refs: Record<string, unknown>): string | null {
  if (refs.kind !== "limit_order") return null;
  const orderId = refs.orderId;
  return typeof orderId === "string" && orderId.length > 0 ? orderId : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const result = await getTransaction(session.userId, id);
  if (!result) {
    return NextResponse.json({ error: "An error occurred." }, { status: 404 });
  }

  const { tx } = result;
  const refs = (tx.refs ?? {}) as Record<string, unknown>;
  const orderId = orderIdFrom(refs);
  if (!orderId) {
    return NextResponse.json({ error: "An error occurred." }, { status: 404 });
  }

  let current = tx;
  let currentRefs = refs;
  let order: LimitOrderView | null = null;
  let statusCheck: "ok" | "unavailable" | "skipped" = "skipped";

  // An account-funded order exists before its intent is signed. Reading it
  // now would map AWAITING_DEPOSIT over `awaiting_approval` and leave the
  // submit route with a record it can no longer accept, so the stored record
  // is returned untouched until submission has happened.
  if (!isLimitOrderPreSubmission(tx.state)) {
    try {
      order = await getLimitOrder(orderId);
      statusCheck = "ok";

      const mapped = limitOrderTransactionState(order);
      const outcomePatch = limitOrderOutcome(order);
      const nextOutcome = { ...(tx.outcome ?? {}), ...outcomePatch };
      const stateChanged = mapped.state !== tx.state;
      const outcomeChanged = outcomeNeedsWrite(tx.outcome, outcomePatch);

      const refsPatch = {
        fillStatus: order.fillStatus,
        payoutStatus: order.payoutStatus,
        isPayoutStatusFinal: order.isPayoutStatusFinal,
      };
      const refsChanged =
        refs.fillStatus !== refsPatch.fillStatus ||
        refs.payoutStatus !== refsPatch.payoutStatus ||
        refs.isPayoutStatusFinal !== refsPatch.isPayoutStatusFinal;
      if (refsChanged) {
        await updateTransactionRefs(tx.id, refsPatch);
        currentRefs = { ...refs, ...refsPatch };
      }

      if (stateChanged) {
        await setTransactionStatus(
          tx.id,
          mapped.state,
          new Date().toISOString(),
          nextOutcome,
        );
        await addEvent(tx.id, mapped.state, undefined, {
          orderId: order.orderId,
          fillStatus: order.fillStatus,
          payoutStatus: order.payoutStatus,
          isPayoutStatusFinal: order.isPayoutStatusFinal,
        });
        current = { ...tx, state: mapped.state, outcome: nextOutcome };
      } else if (outcomeChanged) {
        await setTransactionOutcome(tx.id, nextOutcome);
        current = { ...tx, outcome: nextOutcome };
      }
    } catch {
      // Keep the last known record. A failed read is not a failed order.
      statusCheck = "unavailable";
    }
  }

  return NextResponse.json({
    id: current.id,
    transactionId: current.id,
    state: current.state,
    order,
    refs: limitOrderRefsView(currentRefs),
    statusCheck,
    updatedAt: current.updated_at,
  });
}
