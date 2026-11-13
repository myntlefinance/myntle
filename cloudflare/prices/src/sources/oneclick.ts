import { parseCatalogue } from "../catalogue";
import { requestJson } from "../lib/http";
import {
  fail,
  fromHttp,
  type CurrentQuote,
  type SourceConfig,
  type SourceResult,
} from "./types";

/**
 * 1Click's token list is the catalogue and the last live source. Its prices
 * are a five-minute batch, so polling it faster than the plan's 60 seconds
 * buys nothing. It is the only source that carries the catalogue `assetId`,
 * which is why it is also the fallback that always has an identity.
 */
const TOKENS_URL = "https://1click.chaindefuser.com/v0/tokens";

export type OneclickSource = {
  readonly name: "oneclick";
  readonly configured: true;
  fetchCurrent(): Promise<SourceResult<CurrentQuote[]>>;
};

export function createOneclickSource(
  config: SourceConfig = {},
): OneclickSource {
  const now = config.now ?? Date.now;
  const fetchImpl = config.fetchImpl ?? fetch;
  const cacheMs = Math.max(0, config.oneclickCacheMs ?? 60_000);

  // The catalogue is one batch for the whole service, not one per asset. The
  // cache is shared by every caller of this adapter instance, so a batch walk
  // and the next alarm tick both reuse the same 222 rows.
  let cached: { at: number; quotes: CurrentQuote[] } | null = null;

  return {
    name: "oneclick",
    configured: true,

    /**
     * The endpoint returns a flat array today; `parseCatalogue` also accepts
     * the `{ data: [...] }` wrapper and drops rows with no price. A positive
     * price is required here even though the catalogue may keep a zero: a
     * $0.00 live quote is not a price. A row whose timestamp is missing is
     * stamped with the fetch time because the price arrived with this
     * response; the adapter never invents a value.
     */
    async fetchCurrent(): Promise<SourceResult<CurrentQuote[]>> {
      const at = now();
      if (cached !== null && at - cached.at < cacheMs) {
        return { ok: true, value: cached.quotes };
      }

      const result = await requestJson({
        url: TOKENS_URL,
        fetchImpl,
        now,
      });

      if (!result.ok) return fromHttp(result);

      const assets = parseCatalogue(result.body);
      if (assets.length === 0) return fail("malformed-response");

      const fetchedAt = now();
      const quotes: CurrentQuote[] = [];
      for (const asset of assets) {
        if (asset.price === null || asset.price <= 0) continue;

        quotes.push({
          assetId: asset.assetId,
          symbol: asset.symbol,
          usd: asset.price,
          asOf: asset.priceUpdatedAt ?? fetchedAt,
          source: "oneclick",
        });
      }

      // An empty list is not cached: it is more likely a transient omission
      // than a real catalogue with no prices.
      if (quotes.length > 0) cached = { at, quotes };
      return { ok: true, value: quotes };
    },
  };
}
