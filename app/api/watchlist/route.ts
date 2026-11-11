import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  addWatchedAddress,
  findWatchedAddress,
  listWatchedAddresses,
} from "@/lib/db/watchlist";
import {
  MAX_WATCH_ADDRESS_LENGTH,
  MAX_WATCH_LABEL_LENGTH,
  MAX_WATCHLIST_ENTRIES,
  normalizeWatchedAddress,
  normalizeWatchLabel,
  type WatchChain,
} from "@/lib/wallet/addresses";

const PostBody = z.object({
  chain: z.enum(["evm", "solana", "near"]),
  address: z.string().min(1).max(MAX_WATCH_ADDRESS_LENGTH),
  label: z.string().max(MAX_WATCH_LABEL_LENGTH).optional(),
});

function toEntry(row: {
  id: string;
  chain: string;
  address: string;
  label: string | null;
  is_default: boolean | null;
  created_at: string;
}) {
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    label: row.label,
    isDefault: row.is_default ?? false,
    createdAt: row.created_at,
  };
}

/**
 * The watchlist: addresses the viewer tracks read-only.
 *
 * GET lists the caller's rows with the default first. POST tracks one
 * address after re-validating chain, address, and label server-side
 * against the session it read itself; a duplicate add returns the one
 * existing row, and the sixth address is rejected. Reads here are
 * public-ledger only by construction — the balances route this feeds takes
 * no session token and runs no private read.
 */
export async function GET(req: Request) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const rows = await listWatchedAddresses(session.userId);
    return NextResponse.json({ entries: rows.map(toEntry) });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const chain = parsed.data.chain as WatchChain;
  const address = normalizeWatchedAddress(chain, parsed.data.address);
  if (!address) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const label = normalizeWatchLabel(parsed.data.label, chain, address);
  if (label === null) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    // A duplicate add stays one row even at the limit: the existing row
    // wins before the count is checked.
    const existing = await findWatchedAddress({
      userId: session.userId,
      chain,
      address,
    }).catch(() => null);
    if (existing) {
      return NextResponse.json({ entry: toEntry(existing) });
    }
    const rows = await listWatchedAddresses(session.userId);
    if (rows.length >= MAX_WATCHLIST_ENTRIES) {
      return NextResponse.json(
        { error: "You can track up to 5 addresses." },
        { status: 409 },
      );
    }
    const row = await addWatchedAddress({
      userId: session.userId,
      chain,
      address,
      label,
    });
    return NextResponse.json({ entry: toEntry(row) });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
