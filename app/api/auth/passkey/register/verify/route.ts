import { NextResponse } from "next/server";
import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/db/client";
import {
  base64UrlEncode,
  encodeP256PublicKey,
  encodeP256PublicKeyBase64,
  intentsAccountIdForPasskey,
  parseCoseP256PublicKey,
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
          attestationObject: z.string().min(1).max(200_000),
          transports: z.array(z.string().max(32)).max(16).optional(),
          publicKeyAlgorithm: z.number().optional(),
          publicKey: z.string().max(4096).optional(),
          authenticatorData: z.string().max(8192).optional(),
        })
        .passthrough(),
      clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
      authenticatorAttachment: z.string().max(32).optional(),
    })
    .passthrough(),
  label: z.string().trim().max(80).optional(),
});

const VERIFY_FAILED = "The passkey could not be verified. Please try again.";
const DUPLICATE = "This passkey already has an account. Sign in instead.";

/** Best effort: no multi-statement transaction exists through the JS client. */
async function discardNewUser(userId: string): Promise<void> {
  try {
    await getSupabaseAdmin().from("users").delete().eq("id", userId);
  } catch {
    // The caller still returns a generic error. There is nothing to report.
  }
}

/**
 * Completes a passkey registration and creates the account.
 *
 * The account ID is derived server-side from the credential public key; the
 * client never supplies it. Registration is the only place a `users` row is
 * created without a wallet.
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
    `passkey:register:verify:${clientIp(req)}`,
    10,
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
  const { challengeId, response, label } = parsed.data;

  const challenge = await consumeWebAuthnChallenge(
    challengeId,
    "registration",
  );
  if (!challenge) {
    return NextResponse.json(
      { error: "Verification expired. Please try again." },
      { status: 401 },
    );
  }

  let registration: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    registration = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: gate.config.origin,
      expectedRPID: gate.config.rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7],
    });
  } catch {
    return NextResponse.json({ error: VERIFY_FAILED }, { status: 401 });
  }
  if (!registration.verified || !registration.registrationInfo) {
    return NextResponse.json({ error: VERIFY_FAILED }, { status: 401 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    registration.registrationInfo;

  let p256PublicKey: Uint8Array;
  let accountId: string;
  try {
    p256PublicKey = parseCoseP256PublicKey(credential.publicKey);
    accountId = intentsAccountIdForPasskey(p256PublicKey);
  } catch {
    return NextResponse.json({ error: VERIFY_FAILED }, { status: 401 });
  }

  const sb = getSupabaseAdmin();

  // A synced passkey can be registered twice. Match the credential before a
  // user exists so the retry cannot create a second account for one passkey.
  const { data: existing, error: lookupError } = await sb
    .from("passkey_accounts")
    .select("id")
    .eq("credential_id", credential.id)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ error: DUPLICATE }, { status: 409 });
  }

  const { data: user, error: userError } = await sb
    .from("users")
    .insert({})
    .select("id")
    .single();
  if (userError || !user) {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
  const userId = user.id as string;

  const { data: passkey, error: passkeyError } = await sb
    .from("passkey_accounts")
    .insert({
      user_id: userId,
      credential_id: credential.id,
      cose_public_key: base64UrlEncode(credential.publicKey),
      p256_public_key: encodeP256PublicKeyBase64(p256PublicKey),
      account_id: accountId,
      counter: credential.counter,
      transports: credential.transports ?? [],
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp,
      label: label || null,
    })
    .select("id")
    .single();

  if (passkeyError || !passkey) {
    await discardNewUser(userId);
    // `credential_id` and `account_id` are both unique. Either collision
    // means this signer already owns an account; never create a second one.
    if (passkeyError?.code === "23505") {
      return NextResponse.json({ error: DUPLICATE }, { status: 409 });
    }
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }

  let session: { id: string; expiresAt: number };
  try {
    session = await createPasskeySession({
      chain: "near",
      address: accountId,
      passkeyId: passkey.id as string,
      intentsAccountId: accountId,
    });
  } catch {
    await discardNewUser(userId);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }

  const res = NextResponse.json({
    ok: true,
    account: {
      accountId,
      credentialId: credential.id,
      publicKey: encodeP256PublicKey(p256PublicKey),
    },
  });
  res.cookies.set(
    SESSION_COOKIE,
    session.id,
    sessionCookieOptions(session.expiresAt),
  );
  return res;
}
