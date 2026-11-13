import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { requireSession } from "@/lib/auth/session";
import {
  getNearSetupGrant,
  updateNearSetupGrant,
} from "@/lib/db/near-setup";
import {
  readSetupPublicKey,
  resolveNearSetupKey,
} from "@/lib/intents/near-setup-server";
import { isIntentsKeyRegistered } from "@/lib/near/intents-keys";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Confirms the wallet's `add_public_key` transaction from the chain, never
 * from the wallet's response. The client retries this while the transaction
 * is still being finalised.
 */
export async function POST(req: Request) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json(
      { error: "Log in to set up your super account." },
      { status: 401, headers: NO_STORE },
    );
  }
  if (session.chain !== "near" || session.accountKind !== "wallet") {
    return NextResponse.json(
      { ok: false, needsSetup: false },
      { headers: NO_STORE },
    );
  }

  const limit = checkRateLimit(`near-setup-confirm:${session.userId}`, 30, 60_000);
  if (limit.limited) {
    return NextResponse.json(
      { error: "Too many confirmation attempts. Try again shortly." },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)),
        },
      },
    );
  }

  const publicKey = await readSetupPublicKey(req);
  let resolved;
  try {
    resolved = await resolveNearSetupKey(session, publicKey);
  } catch {
    return NextResponse.json(
      { error: "NEAR setup is unavailable right now. Try again later." },
      { status: 502, headers: NO_STORE },
    );
  }
  if ("needsKey" in resolved || "badKey" in resolved) {
    return NextResponse.json(
      { ok: false, pending: false, needsKey: true },
      { status: 409, headers: NO_STORE },
    );
  }

  let registered = false;
  try {
    registered = await isIntentsKeyRegistered(session.address, resolved.key);
  } catch {
    return NextResponse.json(
      { error: "NEAR setup is unavailable right now. Try again later." },
      { status: 502, headers: NO_STORE },
    );
  }

  if (!registered) {
    return NextResponse.json(
      { ok: false, pending: true },
      { status: 409, headers: NO_STORE },
    );
  }

  const grant = await getNearSetupGrant(session.address, resolved.key).catch(
    () => null,
  );
  if (grant) {
    await updateNearSetupGrant(grant.id, {
      status: "registered",
      error: null,
    }).catch(() => undefined);
  }

  return NextResponse.json(
    { ok: true, pending: false, publicKey: resolved.key },
    { headers: NO_STORE },
  );
}
