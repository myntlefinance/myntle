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
  normalizeWatchLabel,
  resolveWatchInput,
  watchNameError,
  type WatchChain,
} from "@/lib/wallet/addresses";
import type { NameChain, ResolvedName } from "@/lib/ports/names";

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
  resolved_name?: string | null;
  resolved_at?: string | null;
}) {
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    label: row.label,
    isDefault: row.is_default ?? false,
    createdAt: row.created_at,
    resolvedName: row.resolved_name ?? null,
    resolvedAt: row.resolved_at ?? null,
  };
}

/**
 * The server's own fresh read of a name. The dialog previews through the
 * resolve route, but this is the read that stores: a modified client can
 * send any address it likes, so a name input is always resolved here and
 * never trusted from the request.
 */
async function serverResolveName(
  chain: NameChain,
  input: string,
): Promise<ResolvedName | null> {
  const { getNameResolverPort } = await import("@/lib/adapters/registry");
  return getNameResolverPort().resolveName(chain, input);
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
  // A raw address reads sync; a `.eth` input resolves fresh here, so the
  // stored address is always the server's own read, never the client's.
  const read = await resolveWatchInput(
    chain,
    parsed.data.address,
    serverResolveName,
  );
  if (!read.ok) {
    if (read.reason === "unregistered" || read.reason === "unavailable") {
      return NextResponse.json(
        { error: watchNameError(read.reason) },
        { status: read.reason === "unavailable" ? 503 : 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const address = read.address;
  // The default label is the name when one was tracked and it fits the
  // label cap, which every realistic name does; a longer name falls back
  // to the truncated address rather than rejecting a readable name.
  const rawLabel = parsed.data.label;
  const label =
    rawLabel !== undefined && rawLabel.trim()
      ? normalizeWatchLabel(rawLabel, chain, address)
      : read.name && read.name.length <= MAX_WATCH_LABEL_LENGTH
        ? read.name
        : normalizeWatchLabel(undefined, chain, address);
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
      resolvedName: read.name,
      resolvedAt: read.resolvedAt,
    });
    return NextResponse.json({ entry: toEntry(row) });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
