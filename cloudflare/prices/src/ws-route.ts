/**
 * The HTTP-level gate for `GET /ws`. The socket itself belongs to the Durable
 * Object; this module only decides whether the request may reach it, so the
 * method, upgrade and Origin rules can be tested without a Workers runtime.
 */

export type WsRouteError = {
  status: 403 | 405 | 426;
  error: string;
  /** Set on 405 so the response advertises the one method that can upgrade. */
  allow?: "GET";
  /** Set on 426 so the client knows what to retry with. */
  upgrade?: "websocket";
};

/**
 * Only GET can carry a WebSocket upgrade. A present Origin must be on the same
 * allowlist as the HTTP routes; an absent one is allowed, because a browser
 * always sends one and a scripted client can reach the public feed anyway.
 */
export function wsRouteError(input: {
  method: string;
  upgrade: string | null;
  origin: string | null;
  allowedOrigin: string | null;
}): WsRouteError | null {
  if (input.method !== "GET") {
    return { status: 405, error: "method-not-allowed", allow: "GET" };
  }

  if (input.upgrade === null || input.upgrade.toLowerCase() !== "websocket") {
    return { status: 426, error: "upgrade-required", upgrade: "websocket" };
  }

  if (input.origin !== null && input.allowedOrigin === null) {
    return { status: 403, error: "forbidden" };
  }

  return null;
}
