const DEFAULT_ORIGINS = "http://localhost:3000";

function normalize(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

/** Comma-separated APP_ORIGINS, trimmed, no trailing slashes, lowercase. */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? DEFAULT_ORIGINS)
    .split(",")
    .map(normalize)
    .filter((origin) => origin.length > 0);
}

/**
 * A wildcard entry matches an origin, never a literal "*". The wildcard must
 * sit inside the origin (`https://myntle-*.vercel.app`), and the matched
 * middle must be a host fragment rather than a path or a port.
 */
function wildcardMatches(pattern: string, candidate: string): boolean {
  // A bare star would otherwise match "null" and scheme-less origins, whose
  // middle contains no ":" or "/".
  if (pattern === "*") return false;

  const star = pattern.indexOf("*");
  if (star === -1) return false;
  // More than one wildcard is not a pattern we are willing to guess about.
  if (pattern.indexOf("*", star + 1) !== -1) return false;

  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix)) {
    return false;
  }

  const middle = candidate.slice(
    prefix.length,
    candidate.length - suffix.length,
  );
  return (
    middle.length > 0 &&
    !middle.includes("/") &&
    !middle.includes(":") &&
    !middle.includes("*")
  );
}

/**
 * The canonical allowlist entry for this request, otherwise null. Returning
 * the stored entry keeps the ACAO value stable when the browser sends a
 * different case. A wildcard entry returns the request's own origin, because
 * a browser rejects a wildcard in Access-Control-Allow-Origin.
 */
export function pickAllowedOrigin(
  request: Request,
  allowlist: string[],
): string | null {
  const origin = request.headers.get("origin");
  if (origin === null) return null;

  const candidate = normalize(origin);

  for (const entry of allowlist) {
    const normalized = normalize(entry);
    // A literal star is never an origin, even when a request sends one.
    if (normalized === "*") continue;
    if (normalized.length > 0 && normalized === candidate) return normalized;
  }

  for (const entry of allowlist) {
    if (wildcardMatches(normalize(entry), candidate)) return candidate;
  }

  return null;
}

/** CORS headers for a resolved origin; Vary is always set so caches stay honest. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    vary: "Origin",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-probe-key",
    "access-control-max-age": "86400",
  };
  if (origin !== null && origin !== "*") {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}
