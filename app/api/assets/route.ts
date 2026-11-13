import { NextResponse } from "next/server";
import { getAssets } from "@/lib/intents/service";
import { getLivePrices } from "@/lib/prices/server";

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
  // 1Click catalogues native NEAR as wNEAR on the NEAR chain. A card or chip
  // for NEAR asks for the NEAR ticker, and the catalogue may also carry a NEAR
  // token on another chain (bsc). Include the wNEAR row so the chain-matched
  // pick resolves to nep141:wrap.near instead of the other chain's row.
  const wantsNear = wantedSymbols.has("NEAR");
  const matched = catalogue.filter((a) => {
    if (wantedIds.has(a.assetId)) return true;
    const symbol = a.symbol.toUpperCase();
    if (wantedSymbols.has(symbol)) return true;
    return wantsNear && symbol === "WNEAR" && a.chain === "near";
  });

  // The catalogue is a five-minute batch. The seed carries a live quote
  // when the Worker has one, and the catalogue price otherwise, so a chip
  // can paint immediately without waiting for the socket.
  const live = await getLivePrices(matched.map((a) => a.assetId));

  return NextResponse.json({
    assets: matched.map((a) => {
      const quote = live.get(a.assetId);
      const priceAsOf = quote?.asOf ?? a.priceUpdatedAt;
      return {
        assetId: a.assetId,
        symbol: a.symbol.toUpperCase(),
        chain: a.chain,
        decimals: a.decimals,
        priceUsd: quote?.usd ?? a.price,
        contractAddress: a.contractAddress,
        ...(priceAsOf !== undefined ? { priceAsOf } : {}),
      };
    }),
  });
}
