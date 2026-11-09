import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import { listToolApprovalSettlements } from "@/lib/db/transactions";
import { listToolApprovals } from "@/lib/db/tool-approvals";

const Body = z.strictObject({
  approvalIds: z.array(z.string().min(1).max(200)).max(200),
});

/**
 * Everything a set of cards needs to paint itself from the record.
 *
 * The interface asks by the tool approval ids it is rendering, so the read is
 * exact and independent of how a turn was linked: a card from a chat that was
 * trashed, from a first turn saved before the chat had a row, or from a
 * decision taken on another device all resolve to the same two maps.
 *
 * `decisions` answers whether the user decided, and `settlements` answers what
 * the money did. Neither is ever inferred from the message snapshot, which
 * still says "approval requested" because it was written before the answer.
 */
export async function POST(req: Request) {
  const { limited } = checkRateLimit(
    `approvals-state:${clientIp(req)}`,
    120,
    60_000,
  );
  if (limited) {
    return NextResponse.json({ error: "An error occurred." }, { status: 429 });
  }

  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    console.error("[approvals/state] invalid body");
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }

  const ids = [...new Set(body.approvalIds)];
  if (ids.length === 0) {
    return NextResponse.json({ decisions: {}, settlements: [] });
  }

  try {
    const [records, settlements] = await Promise.all([
      listToolApprovals(session.userId, ids),
      listToolApprovalSettlements(session.userId, ids),
    ]);
    const decisions: Record<string, "approved" | "denied"> = {};
    for (const [id, record] of Object.entries(records)) {
      decisions[id] = record.decision;
    }
    return NextResponse.json({ decisions, settlements });
  } catch {
    console.error("[approvals/state] read failed");
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
