/**
 * The WebAuthn relying-party configuration.
 *
 * The origin and RP ID decide which passkey a browser will offer, so they are
 * configuration and never request-derived. Deriving the RP ID from the `Host`
 * header would let any proxy or preview alias mint a credential the production
 * origin cannot use.
 *
 * Development defaults to `localhost`; a production deployment has to state
 * every value. `PASSKEY_ENABLED` is the single switch: when it is not `"true"`
 * the passkey routes are indistinguishable from routes that do not exist.
 */

export type WebAuthnConfig = {
  /** A bare hostname: `localhost` or `myntle.xyz`, never a URL. */
  rpID: string;
  /** The name the browser shows in the passkey prompt. */
  rpName: string;
  /** Every origin a ceremony may run on, with no trailing slash. */
  origin: string[];
};

const DEV_DEFAULTS = {
  rpID: "localhost",
  rpName: "Myntle",
  origin: "http://localhost:3000",
} as const;

/** A configuration value was missing or unusable. The message names the variable, never a value. */
export class WebAuthnConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAuthnConfigError";
  }
}

export function passkeysEnabled(): boolean {
  return process.env.PASSKEY_ENABLED === "true";
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function requireValue(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new WebAuthnConfigError(`${name} is not set.`);
  }
  return value;
}

function parseOrigins(value: string): string[] {
  const entries = value
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (entries.length === 0) {
    throw new WebAuthnConfigError("WEBAUTHN_ORIGIN is not set.");
  }
  return entries.map((entry) => {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new WebAuthnConfigError("WEBAUTHN_ORIGIN is not a list of origins.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new WebAuthnConfigError("WEBAUTHN_ORIGIN must use http or https.");
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new WebAuthnConfigError("WEBAUTHN_ORIGIN must be an origin, not a path.");
    }
    // The browser reports `clientDataJSON.origin` from `URL.origin`, so store
    // the normalized form rather than whatever spelling the env file used.
    return url.origin;
  });
}

function assertRpID(rpID: string): void {
  // A URL, a port, or a path in the RP ID makes every ceremony fail later
  // with an opaque browser error, so reject it at the boundary.
  if (!/^[a-z0-9.-]+$/i.test(rpID) || rpID.startsWith(".") || rpID.endsWith(".")) {
    throw new WebAuthnConfigError("WEBAUTHN_RP_ID must be a bare hostname.");
  }
}

/**
 * Reads the configuration, or throws a `WebAuthnConfigError` naming the
 * variable that is wrong. Production has no defaults; development does.
 */
export function getWebAuthnConfig(): WebAuthnConfig {
  const production = isProduction();
  const rpID = readEnv("WEBAUTHN_RP_ID") || (production ? "" : DEV_DEFAULTS.rpID);
  const rpName =
    readEnv("WEBAUTHN_RP_NAME") || (production ? "" : DEV_DEFAULTS.rpName);
  const originValue =
    readEnv("WEBAUTHN_ORIGIN") || (production ? "" : DEV_DEFAULTS.origin);

  if (!rpID) throw new WebAuthnConfigError("WEBAUTHN_RP_ID is not set.");
  if (!rpName) throw new WebAuthnConfigError("WEBAUTHN_RP_NAME is not set.");
  if (!originValue) throw new WebAuthnConfigError("WEBAUTHN_ORIGIN is not set.");

  assertRpID(rpID);
  const origin = parseOrigins(originValue);

  for (const entry of origin) {
    const host = new URL(entry).hostname;
    if (host !== rpID && !host.endsWith(`.${rpID}`)) {
      throw new WebAuthnConfigError(
        "WEBAUTHN_ORIGIN does not belong to WEBAUTHN_RP_ID.",
      );
    }
  }

  return { rpID, rpName, origin };
}

export type PasskeyRouteGate =
  | { enabled: true; config: WebAuthnConfig }
  | { enabled: false; status: 404 | 500 };

/**
 * The answer every passkey route gives before it does any work.
 *
 * A disabled flag is a 404: the feature does not exist as far as the route
 * table is concerned. A missing production value is a 500, because the
 * feature is meant to exist and the deployment is wrong.
 */
export function passkeyRouteGate(): PasskeyRouteGate {
  if (!passkeysEnabled()) return { enabled: false, status: 404 };
  try {
    return { enabled: true, config: getWebAuthnConfig() };
  } catch {
    return { enabled: false, status: 500 };
  }
}
