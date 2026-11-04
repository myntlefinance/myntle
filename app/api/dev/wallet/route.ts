import { NextRequest, NextResponse } from "next/server";

/**
 * The development wallet key, for local testing only.
 *
 * Deliberately not a `NEXT_PUBLIC_` variable: those are inlined into the
 * client bundle at build time, so the key would ship with a deployment even
 * though the app would never use it. Serving it from a route keeps it on the
 * server, and a production build answers 404 so it is never handed out.
 *
 * Local only. There is no authentication here because there is nothing to
 * protect beyond a key the developer already has, and it cannot run in
 * production.
 */
export const dynamic = "force-dynamic";

function noStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  // A request from another origin would let any page on this machine ask for
  // the key while the dev server is running.
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  const key = process.env.DEV_WALLET_KEY?.trim();
  if (!key) return noStore({ key: null });
  return noStore({ key });
}
