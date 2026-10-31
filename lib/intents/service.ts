/**
 * The settlement desk.
 *
 * Everything here talks to the 1Click API, which is what settles a trade
 * inside the NEAR Intents verifier contract. The API is public apart from
 * the endpoints that need a partner key.
 */

const BASE = process.env.NEXT_PUBLIC_ONE_CLICK_BASE_URL ?? "https://1click.chaindefuser.com";

export type Asset = {
  assetId: string;
  symbol: string;
  decimals: number;
  chain: string;
  price: number;
  contractAddress: string;
};

export type Quote = {
  engine: "intents";
  fromAssetId: string;
  toAssetId: string;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut: string;
  amountOutUsd: string;
  feeBps: number;
  rate: number;
  depositAddress?: string;
  expiresAt: string;
  warnings: string[];
};

export type SwapStatus = {
  state:
    | "pending"
    | "processing"
    | "settled"
    | "refunded"
    | "failed"
    | "incomplete_deposit";
  amountOut?: string;
  depositAddress: string;
  explorerUrls: string[];
};

type TokensResponse = {
  data: Array<{
    assetId: string;
    symbol: string;
    decimals: number;
    blockchain: string;
    price: number;
    contractAddress: string;
  }>;
};

let catalogueCache: Asset[] | null = null;
let catalogueFetchedAt = 0;

export async function getAssets(): Promise<Asset[]> {
  const now = Date.now();
  if (catalogueCache && now - catalogueFetchedAt < 5 * 60_000) {
    return catalogueCache;
  }

  const res = await fetch(`${BASE}/v0/tokens`, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error("The asset catalogue is unavailable");

  const raw = (await res.json()) as TokensResponse | TokensResponse["data"];
  const items = Array.isArray(raw) ? raw : (raw.data ?? []);
  const assets = items.map((t) => ({
    assetId: t.assetId,
    symbol: t.symbol,
    decimals: t.decimals,
    chain: t.blockchain,
    price: t.price,
    contractAddress: t.contractAddress,
  }));

  catalogueCache = assets;
  catalogueFetchedAt = now;
  return assets;
}

/**
 * Finds an asset by ticker.
 *
 * The ticker is ambiguous across chains, so this returns every match and the
 * caller decides, rather than picking one and being quietly wrong.
 */
export async function findAssets(symbol: string): Promise<Asset[]> {
  const wanted = symbol.toLowerCase();
  const assets = await getAssets();
  return assets.filter((a) => a.symbol.toLowerCase() === wanted);
}

export async function quote(params: {
  fromAssetId: string;
  toAssetId: string;
  amount: string;
  recipient: string;
  slippageBps?: number;
}): Promise<Quote> {
  const deadline = new Date(Date.now() + 30 * 60_000).toISOString();

  const res = await fetch(`${BASE}/v0/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      originAsset: params.fromAssetId,
      destinationAsset: params.toAssetId,
      amount: params.amount,
      recipient: params.recipient,
      refundTo: params.recipient,
      depositType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
      slippageTolerance: params.slippageBps ?? 100,
      deadline,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`The quote could not be priced: ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as {
    quote: {
      amountIn: string;
      amountInFormatted: string;
      amountOut: string;
      amountOutFormatted: string;
      minAmountOut: string;
      amountOutUsd: string;
    };
  };

  const q = body.quote;
  const amountIn = Number(q.amountIn);
  const amountOut = Number(q.amountOut);

  return {
    engine: "intents",
    fromAssetId: params.fromAssetId,
    toAssetId: params.toAssetId,
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountOut: q.amountOut,
    amountOutFormatted: q.amountOutFormatted,
    minAmountOut: q.minAmountOut,
    amountOutUsd: q.amountOutUsd,
    feeBps: 0,
    rate: amountIn > 0 ? amountOut / amountIn : 0,
    expiresAt: deadline,
    warnings: [],
  };
}

const TERMINAL: Record<string, SwapStatus["state"]> = {
  SUCCESS: "settled",
  FAILED: "failed",
  REFUNDED: "refunded",
  INCOMPLETE_DEPOSIT: "incomplete_deposit",
  PENDING_DEPOSIT: "pending",
  KNOWN_DEPOSIT_TX: "pending",
  PROCESSING: "processing",
};

export async function getStatus(depositAddress: string): Promise<SwapStatus> {
  const res = await fetch(
    `${BASE}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
  );
  if (!res.ok) throw new Error("The trade status is unavailable");

  const body = (await res.json()) as {
    status: string;
    swapDetails?: {
      amountOutFormatted?: string;
      originChainTxHashes?: Array<{ explorerUrl?: string }>;
      destinationChainTxHashes?: Array<{ explorerUrl?: string }>;
    };
  };

  const details = body.swapDetails ?? {};

  return {
    state: TERMINAL[body.status] ?? "pending",
    amountOut: details.amountOutFormatted,
    depositAddress,
    explorerUrls: [
      ...(details.originChainTxHashes ?? []),
      ...(details.destinationChainTxHashes ?? []),
    ]
      .map((h) => h.explorerUrl)
      .filter((u): u is string => !!u),
  };
}
