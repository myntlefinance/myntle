import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { getTransaction, addEvent } from "@/lib/db/transactions";
import { getSupabaseAdmin } from "@/lib/db/client";
import { submitDepositTx } from "@/lib/intents/service";

const Body = z.object({
  txHash: z.string().min(1).max(200),
  nearSenderAccount: z.string().max(200).optional(),
  memo: z.string().max(200).optional(),
});

/**
 * Registers the on-chain deposit that funds a trade.
 *
 * The approval creates the wet quote and starts polling; the wallet transfer
 * happens in the browser afterwards. This call attaches the resulting hash
 * to the record and nudges 1Click, so the status poll moves off pending.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const found = await getTransaction(session.userId, id);
  if (!found) {
    return NextResponse.json({ error: "An error occurred." }, { status: 404 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }

  try {
    await submitDepositTx({
      depositAddress: found.tx.deposit_address ?? "",
      txHash: body.txHash,
      ...(body.nearSenderAccount ? { nearSenderAccount: body.nearSenderAccount } : {}),
      ...(body.memo ? { memo: body.memo } : {}),
    });
  } catch {
    // The status poll stays authoritative; a failed nudge never fails the trade.
  }

  const sb = getSupabaseAdmin();
  const refs = { ...(found.tx.refs ?? {}), txHash: body.txHash };
  await sb.from("transactions").update({ refs }).eq("id", id);
  await addEvent(id, found.tx.state, "The deposit was sent for settlement.", {
    txHash: body.txHash,
  });

  return NextResponse.json({ ok: true });
}
