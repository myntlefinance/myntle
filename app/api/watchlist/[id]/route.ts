import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  findWatchedAddress,
  getWatchedAddress,
  removeWatchedAddress,
  setDefaultWatchedAddress,
  updateWatchedAddress,
} from "@/lib/db/watchlist";
import {
  MAX_WATCH_ADDRESS_LENGTH,
  MAX_WATCH_LABEL_LENGTH,
  normalizeWatchedAddress,
  normalizeWatchLabel,
  type WatchChain,
} from "@/lib/wallet/addresses";

/** Removes one watchlist entry. Immediate and ungated: re-adding restores it. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const removed = await removeWatchedAddress(session.userId, id);
    if (!removed) {
      return NextResponse.json({ error: "An error occurred." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

const PatchBody = z.object({
  label: z.string().max(MAX_WATCH_LABEL_LENGTH).optional(),
  chain: z.enum(["evm", "solana", "near"]).optional(),
  address: z.string().min(1).max(MAX_WATCH_ADDRESS_LENGTH).optional(),
  isDefault: z.boolean().optional(),
});

function toWatchedEntry(row: {
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
 * Edits one watchlist entry, and moves it when the chain or address
 * changed. A move onto an already-tracked account is rejected rather
 * than merged. Passing `isDefault` marks or unmarks the default a
 * fresh visit opens to instead; it never combines with the other
 * fields.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const current = await getWatchedAddress({
    userId: session.userId,
    id,
  }).catch(() => null);
  if (!current) {
    return NextResponse.json({ error: "An error occurred." }, { status: 404 });
  }

  // The default flag travels alone: marking selects this row (clearing
  // any other), unmarking clears only when this row holds it, so one
  // caller's toggle can never drop another row's flag — there is only
  // ever one flag, and it is theirs.
  if (parsed.data.isDefault !== undefined) {
    if (parsed.data.isDefault) {
      const row = await setDefaultWatchedAddress({
        userId: session.userId,
        id,
      }).catch(() => null);
      if (!row) {
        return NextResponse.json({ error: "An error occurred." }, { status: 404 });
      }
      return NextResponse.json({ entry: toWatchedEntry(row) });
    }
    if (current.is_default) {
      await setDefaultWatchedAddress({
        userId: session.userId,
        id: null,
      }).catch(() => null);
    }
    return NextResponse.json({
      entry: toWatchedEntry({ ...current, is_default: false }),
    });
  }

  let chain = current.chain as WatchChain;
  let address = current.address;
  if (parsed.data.chain || parsed.data.address) {
    if (!parsed.data.chain || !parsed.data.address) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const nextChain = parsed.data.chain as WatchChain;
    const normalized = normalizeWatchedAddress(nextChain, parsed.data.address);
    if (!normalized) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    chain = nextChain;
    address = normalized;
    const taken = await findWatchedAddress({
      userId: session.userId,
      chain,
      address,
    }).catch(() => null);
    if (taken && taken.id !== id) {
      return NextResponse.json(
        { error: "That address is already in your watchlist." },
        { status: 409 },
      );
    }
  }

  // A blanked label keeps the current one; a missing one falls back to
  // the truncated address, like tracking does.
  const rawLabel = parsed.data.label;
  const label =
    rawLabel === undefined || !rawLabel.trim()
      ? (current.label ?? normalizeWatchLabel(undefined, chain, address))
      : normalizeWatchLabel(rawLabel, chain, address);
  if (!label) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const row = await updateWatchedAddress({
      userId: session.userId,
      id,
      label,
      chain,
      address,
    });
    if (!row) {
      return NextResponse.json({ error: "An error occurred." }, { status: 404 });
    }
    return NextResponse.json({
      entry: toWatchedEntry(row),
    });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
