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
  normalizeWatchLabel,
  resolveWatchInput,
  watchNameError,
  type WatchChain,
} from "@/lib/wallet/addresses";
import type { NameChain, ResolvedName } from "@/lib/ports/names";

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
 * The server's own fresh read of a name, like the POST route's: an edit
 * whose input is a name re-resolves here, and the stored triple is always
 * this read, never anything the client sent.
 */
async function serverResolveName(
  chain: NameChain,
  input: string,
): Promise<ResolvedName | null> {
  const { getNameResolverPort } = await import("@/lib/adapters/registry");
  return getNameResolverPort().resolveName(chain, input);
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
  // The stored name triple travels only when the address moved: a move to
  // a name stores it fresh, a move to a raw address clears it, and a
  // rename-only edit leaves it alone.
  let resolved: { name: string | null; at: string | null } | undefined;
  let movedName: string | null = null;
  const moved = Boolean(parsed.data.chain || parsed.data.address);
  if (parsed.data.chain || parsed.data.address) {
    if (!parsed.data.chain || !parsed.data.address) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const nextChain = parsed.data.chain as WatchChain;
    const read = await resolveWatchInput(
      nextChain,
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
    chain = nextChain;
    address = read.address;
    movedName = read.name;
    resolved = { name: read.name, at: read.resolvedAt };
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

  // A blanked label keeps the current one on a rename-only edit; on a move
  // it re-defaults, preferring the fresh name, so a row tracked from one
  // name and moved to another never keeps the old name as its label. A
  // custom label survives any move untouched.
  const rawLabel = parsed.data.label;
  let label: string | null;
  if (rawLabel !== undefined && rawLabel.trim()) {
    label = normalizeWatchLabel(rawLabel, chain, address);
  } else if (!moved) {
    label =
      current.label ?? normalizeWatchLabel(undefined, chain, address);
  } else if (movedName && movedName.length <= MAX_WATCH_LABEL_LENGTH) {
    label = movedName;
  } else if (
    current.label === null ||
    (current.resolved_name !== null && current.label === current.resolved_name)
  ) {
    label = normalizeWatchLabel(undefined, chain, address);
  } else {
    label = current.label;
  }
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
      ...(resolved !== undefined ? { resolved } : {}),
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
