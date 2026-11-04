import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  getSupabaseAdmin: () => {
    throw new Error("the passkey routes must not touch the database when disabled");
  },
}));

import { POST as registerOptions } from "@/app/api/auth/passkey/register/options/route";
import { POST as registerVerify } from "@/app/api/auth/passkey/register/verify/route";
import { POST as loginOptions } from "@/app/api/auth/passkey/login/options/route";
import { POST as loginVerify } from "@/app/api/auth/passkey/login/verify/route";
import {
  getWebAuthnConfig,
  passkeyRouteGate,
  passkeysEnabled,
  WebAuthnConfigError,
} from "./webauthn-config";

const routes = [
  ["register/options", registerOptions],
  ["register/verify", registerVerify],
  ["login/options", loginOptions],
  ["login/verify", loginVerify],
] as const;

describe("passkey route guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled unless PASSKEY_ENABLED is exactly true", () => {
    vi.stubEnv("PASSKEY_ENABLED", "false");
    expect(passkeysEnabled()).toBe(false);
    expect(passkeyRouteGate()).toEqual({ enabled: false, status: 404 });

    vi.stubEnv("PASSKEY_ENABLED", "1");
    expect(passkeysEnabled()).toBe(false);

    vi.stubEnv("PASSKEY_ENABLED", "true");
    expect(passkeysEnabled()).toBe(true);
  });

  it("answers 404 and does no work on every route when disabled", async () => {
    vi.stubEnv("PASSKEY_ENABLED", "false");

    for (const [name, handler] of routes) {
      const res = await handler(
        new Request(`http://localhost/api/auth/passkey/${name}`, {
          method: "POST",
        }),
      );
      expect(res.status, name).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found." });
    }
  });
});

describe("WebAuthn configuration", () => {
  beforeEach(() => {
    vi.stubEnv("PASSKEY_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses localhost defaults outside production", () => {
    vi.stubEnv("WEBAUTHN_RP_ID", "");
    vi.stubEnv("WEBAUTHN_RP_NAME", "");
    vi.stubEnv("WEBAUTHN_ORIGIN", "");

    expect(getWebAuthnConfig()).toEqual({
      rpID: "localhost",
      rpName: "Myntle",
      origin: ["http://localhost:3000"],
    });
  });

  it("requires explicit values in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEBAUTHN_RP_ID", "");
    vi.stubEnv("WEBAUTHN_RP_NAME", "");
    vi.stubEnv("WEBAUTHN_ORIGIN", "");

    expect(() => getWebAuthnConfig()).toThrow(WebAuthnConfigError);
    expect(passkeyRouteGate()).toEqual({ enabled: false, status: 500 });
  });

  it("accepts a comma-separated origin allowlist", () => {
    vi.stubEnv("WEBAUTHN_RP_ID", "myntle.xyz");
    vi.stubEnv("WEBAUTHN_RP_NAME", "Myntle");
    vi.stubEnv(
      "WEBAUTHN_ORIGIN",
      "https://myntle.xyz/, https://www.myntle.xyz",
    );

    expect(getWebAuthnConfig()).toEqual({
      rpID: "myntle.xyz",
      rpName: "Myntle",
      origin: ["https://myntle.xyz", "https://www.myntle.xyz"],
    });
  });

  it("rejects an origin outside the relying party", () => {
    vi.stubEnv("WEBAUTHN_RP_ID", "myntle.xyz");
    vi.stubEnv("WEBAUTHN_RP_NAME", "Myntle");
    vi.stubEnv("WEBAUTHN_ORIGIN", "https://evil.example");

    expect(() => getWebAuthnConfig()).toThrow(WebAuthnConfigError);
  });

  it("rejects an RP ID that is a URL", () => {
    vi.stubEnv("WEBAUTHN_RP_ID", "https://myntle.xyz");
    vi.stubEnv("WEBAUTHN_RP_NAME", "Myntle");
    vi.stubEnv("WEBAUTHN_ORIGIN", "https://myntle.xyz");

    expect(() => getWebAuthnConfig()).toThrow(WebAuthnConfigError);
  });
});
