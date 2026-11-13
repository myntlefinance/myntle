import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { MAX_WATCH_ADDRESS_LENGTH } from "@/lib/wallet/addresses";
import { isNameResolutionError } from "@/lib/ports/names";

/**
 * Reads one name behind the name port. The Track dialog calls this on a
 * debounce to validate `*.eth` input; the watchlist routes never call it,
 * because they resolve server-side through the port at submit time and
 * never trust an address the client worked out.
 *
 * Reads here are always fresh: the default resolver carries no shared
 * memory, so approval-time reads stay TTL 0 by construction. There is no
 * per-request provider override on this route — the mainnet read travels
 * the registry-wired client only, and any `?rpc=` query value is ignored.
 * Results are masked at the boundary: failure detail goes to the server
 * log, and the client receives one fixed sentence per outcome.
 */
export async function GET(req: Request) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(req.url);
  const chain = (url.searchParams.get("chain") ?? "evm").toLowerCase();
  if (chain !== "evm" && chain !== "solana") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const input = (url.searchParams.get("name") ?? "").trim();
  if (!input || input.length > MAX_WATCH_ADDRESS_LENGTH) {
    return NextResponse.json(
      { error: "That name is not valid. Check it and try again." },
      { status: 400 },
    );
  }

  let resolveName: (
    chain: "evm" | "solana",
    input: string,
  ) => Promise<{ address: string; name: string; resolvedAt: string } | null>;
  try {
    const { getNameResolverPort } = await import("@/lib/adapters/registry");
    const port = getNameResolverPort();
    resolveName = (c, v) => port.resolveName(c, v);
  } catch {
    return NextResponse.json(
      { error: "Name lookup is unavailable. Try again shortly." },
      { status: 503 },
    );
  }

  try {
    const hit = await resolveName(
      chain as "evm" | "solana",
      input,
    );
    if (hit === null) {
      return NextResponse.json(
        { error: "That name is not registered. Check the spelling and try again." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      address: hit.address,
      name: hit.name,
      resolvedAt: hit.resolvedAt,
    });
  } catch (error) {
    if (isNameResolutionError(error)) {
      if (error.kind === "invalid_input") {
        if (error.reason === "bad_suffix") {
          return NextResponse.json(
            {
              error:
                chain === "evm"
                  ? "Only .eth names resolve here. Check the ending and try again."
                  : "Only .sns names resolve here. Check the ending and try again.",
            },
            { status: 400 },
          );
        }
        return NextResponse.json(
          { error: "That name is not valid. Check it and try again." },
          { status: 400 },
        );
      }
      if (error.reason === "sns_sol_transition") {
        return NextResponse.json(
          { error: ".sol names cannot be read right now. Try again later." },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: "Name lookup is unavailable. Try again shortly." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
