import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { listConversationSettlements } from "@/lib/db/transactions";

/** Every settlement in one conversation, so cards paint from the record. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const settlements = await listConversationSettlements(
    session.userId,
    decodeURIComponent(id),
  );
  return NextResponse.json({ settlements });
}
