import { corsHeaders, parseAllowlist, pickAllowedOrigin } from "./cors";
import type { Env } from "./env";
import { isSupportedRange } from "./history";
import { MAX_ASSETS, PriceDesk, SERVICE } from "./price-desk";
import { wsRouteError } from "./ws-route";

// Wrangler resolves the durable object class from the module's exports.
export { PriceDesk };

const DESK_NAME = "global";
const READ_METHODS = "GET, HEAD, OPTIONS";
const SYNC_METHODS = "POST, OPTIONS";
const PRICES_CACHE = "public, s-maxage=10, stale-while-revalidate=20";
const HISTORY_CACHE = "public, s-maxage=300, stale-while-revalidate=600";
const HISTORY_NEGATIVE_CACHE =
  "public, s-maxage=60, stale-while-revalidate=120";
const MAX_ASSET_ID_LENGTH = 200;

/**
 * These routes reveal upstream hosts, network behaviour, or the internal
 * cache, so they stay dark unless the deployment sets a key. The gate runs
 * before the method check, so a keyless POST answers 404 rather than a 405
 * that advertises the route.
 */
const GATED_ROUTES = new Set([
  "/probe",
  "/registry",
  "/registry/sync",
  "/snapshot",
]);

function json(
  body: unknown,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/**
 * /probe, /registry, /registry/sync and /snapshot answer 404 without the key,
 * not 401: a hidden route should not advertise that it exists.
 */
function adminAuthorized(request: Request, env: Env): boolean {
  const key = env.PROBE_KEY;
  if (key === undefined || key.length === 0) return false;
  return request.headers.get("x-probe-key") === key;
}

/**
 * `?assets=a,b,a` becomes a stable de-duplicated list. Null means the request
 * asked for more than the cap, which is a 400 rather than a silent truncation:
 * a client that asks for sixty prices should know it only got fifty.
 */
function readAssetIds(raw: string | null): string[] | null {
  if (raw === null) return [];

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const part of raw.split(",")) {
    const assetId = part.trim();
    if (assetId.length === 0 || seen.has(assetId)) continue;

    seen.add(assetId);
    ids.push(assetId);
    if (ids.length > MAX_ASSETS) return null;
  }

  // Sorted for cache stability: the same set produces the same response keys.
  return ids.sort();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = pickAllowedOrigin(request, parseAllowlist(env.APP_ORIGINS));
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Inside the try so a malformed URL still answers with CORS headers.
    try {
      const url = new URL(request.url);
      const { pathname } = url;
      const { method } = request;

      // Gate the hidden routes before looking at the method: a hidden route
      // must answer 404, not a 405 that advertises which methods it accepts.
      if (GATED_ROUTES.has(pathname) && !adminAuthorized(request, env)) {
        return json({ error: "not-found" }, 404, cors);
      }

      if (pathname === "/registry/sync") {
        if (method !== "POST") {
          return json({ error: "method-not-allowed" }, 405, {
            ...cors,
            allow: SYNC_METHODS,
          });
        }

        const desk = env.PRICE_DESK.getByName(DESK_NAME);
        const result = await desk.syncCatalogue(true);
        // A failed refresh still returns the stale stats, but the status says
        // the catalogue was not actually updated.
        return json(result, result.error === undefined ? 200 : 503, cors);
      }

      // The socket is the only route that is not a plain HTTP read, so it is
      // decided before the generic method gate. Only GET can carry an upgrade:
      // a POST answers 405 rather than being forwarded.
      if (pathname === "/ws") {
        const wsError = wsRouteError({
          method,
          upgrade: request.headers.get("upgrade"),
          origin: request.headers.get("origin"),
          allowedOrigin: origin,
        });

        if (wsError !== null) {
          return json({ error: wsError.error }, wsError.status, {
            ...cors,
            ...(wsError.allow === undefined ? {} : { allow: wsError.allow }),
            ...(wsError.upgrade === undefined
              ? {}
              : { upgrade: wsError.upgrade }),
          });
        }

        return env.PRICE_DESK.getByName(DESK_NAME).fetch(request);
      }

      if (method !== "GET" && method !== "HEAD") {
        return json({ error: "method-not-allowed" }, 405, {
          ...cors,
          allow: READ_METHODS,
        });
      }

      if (pathname === "/") {
        return json(
          { service: SERVICE, status: "catalogue", now: Date.now() },
          200,
          cors,
        );
      }

      const known =
        pathname === "/health" ||
        pathname === "/probe" ||
        pathname === "/registry" ||
        pathname === "/prices" ||
        pathname === "/history" ||
        pathname === "/snapshot";

      if (!known) {
        return json({ error: "not-found" }, 404, cors);
      }

      if (pathname === "/prices") {
        const ids = readAssetIds(url.searchParams.get("assets"));

        if (ids === null) {
          return json({ error: "too-many-assets" }, 400, cors);
        }
        if (ids.some((assetId) => assetId.length > MAX_ASSET_ID_LENGTH)) {
          return json({ error: "bad-request" }, 400, cors);
        }
        // Nothing watched, nothing to wake the object for.
        if (ids.length === 0) {
          return json({ prices: {}, asOf: Date.now() }, 200, {
            ...cors,
            "cache-control": PRICES_CACHE,
          });
        }

        const desk = env.PRICE_DESK.getByName(DESK_NAME);
        return json(await desk.prices(ids), 200, {
          ...cors,
          "cache-control": PRICES_CACHE,
        });
      }

      if (pathname === "/history") {
        const asset = url.searchParams.get("asset");
        const range = url.searchParams.get("range");

        // One asset and one range per request. A missing or unknown range is
        // a bad request, not an empty series: the caller asked for something
        // this service does not serve.
        if (
          asset === null ||
          asset.trim().length === 0 ||
          asset.trim().length > MAX_ASSET_ID_LENGTH ||
          !isSupportedRange(range)
        ) {
          return json({ error: "bad-request" }, 400, cors);
        }

        const desk = env.PRICE_DESK.getByName(DESK_NAME);
        const body = await desk.history(asset.trim(), range);
        // An empty series is a short-lived miss, not a 300-second answer: a
        // card that reopens after an upstream outage should retry sooner.
        const cache =
          body.points.length === 0
            ? HISTORY_NEGATIVE_CACHE
            : HISTORY_CACHE;
        return json(body, 200, {
          ...cors,
          "cache-control": cache,
        });
      }

      const desk = env.PRICE_DESK.getByName(DESK_NAME);

      if (pathname === "/health") {
        const health = await desk.health();
        return json(health, health.ok ? 200 : 503, cors);
      }

      if (pathname === "/registry") {
        return json(await desk.catalogueStats(), 200, cors);
      }

      if (pathname === "/snapshot") {
        return json(await desk.snapshot(), 200, cors);
      }

      const probe = await desk.probe();
      return json(probe, probe.ok ? 200 : 503, cors);
    } catch (error) {
      // Mask the detail: this route is public and the log keeps the cause.
      console.error("[prices] durable object call failed", error);
      return json({ ok: false, error: "price desk unavailable" }, 503, cors);
    }
  },
};
