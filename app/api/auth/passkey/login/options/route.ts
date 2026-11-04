import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import { createWebAuthnChallenge } from "@/lib/auth/webauthn-challenge";
import { passkeyRouteGate } from "@/lib/auth/webauthn-config";

/**
 * Starts a passkey login.
 *
 * `allowCredentials` is deliberately omitted: the credential is discoverable,
 * so the browser offers every passkey for this relying party and there is no
 * username to type. The challenge row is what binds the answer to us.
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
    `passkey:login:options:${clientIp(req)}`,
    30,
    60_000,
  );
  if (limited) {
    return NextResponse.json({ error: "An error occurred." }, { status: 429 });
  }

  try {
    const options = await generateAuthenticationOptions({
      rpID: gate.config.rpID,
      userVerification: "required",
    });

    const { id } = await createWebAuthnChallenge({
      kind: "authentication",
      challenge: options.challenge,
    });

    return NextResponse.json({ challengeId: id, options });
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
