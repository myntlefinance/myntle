import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  addEvent,
  getTransaction,
  setTransactionOutcome,
  setTransactionState,
  setTransactionStatus,
  updateTransactionRefs,
  type TxRow,
} from "@/lib/db/transactions";
import { outcomeNeedsWrite } from "@/lib/db/outcome";
import { getStatus } from "@/lib/intents/service";
import {
  getLimitOrder,
  isLimitOrderPreSubmission,
  limitOrderOutcome,
  limitOrderRefsView,
  limitOrderTransactionState,
  type LimitOrderView,
} from "@/lib/intents/orders";
import { readDepositMetadata } from "@/lib/intents/deposit-metadata";
import {
  depositTransitionForStatus,
  isRefreshableDepositRecord,
} from "@/lib/intents/deposit-status";

type TxEvent = {
  state: string;
  message: string | null;
  created_at: string;
  meta: Record<string, unknown>;
};

/**
 * One limit order, read for a reloaded card.
 *
 * This path never calls the swap status endpoint: a limit order is polled
 * through `GET /v0/orders/{id}`. The record is written through only when the
 * mapped state or its outcome changed, and a failed read keeps the last known
 * record instead of turning a network blip into a failed order.
 */
async function limitOrderResponse(
  req: Request,
  tx: TxRow,
  events: TxEvent[],
  orderId: string,
): Promise<Response> {
  let current = tx;
  const refs = (tx.refs ?? {}) as Record<string, unknown>;
  let currentRefs = refs;
  let order: LimitOrderView | null = null;
  let statusCheck: "ok" | "unavailable" | "skipped" = "skipped";

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  // An account-funded order exists before its intent is signed. Refreshing it
  // now would overwrite `awaiting_approval` with `submitted` and leave the
  // submit route unable to accept the signature.
  if (refresh && !isLimitOrderPreSubmission(tx.state)) {
    try {
      order = await getLimitOrder(orderId);
      statusCheck = "ok";

      const mapped = limitOrderTransactionState(order);
      const outcomePatch = limitOrderOutcome(order);
      const nextOutcome = { ...(tx.outcome ?? {}), ...outcomePatch };
      const stateChanged = mapped.state !== tx.state;
      const outcomeChanged = outcomeNeedsWrite(tx.outcome, outcomePatch);

      const refsChanged =
        refs.fillStatus !== order.fillStatus ||
        refs.payoutStatus !== order.payoutStatus ||
        refs.isPayoutStatusFinal !== order.isPayoutStatusFinal;
      if (refsChanged) {
        await updateTransactionRefs(tx.id, {
          fillStatus: order.fillStatus,
          payoutStatus: order.payoutStatus,
          isPayoutStatusFinal: order.isPayoutStatusFinal,
        });
        currentRefs = {
          ...refs,
          fillStatus: order.fillStatus,
          payoutStatus: order.payoutStatus,
          isPayoutStatusFinal: order.isPayoutStatusFinal,
        };
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
      // Keep the last known state. A failed read is not a failed order.
      statusCheck = "unavailable";
    }
  }

  return NextResponse.json({
    id: current.id,
    transactionId: current.id,
    state: current.state,
    depositAddress: current.deposit_address,
    recipient: current.recipient,
    originAsset: current.origin_asset,
    destinationAsset: current.destination_asset,
    amountIn: current.amount_in,
    expectedOut: current.expected_out,
    outcome: current.outcome,
    updatedAt: current.updated_at,
    statusCheckedAt: current.status_checked_at,
    deposit: null,
    depositTxHash: null,
    statusCheck,
    kind: "limit_order",
    order,
    refs: limitOrderRefsView(currentRefs),
    events: events.map((e) => ({
      state: e.state,
      message: e.message,
      at: e.created_at,
    })),
  });
}

/**
 * The settlement record for one trade, with its timeline.
 *
 * `?refresh=1` asks for exactly one authoritative status check on a pending
 * deposit and writes what it found back to the record. The browser never
 * talks to 1Click: the partner key stays on the server, and a card makes one
 * such request per mount instead of a second polling loop. The status check is
 * best effort; when it is unavailable the record is returned unchanged.
 */
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

  const { tx, events } = result;

  // A limit order is not a deposit and has no swap status. Its record is
  // refreshed from the order endpoint and returned in the same envelope.
  const limitOrderRefs = (tx.refs ?? {}) as Record<string, unknown>;
  const limitOrderId =
    limitOrderRefs.kind === "limit_order" &&
    typeof limitOrderRefs.orderId === "string" &&
    limitOrderRefs.orderId.length > 0
      ? limitOrderRefs.orderId
      : null;
  if (limitOrderId) {
    return limitOrderResponse(req, tx, events, limitOrderId);
  }

  const deposit = readDepositMetadata(tx.refs, tx.deposit_address);
  // The sender's own funding hash, registered when the wallet broadcast the
  // transfer. The record still says `submitted` until 1Click sees the funds,
  // so this is the one fact that separates "waiting for a transfer" from
  // "transfer sent, awaiting detection".
  const refs = (tx.refs ?? {}) as Record<string, unknown>;
  const depositTxHash =
    typeof refs.txHash === "string" && refs.txHash.length > 0
      ? refs.txHash
      : null;
  let current = tx;
  let statusCheck: "ok" | "unavailable" | "skipped" = "skipped";

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const knownUrls = Array.isArray(tx.outcome?.explorerUrls)
    ? (tx.outcome.explorerUrls as unknown[])
    : [];
  const refreshAddress = deposit?.address ?? tx.deposit_address;
  const depositRefresh =
    !!deposit?.address && isRefreshableDepositRecord(tx.state);
  // A settled record whose outcome was stored without a link gets one more
  // authoritative read. 1Click reports the hash but no URL, and a record
  // written before the app built links would otherwise never show its
  // transaction. The check is bounded: once the URL is stored it stops.
  const linkRepair =
    tx.state === "settled" && knownUrls.length === 0 && !!refreshAddress;
  if (refresh && refreshAddress && (depositRefresh || linkRepair)) {
    try {
      const status = await getStatus(refreshAddress, deposit?.memo, {
        originAssetId: tx.origin_asset,
        destinationAssetId: tx.destination_asset,
      });
      statusCheck = "ok";
      const next = depositRefresh
        ? depositTransitionForStatus(
            status.status,
            deposit?.expiresAt,
            Date.now(),
          )
        : { state: tx.state };
      const outcome = { ...(tx.outcome ?? {}) };
      if (status.explorerUrls.length > 0) {
        outcome.explorerUrls = status.explorerUrls;
      }
      const urlsChanged =
        JSON.stringify(outcome.explorerUrls) !==
        JSON.stringify(tx.outcome?.explorerUrls);
      if (next.state !== tx.state || urlsChanged) {
        await setTransactionState(tx.id, next.state, outcome);
        current = {
          ...tx,
          state: next.state,
          outcome,
        };
      }
    } catch {
      // Keep the last known state. A failed check is not a failed deposit.
      statusCheck = "unavailable";
    }
  }

  return NextResponse.json({
    id: current.id,
    state: current.state,
    depositAddress: current.deposit_address,
    recipient: current.recipient,
    originAsset: current.origin_asset,
    destinationAsset: current.destination_asset,
    amountIn: current.amount_in,
    expectedOut: current.expected_out,
    outcome: current.outcome,
    updatedAt: current.updated_at,
    statusCheckedAt: current.status_checked_at,
    deposit,
    depositTxHash,
    statusCheck,
    events: events.map((e) => ({
      state: e.state,
      message: e.message,
      at: e.created_at,
    })),
  });
}
