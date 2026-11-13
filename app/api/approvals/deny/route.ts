import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import { conversationIdForUser } from "@/lib/db/conversations";
import {
  getQuote,
  hasToolApprovalSettlement,
} from "@/lib/db/transactions";
import {
  TOOL_APPROVAL_NAMES,
  recordToolApproval,
} from "@/lib/db/tool-approvals";

const Body = z.strictObject({
  /** Tool approval id (aitxt-…), the key the card reads by. */
  approvalId: z.string().min(1).max(200),
  /**
   * Which proposal this was. The label is the browser's, because a deposit has
   * no stored quote to derive it from; the decision itself is keyed by the id,
   * so a wrong label cannot decide anyone else's card.
   */
  toolName: z.enum(TOOL_APPROVAL_NAMES),
  conversationId: z.string().min(1).max(200).nullish(),
  /** The dry preview the card was showing, linked only if it is the user's. */
  quoteId: z.string().uuid().nullish(),
  /** Card birth, for the audit trail. Never used to decide anything. */
  requestedAt: z.string().min(1).max(64).nullish(),
});

/**
 * Refuses a proposed money action.
 *
 * This is the half of the decision that had no server record: an approval is
 * written by the money route once the transaction exists, and a denial moves
 * nothing, so it is written here. The row is what every surface reads, which
 * is why a refusal now survives a reload, another browser, and another device.
 *
 * The response carries the decision that is actually on record. A second
 * device answering the same card converges on the first answer instead of
 * replacing it, and the caller paints whatever came back.
 */
export async function POST(req: Request) {
  const { limited } = checkRateLimit(
    `approvals-deny:${clientIp(req)}`,
    60,
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
    console.error("[approvals/deny] invalid body");
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }

  // The chat is the user's, or the row is stored without one. A chat that is
  // not theirs is never linked, whatever the id resolves to.
  let conversationId: string | null = null;
  if (body.conversationId) {
    conversationId = await conversationIdForUser(
      session.userId,
      body.conversationId,
    ).catch(() => null);
  }

  // The dry preview is the stored truth for what was declined. Only a quote
  // that belongs to this session is linked; an unknown one is dropped rather
  // than failing the refusal, which is the record that matters.
  let quoteId: string | null = null;
  if (body.quoteId) {
    const stored = await getQuote(session.userId, body.quoteId).catch(
      () => null,
    );
    quoteId = stored?.id ?? null;
  }

  // A proposal whose money already started cannot be refused after the fact.
  // The address was minted and the approval row was written with the trade, so
  // a refusal here would paint Rejected over a live deposit. The settlement
  // decides whether it started; when that read fails nothing is written,
  // because a refusal must never be recorded while the action may be live.
  let started = false;
  try {
    started = await hasToolApprovalSettlement(
      session.userId,
      body.approvalId,
    );
  } catch {
    console.error("[approvals/deny] settlement read failed", {
      approvalId: body.approvalId,
    });
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }

  // A started proposal is recorded as approved. First-write-wins keeps a row
  // that already exists (including a historical denial), and a missing one is
  // repaired so the record matches the trade that was already created.
  const decision = started ? "approved" : "denied";

  try {
    const record = await recordToolApproval({
      userId: session.userId,
      toolApprovalId: body.approvalId,
      toolName: body.toolName,
      decision,
      conversationId,
      quoteId,
      requestedAt: body.requestedAt ?? null,
    });
    return NextResponse.json({
      approvalId: body.approvalId,
      decision: record?.decision ?? decision,
      decidedAt: record?.decidedAt ?? null,
    });
  } catch {
    console.error("[approvals/deny] record failed", {
      approvalId: body.approvalId,
    });
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
