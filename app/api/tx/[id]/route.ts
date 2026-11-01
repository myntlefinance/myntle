import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getTransaction } from "@/lib/db/transactions";

/** The settlement record for one trade, with its timeline. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(_req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const result = await getTransaction(session.userId, id);
  if (!result) {
    return NextResponse.json({ error: "An error occurred." }, { status: 404 });
  }

  const { tx, events } = result;
  return NextResponse.json({
    id: tx.id,
    state: tx.state,
    depositAddress: tx.deposit_address,
    recipient: tx.recipient,
    originAsset: tx.origin_asset,
    destinationAsset: tx.destination_asset,
    amountIn: tx.amount_in,
    expectedOut: tx.expected_out,
    outcome: tx.outcome,
    updatedAt: tx.updated_at,
    events: events.map((e) => ({
      state: e.state,
      message: e.message,
      at: e.created_at,
    })),
  });
}
