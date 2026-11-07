import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  encodeHistoryCursor,
  listUserTransactions,
  parseHistoryCursor,
} from "@/lib/db/transactions";

/**
 * The user's trade and deposit history, newest first.
 *
 * Cursor-paged on (created_at, id): `cursor` is the opaque value from the
 * previous page's `nextCursor`. An optional `state` narrows to one
 * settlement state. Every approval writes its transaction row before
 * anything else runs, so this record is complete by construction.
 */
export async function GET(req: Request) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
    50,
  );
  const cursor = parseHistoryCursor(url.searchParams.get("cursor"));
  if (url.searchParams.get("cursor") && !cursor) {
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }
  const state = url.searchParams.get("state");

  try {
    const { items, nextCursor } = await listUserTransactions(session.userId, {
      limit,
      cursor,
      state,
    });
    return NextResponse.json({
      transactions: items,
      nextCursor: nextCursor ? encodeHistoryCursor(nextCursor) : null,
    });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
