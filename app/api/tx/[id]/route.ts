import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getTransaction, setTransactionState } from "@/lib/db/transactions";
import { getStatus } from "@/lib/intents/service";
import { readDepositMetadata } from "@/lib/intents/deposit-metadata";
import {
  depositTransitionForStatus,
  isRefreshableDepositRecord,
} from "@/lib/intents/deposit-status";

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
  const deposit = readDepositMetadata(tx.refs, tx.deposit_address);
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
    statusCheck,
    events: events.map((e) => ({
      state: e.state,
      message: e.message,
      at: e.created_at,
    })),
  });
}
