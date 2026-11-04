import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import { createWebAuthnChallenge } from "@/lib/auth/webauthn-challenge";
import { passkeyRouteGate } from "@/lib/auth/webauthn-config";

/**
 * Starts a passkey registration.
 *
 * Public, because it creates the account. The user handle is random and
 * carries no identity: there is no email or wallet address to type, and the
 * credential is discoverable so login works without a username.
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
    `passkey:register:options:${clientIp(req)}`,
    10,
    60_000,
  );
  if (limited) {
    return NextResponse.json({ error: "An error occurred." }, { status: 429 });
  }

  try {
    const options = await generateRegistrationOptions({
      rpName: gate.config.rpName,
      rpID: gate.config.rpID,
      userID: new Uint8Array(randomBytes(32)),
      userName: "Myntle account",
      userDisplayName: "Myntle account",
      attestationType: "none",
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      // ES256 only: the account derivation and the Intents verifier both
      // require a P-256 key.
      supportedAlgorithmIDs: [-7],
    });

    const { id } = await createWebAuthnChallenge({
      kind: "registration",
      challenge: options.challenge,
    });

    return NextResponse.json({ challengeId: id, options });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
