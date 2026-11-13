import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  getNearSetupState,
  readSetupPublicKey,
} from "@/lib/intents/near-setup-server";

const NO_STORE = { "cache-control": "no-store" };

/**
 * The setup state for the signed-in NEAR wallet.
 *
 * POST rather than GET because an older session may need to resolve the
 * wallet's current key, and the account itself always comes from the session.
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
      { needsSetup: false, registered: false },
      { headers: NO_STORE },
    );
  }

  try {
    const publicKey = await readSetupPublicKey(req);
    const state = await getNearSetupState(session, publicKey);
    return NextResponse.json(state, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "NEAR setup is unavailable right now. Try again later." },
      { status: 502, headers: NO_STORE },
    );
  }
}
