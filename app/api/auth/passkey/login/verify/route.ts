import { NextResponse } from "next/server";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/db/client";
import {
  base64UrlDecode,
  decodeP256PublicKeyBase64,
  encodeP256PublicKey,
} from "@/lib/auth/passkeys";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import {
  createPasskeySession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { consumeWebAuthnChallenge } from "@/lib/auth/webauthn-challenge";
import { passkeyRouteGate } from "@/lib/auth/webauthn-config";

const Body = z.object({
  challengeId: z.string().uuid(),
  response: z
    .object({
      id: z.string().min(1).max(2048),
      rawId: z.string().min(1).max(2048),
      type: z.literal("public-key"),
      response: z
        .object({
          clientDataJSON: z.string().min(1).max(16_000),
          authenticatorData: z.string().min(1).max(8192),
          signature: z.string().min(1).max(8192),
          userHandle: z.string().max(2048).optional(),
        })
        .passthrough(),
      clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
      authenticatorAttachment: z.string().max(32).optional(),
    })
    .passthrough(),
});

const VERIFY_FAILED = "That passkey could not be verified.";

type PasskeyRow = {
  id: string;
  user_id: string;
  credential_id: string;
  cose_public_key: string;
  p256_public_key: string;
  account_id: string;
  counter: number | string;
  transports: string[] | null;
};

/**
 * Completes a passkey login.
 *
 * Unknown, revoked, and failed credentials all answer with the same sentence.
 * The session is created only after both the WebAuthn assertion and the
 * stored counter have been checked.
 */
export async function POST(req: Request) {
  const gate = passkeyRouteGate();
  if (!gate.enabled) {
    return NextResponse.json(
      { error: gate.status === 404 ? "Not found." : "An error occurred." },
      { status: gate.status },
    );
  }

  const { limited } = checkRateLimit(
    `passkey:login:verify:${clientIp(req)}`,
    20,
    60_000,
  );
  if (limited) {
    return NextResponse.json({ error: "An error occurred." }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { challengeId, response } = parsed.data;

  const challenge = await consumeWebAuthnChallenge(
    challengeId,
    "authentication",
  );
  if (!challenge) {
    return NextResponse.json(
      { error: "Verification expired. Please try again." },
      { status: 401 },
    );
  }

  const sb = getSupabaseAdmin();
  const { data, error: lookupError } = await sb
    .from("passkey_accounts")
    .select(
      "id, user_id, credential_id, cose_public_key, p256_public_key, account_id, counter, transports",
    )
    .eq("credential_id", response.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: VERIFY_FAILED }, { status: 401 });
  }
  const passkey = data as PasskeyRow;

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: gate.config.origin,
      expectedRPID: gate.config.rpID,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(base64UrlDecode(passkey.cose_public_key)),
        counter: Number(passkey.counter),
        transports: passkey.transports ?? [],
      },
      requireUserVerification: true,
    });
  } catch {
    return NextResponse.json({ error: VERIFY_FAILED }, { status: 401 });
  }
  if (!verification.verified) {
    return NextResponse.json({ error: VERIFY_FAILED }, { status: 401 });
  }

  let publicKey: string;
  try {
    publicKey = encodeP256PublicKey(
      decodeP256PublicKeyBase64(passkey.p256_public_key),
    );
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }

  const { error: updateError } = await sb
    .from("passkey_accounts")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", passkey.id)
    .is("revoked_at", null);
  if (updateError) {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }

  let session: { id: string; expiresAt: number };
  try {
    session = await createPasskeySession({
      chain: "near",
      address: passkey.account_id,
      passkeyId: passkey.id,
      intentsAccountId: passkey.account_id,
    });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }

  const res = NextResponse.json({
    ok: true,
    account: {
      accountId: passkey.account_id,
      credentialId: passkey.credential_id,
      publicKey,
    },
  });
  res.cookies.set(
    SESSION_COOKIE,
    session.id,
    sessionCookieOptions(session.expiresAt),
  );
  return res;
}
