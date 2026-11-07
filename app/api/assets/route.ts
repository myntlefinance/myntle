import { NextResponse } from "next/server";
import { getAssets } from "@/lib/intents/service";

/**
 * Resolves asset ids or tickers to human-readable metadata.
 *
 * The card cannot depend on the model having looked an asset up in-turn:
 * a quote-only turn carries no catalogue output, and raw contract ids
 * must never reach the interface. The catalogue is public and cached
 * server-side, so this lookup is cheap.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 20);
  const symbols = (searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0)
    .slice(0, 20);

  if (ids.length === 0 && symbols.length === 0) {
    return NextResponse.json({ assets: [] });
  }

  let catalogue: Awaited<ReturnType<typeof getAssets>>;
  try {
    catalogue = await getAssets();
  } catch {
    return NextResponse.json({ error: "An error occurred." }, { status: 502 });
  }

  const wantedIds = new Set(ids);
  const wantedSymbols = new Set(symbols);
  return NextResponse.json({
    assets: catalogue
      .filter(
        (a) =>
          wantedIds.has(a.assetId) ||
          wantedSymbols.has(a.symbol.toUpperCase()),
      )
      .map((a) => ({
        assetId: a.assetId,
        symbol: a.symbol.toUpperCase(),
        chain: a.chain,
        decimals: a.decimals,
        priceUsd: a.price,
      })),
  });
}
