import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db/client";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";
import {
  decodeP256PublicKeyBase64,
  encodeP256PublicKey,
} from "@/lib/auth/passkeys";
import { getWebAuthnConfig } from "@/lib/auth/webauthn-config";

/**
 * Never cached. A cached "not signed in" from before the login would be
 * served to the client right after the cookie lands, which reads as a
 * sign-in that did nothing until the page is reloaded.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: NextRequest) {
  const id = req.cookies.get(SESSION_COOKIE)?.value;
  if (!id) {
    return NextResponse.json({ authenticated: false }, { headers: NO_STORE });
  }
  const session = await getSession(decodeURIComponent(id));
  if (!session) {
    return NextResponse.json({ authenticated: false }, { headers: NO_STORE });
  }

  if (session.accountKind === "wallet") {
    // The wallet response keeps `chain` and `address` exactly as before.
    // `accountKind` and `intentsAccountId` are additive.
    return NextResponse.json(
      {
        authenticated: true,
        accountKind: "wallet",
        intentsAccountId: session.intentsAccountId,
        chain: session.chain,
        address: session.address,
      },
      { headers: NO_STORE },
    );
  }

  // A passkey session's signer is a row, not the cookie. Re-read it so a
  // revoked credential cannot be described as an active account.
  if (!session.passkeyId) {
    return NextResponse.json({ authenticated: false }, { headers: NO_STORE });
  }
  const { data: passkey, error } = await getSupabaseAdmin()
    .from("passkey_accounts")
    .select("credential_id, p256_public_key, account_id, revoked_at")
    .eq("id", session.passkeyId)
    .single();
  if (error || !passkey || passkey.revoked_at) {
    return NextResponse.json({ authenticated: false }, { headers: NO_STORE });
  }

  const accountId =
    (passkey.account_id as string | null) ?? session.intentsAccountId;

  let publicKey: string;
  try {
    publicKey = encodeP256PublicKey(
      decodeP256PublicKeyBase64(passkey.p256_public_key as string),
    );
  } catch {
    // A row that cannot produce a valid P-256 key cannot sign. Treat it as
    // signed out rather than describing an unusable account.
    return NextResponse.json({ authenticated: false }, { headers: NO_STORE });
  }

  // The RP ID decides which passkey the browser offers, so it is the one
  // configuration value the signer needs after a reload. It is a bare
  // hostname from the deployment, never derived from this request, and it is
  // not a secret. Without it the credential cannot produce an assertion.
  let rpId: string;
  try {
    rpId = getWebAuthnConfig().rpID;
  } catch {
    return NextResponse.json({ authenticated: false }, { headers: NO_STORE });
  }

  return NextResponse.json(
    {
      authenticated: true,
      accountKind: "passkey",
      accountId,
      intentsAccountId: session.intentsAccountId,
      credentialId: passkey.credential_id as string,
      publicKey,
      rpId,
      // Kept for every existing consumer that reads a session as chain+address.
      chain: "near",
      address: accountId,
    },
    { headers: NO_STORE },
  );
}
