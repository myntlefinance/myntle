import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import {
  addEvent,
  getTransaction,
  setTransactionOutcome,
  setTransactionStatus,
  updateTransactionRefs,
} from "@/lib/db/transactions";
import { outcomeNeedsWrite } from "@/lib/db/outcome";
import {
  cancelLimitOrder,
  limitOrderOutcome,
  limitOrderTransactionState,
} from "@/lib/intents/orders";

/**
 * Requests cancellation of one limit order.
 *
 * Cancellation is asynchronous on 1Click: matching stops, a last slice can
 * still fill, the filled output is withdrawn, and the unfilled input is
 * refunded. This route therefore records the snapshot and returns it; it never
 * moves funds itself and never promises that the order is already cancelled.
 */

const CANCEL_FAILED = "The order could not be cancelled. Please try again.";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { limited } = checkRateLimit(
    `orders-cancel:${clientIp(req)}`,
    10,
    60_000,
  );
  if (limited) {
    return NextResponse.json({ error: "An error occurred." }, { status: 429 });
  }

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
  const orderId =
    refs.kind === "limit_order" &&
    typeof refs.orderId === "string" &&
    refs.orderId.length > 0
      ? refs.orderId
      : null;
  if (!orderId) {
    return NextResponse.json({ error: "An error occurred." }, { status: 404 });
  }

  try {
    const order = await cancelLimitOrder(orderId);
    const mapped = limitOrderTransactionState(order);
    const outcomePatch = limitOrderOutcome(order);
    const nextOutcome = { ...(tx.outcome ?? {}), ...outcomePatch };

    await updateTransactionRefs(tx.id, {
      fillStatus: order.fillStatus,
      payoutStatus: order.payoutStatus,
      isPayoutStatusFinal: order.isPayoutStatusFinal,
    });

    if (mapped.state !== tx.state) {
      await setTransactionStatus(
        tx.id,
        mapped.state,
        new Date().toISOString(),
        nextOutcome,
      );
      await addEvent(tx.id, mapped.state, undefined, {
        orderId,
        fillStatus: order.fillStatus,
        payoutStatus: order.payoutStatus,
        cancelRequested: true,
      });
    } else if (outcomeNeedsWrite(tx.outcome, outcomePatch)) {
      await setTransactionOutcome(tx.id, nextOutcome);
    }

    return NextResponse.json({ ok: true, order });
  } catch {
    console.error("[orders/cancel] request failed", { transactionId: tx.id });
    return NextResponse.json({ error: CANCEL_FAILED }, { status: 502 });
  }
}
