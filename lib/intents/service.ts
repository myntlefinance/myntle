/**
 * The settlement desk.
 *
 * Everything here talks to the 1Click API, which is what settles a trade
 * inside the NEAR Intents verifier contract. The API is public apart from
 * the endpoints that need a partner key.
 */

import { settlementLinks } from "@/lib/intents/explorer";

const BASE = process.env.NEXT_PUBLIC_ONE_CLICK_BASE_URL ?? "https://1click.chaindefuser.com";

/** Partner auth for 1Click. Server-side only; never expose the key to the browser. */
function oneClickHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = process.env.ONE_CLICK_API_KEY;
  return {
    "Content-Type": "application/json",
    // The API documents `X-API-Key` as partner auth; `Authorization: Bearer`
    // is the legacy JWT path and a raw partner key is not a JWT. The quote and
    // generate endpoints tolerated the Bearer form, but `submit-intent` is
    // strict about the auth scheme.
    ...(key ? { "X-API-Key": key } : {}),
    ...extra,
  };
}

export type Asset = {
  assetId: string;
  symbol: string;
  decimals: number;
  chain: string;
  price: number;
  /** When the catalogue observed this price, in milliseconds. */
  priceUpdatedAt?: number;
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
  /** Minimum accepted output, formatted in whole units for display. */
  minAmountOut: string;
  /** The same minimum in the smallest unit, for exact comparison and signing. */
  minAmountOutRaw: string;
  amountOutUsd: string;
  feeBps: number;
  rate: number;
  /**
   * The flat withdrawal fee 1Click charged, in the origin asset's smallest
   * unit, and the same figure in whole units for display. Present only when
   * the quote reported one; a missing fee is never filled in as zero.
   */
  withdrawFee?: string;
  withdrawFeeFormatted?: string;
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
  /** The raw 1Click status, for callers that must tell PENDING from KNOWN. */
  status: string;
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
    priceUpdatedAt?: string;
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
  const assets = items.map((t) => {
    const observed = t.priceUpdatedAt ? Date.parse(t.priceUpdatedAt) : NaN;
    return {
      assetId: t.assetId,
      symbol: t.symbol,
      decimals: t.decimals,
      chain: t.blockchain,
      price: t.price,
      ...(Number.isFinite(observed) ? { priceUpdatedAt: observed } : {}),
      contractAddress: t.contractAddress,
    };
  });

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

export type ExecutionQuote = Quote & { depositAddress: string; depositMemo?: string | null };

/**
 * Which balances a trade moves between.
 *
 * `chain` is the wallet's direct route and stays the default, so every
 * existing caller keeps today's behavior. The confidential modes are the
 * unified account: `confidential-intents` spends a confidential balance and
 * keeps the output there, `confidential-external` funds that balance from an
 * external chain and refunds into it, and `confidential-withdrawal` spends
 * the confidential balance and pays an external destination chain. The
 * destination type is the discriminator, so a withdrawal can never be priced
 * by relabelling a swap.
 *
 * `confidentiality` is a separate field. `CONFIDENTIAL_INTENTS` says where
 * the funds live; `confidentiality` asks the verifier to unlink the trade.
 * Foreign-to-foreign routes need both, and neither substitutes for the other.
 */
export type QuoteMode =
  | "chain"
  | "confidential-intents"
  | "confidential-external"
  | "confidential-withdrawal";

/**
 * How 1Click sizes the trade.
 *
 * `EXACT_INPUT` fixes the amount the user sends, which is what every swap
 * needs. A deposit from an external chain is a passive funding route: the
 * sender may send the amount they choose, so P0.6 describes it as
 * `FLEX_INPUT`. The field is optional and defaults to `EXACT_INPUT`, so every
 * existing caller keeps today's request byte for byte.
 */
export type SwapType = "EXACT_INPUT" | "FLEX_INPUT";

type QuoteBalanceTypes = {
  depositType: "ORIGIN_CHAIN" | "DESTINATION_CHAIN" | "CONFIDENTIAL_INTENTS";
  recipientType: "ORIGIN_CHAIN" | "DESTINATION_CHAIN" | "CONFIDENTIAL_INTENTS";
  refundType: "ORIGIN_CHAIN" | "DESTINATION_CHAIN" | "CONFIDENTIAL_INTENTS";
};

const QUOTE_BALANCE_TYPES: Record<QuoteMode, QuoteBalanceTypes> = {
  chain: {
    depositType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    refundType: "ORIGIN_CHAIN",
  },
  "confidential-intents": {
    depositType: "CONFIDENTIAL_INTENTS",
    recipientType: "CONFIDENTIAL_INTENTS",
    refundType: "CONFIDENTIAL_INTENTS",
  },
  "confidential-external": {
    depositType: "ORIGIN_CHAIN",
    recipientType: "CONFIDENTIAL_INTENTS",
    refundType: "CONFIDENTIAL_INTENTS",
  },
  // Measured by B4b: the input leaves the private balance and the output pays
  // an external chain address. The refund returns to the private balance, so
  // a failed order costs no second withdrawal fee.
  "confidential-withdrawal": {
    depositType: "CONFIDENTIAL_INTENTS",
    recipientType: "DESTINATION_CHAIN",
    refundType: "CONFIDENTIAL_INTENTS",
  },
};

/** Fails closed on an unknown runtime value rather than quoting a public route. */
function balanceTypesFor(mode: QuoteMode | undefined): QuoteBalanceTypes {
  const resolved = mode ?? "chain";
  const types = QUOTE_BALANCE_TYPES[resolved];
  if (!types) throw new Error("The quote mode is not recognised.");
  return types;
}

async function requestQuote(params: {
  fromAssetId: string;
  toAssetId: string;
  amount: string;
  recipient: string;
  refundTo?: string;
  slippageBps?: number;
  confidentiality?: "public" | "basic" | "advanced";
  mode?: QuoteMode;
  swapType?: SwapType;
  dry: boolean;
}): Promise<{ formatted: Quote; raw: { depositAddress?: string; depositMemo?: string | null } }> {
  const fallbackDeadline = new Date(Date.now() + 30 * 60_000).toISOString();
  const types = balanceTypesFor(params.mode);

  // A withdrawal refunds to the private balance, and `refundTo ?? recipient`
  // would pair a CONFIDENTIAL_INTENTS refund with an external address. The
  // caller must name the account explicitly; there is no safe default.
  if (params.mode === "confidential-withdrawal" && !params.refundTo) {
    throw new Error("A withdrawal needs an explicit refund address.");
  }

  const res = await fetch(`${BASE}/v0/quote`, {
    method: "POST",
    headers: oneClickHeaders(),
    body: JSON.stringify({
      dry: params.dry,
      swapType: params.swapType ?? "EXACT_INPUT",
      originAsset: params.fromAssetId,
      destinationAsset: params.toAssetId,
      amount: params.amount,
      recipient: params.recipient,
      // Refund routing follows the mode: the chain route returns to the
      // wallet on the origin chain, and the confidential modes return to the
      // Intents account as a confidential balance. Callers pass the address
      // that is valid for that route; the recipient may live elsewhere.
      refundTo: params.refundTo ?? params.recipient,
      depositType: types.depositType,
      recipientType: types.recipientType,
      refundType: types.refundType,
      slippageTolerance: params.slippageBps ?? 100,
      deadline: fallbackDeadline,
      // Confidential-only thesis: every foreign-to-foreign quote requests
      // privacy. The boundary still accepts `public` for old stored callers,
      // but nothing is ever sent with it.
      confidentiality: params.confidentiality === "advanced" ? "advanced" : "basic",
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
      depositAddress?: string;
      depositMemo?: string | null;
      deadline?: string;
      timeWhenInactive?: string;
      withdrawFee?: string;
    };
  };

  const q = body.quote;
  const amountInUnits = Number.parseFloat(q.amountInFormatted);
  const amountOutUnits = Number.parseFloat(q.amountOutFormatted);

  // The wet quote carries the authoritative deadline. A dry preview has no
  // deposit window, so it keeps the local fallback the card was priced with.
  const serverDeadline = q.deadline ?? q.timeWhenInactive;
  const expiresAt =
    !params.dry && serverDeadline && !Number.isNaN(Date.parse(serverDeadline))
      ? serverDeadline
      : fallbackDeadline;

  // The withdrawal fee is flat per quote and charged in the origin asset.
  // Only a numeric value is surfaced; an absent field is not turned into a
  // zero, because a zero fee and an unreported fee mean different things.
  const withdrawFee =
    typeof q.withdrawFee === "string" && /^\d+$/.test(q.withdrawFee)
      ? q.withdrawFee
      : undefined;

  const formatted: Quote = {
    engine: "intents",
    fromAssetId: params.fromAssetId,
    toAssetId: params.toAssetId,
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountOut: q.amountOut,
    amountOutFormatted: q.amountOutFormatted,
    minAmountOut: formatUnits(q.minAmountOut, await decimalsOf(params.toAssetId)),
    minAmountOutRaw: q.minAmountOut,
    amountOutUsd: q.amountOutUsd,
    feeBps: 0,
    // Whole-unit rate. The raw ratio is off by the decimals gap (USDC has
    // 6, wNEAR 24), so it would mislead every downstream decision.
    rate:
      amountInUnits > 0 && Number.isFinite(amountInUnits) && Number.isFinite(amountOutUnits)
        ? amountOutUnits / amountInUnits
        : 0,
    ...(withdrawFee
      ? {
          withdrawFee,
          withdrawFeeFormatted: formatUnits(
            withdrawFee,
            await decimalsOf(params.fromAssetId),
          ),
        }
      : {}),
    expiresAt,
    warnings: [],
  };

  return { formatted, raw: { depositAddress: q.depositAddress, depositMemo: q.depositMemo ?? null } };
}

/** Decimals for an asset id from the catalogue. Falls back to 0 (raw). */
async function decimalsOf(assetId: string): Promise<number> {
  try {
    const assets = await getAssets();
    return assets.find((a) => a.assetId === assetId)?.decimals ?? 0;
  } catch {
    return 0;
  }
}

/** Raw smallest-unit integer to whole units, truncated, never rounded up. */
function formatUnits(raw: string, decimals: number): string {
  if (decimals <= 0) return raw;
  let digits = raw.trim();
  if (!/^\d+$/.test(digits)) return raw;
  digits = digits.replace(/^0+(?=\d)/, "");
  const padded = digits.padStart(decimals + 1, "0");
  const head = padded.slice(0, -decimals);
  const tail = padded.slice(-decimals).replace(/0+$/, "").slice(0, 6);
  return tail ? `${head}.${tail}` : head;
}

export async function quote(params: {
  fromAssetId: string;
  toAssetId: string;
  amount: string;
  recipient: string;
  refundTo?: string;
  slippageBps?: number;
  confidentiality?: "public" | "basic" | "advanced";
  mode?: QuoteMode;
  swapType?: SwapType;
}): Promise<Quote> {
  const { formatted } = await requestQuote({ ...params, dry: true });
  return formatted;
}

/** A live execution quote. Returns the one-time deposit address the user funds. */
export async function createExecutionQuote(params: {
  fromAssetId: string;
  toAssetId: string;
  amount: string;
  recipient: string;
  refundTo?: string;
  slippageBps?: number;
  confidentiality?: "public" | "basic" | "advanced";
  mode?: QuoteMode;
  swapType?: SwapType;
}): Promise<ExecutionQuote> {
  const { formatted, raw } = await requestQuote({ ...params, dry: false });
  if (!raw.depositAddress) {
    throw new Error("Unable to execute trade. Please try again.");
  }
  return { ...formatted, depositAddress: raw.depositAddress, depositMemo: raw.depositMemo ?? null };
}

/** The signing standards 1Click accepts for a `swap_transfer` intent. */
export type IntentStandard = "webauthn" | "erc191" | "raw_ed25519" | "nep413";

const INTENT_STANDARDS: readonly IntentStandard[] = [
  "webauthn",
  "erc191",
  "raw_ed25519",
  "nep413",
];

const GENERATE_INTENT_ERROR = "Unable to prepare the transaction. Please try again.";
const SUBMIT_INTENT_ERROR = "Unable to submit the transaction. Please try again.";

export type GeneratedIntent = {
  standard: IntentStandard;
  /**
   * Exactly what 1Click returned. `webauthn`, `erc191`, and `raw_ed25519`
   * return a JSON string; `nep413` returns an object (P0.3c). The value is
   * never parsed, re-stringified, or trimmed, because the signature covers
   * the exact bytes.
   */
  payload: string | Record<string, unknown>;
};

/**
 * Reads only a short error code from a failed 1Click response.
 *
 * The status and a code such as "Bad Request" are enough to diagnose the
 * call. The response body, the request, the payload, and the partner key are
 * never logged: a validation message can echo a field, and a payload is
 * signed material.
 */
async function logIntentFailure(operation: string, res: Response): Promise<void> {
  let code = "http";
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown };
    const candidate =
      typeof body.error === "string"
        ? body.error
        : typeof body.code === "string"
          ? body.code
          : "";
    if (candidate) code = candidate.slice(0, 40);
  } catch {
    // Not JSON; the status is enough.
  }
  // The code travels in the message because the dev logger keeps the message
  // and drops the metadata object. It is a short code, never the body.
  console.error(
    `[intents] ${operation} failed (HTTP ${res.status}${code ? `, ${code}` : ""})`,
  );
}

function isIntentPayload(value: unknown): value is string | Record<string, unknown> {
  return (
    typeof value === "string" ||
    (typeof value === "object" && value !== null && !Array.isArray(value))
  );
}

/**
 * Asks 1Click to build the exact payload one signer must sign for a quote.
 *
 * The payload is bound to the quote's `depositAddress` and deadline, and it
 * is not stable across calls: every call mints a new nonce (P0.3). Store the
 * string this call returns and compare against that exact string later; never
 * generate again to compare.
 *
 * The API does not bind `signerId` to the quote and does not validate the
 * standard against the key type, so the caller must pass the session's own
 * signer and re-check the parsed payload before signing.
 */
export async function generateIntent(params: {
  type: "swap_transfer";
  standard: IntentStandard;
  signerId: string;
  depositAddress: string;
}): Promise<GeneratedIntent> {
  const res = await fetch(`${BASE}/v0/generate-intent`, {
    method: "POST",
    headers: oneClickHeaders(),
    body: JSON.stringify({
      type: params.type,
      standard: params.standard,
      signerId: params.signerId,
      depositAddress: params.depositAddress,
    }),
  });

  if (!res.ok) {
    await logIntentFailure("generate-intent", res);
    throw new Error(GENERATE_INTENT_ERROR);
  }

  const body = (await res.json()) as {
    intent?: { standard?: unknown; payload?: unknown };
  };
  const standard = body.intent?.standard;
  const payload = body.intent?.payload;

  if (
    typeof standard !== "string" ||
    !INTENT_STANDARDS.includes(standard as IntentStandard) ||
    standard !== params.standard ||
    !isIntentPayload(payload)
  ) {
    // A different standard would make the client sign the wrong shape.
    console.error("[intents] generate-intent returned an unexpected shape", {
      status: res.status,
    });
    throw new Error(GENERATE_INTENT_ERROR);
  }

  return { standard: standard as IntentStandard, payload };
}

export type SubmitIntentResult = {
  /** `base58(sha256(payload))`, content-addressed and usable only for dedupe. */
  intentHash: string;
  /** A per-request trace id. Not a trade id and not a status correlation key. */
  correlationId: string;
};

/**
 * Enqueues a signed intent for execution.
 *
 * This call is **not** a verification verdict and a `201` is **not**
 * acceptance. P0.4 measured `201 { intentHash, correlationId }` for a
 * correct assertion and for a forged one; the endpoint's only synchronous
 * rejections are schema-level. The caller must verify the assertion itself
 * before calling this, treat `intentHash` as a dedupe key rather than proof,
 * and read the outcome from `GET /v0/status?depositAddress=…` in the
 * workflow. Never report a settlement from this response.
 */
export async function submitIntent(params: {
  type: "swap_transfer";
  signedData: unknown;
}): Promise<SubmitIntentResult> {
  const res = await fetch(`${BASE}/v0/submit-intent`, {
    method: "POST",
    headers: oneClickHeaders(),
    body: JSON.stringify({ type: params.type, signedData: params.signedData }),
  });

  if (!res.ok) {
    await logIntentFailure("submit-intent", res);
    throw new Error(SUBMIT_INTENT_ERROR);
  }

  const body = (await res.json()) as {
    intentHash?: unknown;
    correlationId?: unknown;
  };

  if (typeof body.intentHash !== "string" || body.intentHash.length === 0) {
    console.error("[intents] submit-intent returned no intentHash", {
      status: res.status,
    });
    throw new Error(SUBMIT_INTENT_ERROR);
  }

  return {
    intentHash: body.intentHash,
    correlationId:
      typeof body.correlationId === "string" ? body.correlationId : "",
  };
}

/** Tells 1Click which on-chain deposit funds the trade, so polling can begin. */
export async function submitDepositTx(params: {
  depositAddress: string;
  txHash: string;
  nearSenderAccount?: string;
  memo?: string;
}): Promise<void> {
  const res = await fetch(`${BASE}/v0/deposit/submit`, {
    method: "POST",
    headers: oneClickHeaders(),
    body: JSON.stringify({
      depositAddress: params.depositAddress,
      txHash: params.txHash,
      ...(params.nearSenderAccount ? { nearSenderAccount: params.nearSenderAccount } : {}),
      ...(params.memo ? { memo: params.memo } : {}),
    }),
  });
  // A 404 means this build of 1Click tracks deposits without an explicit
  // submit call; the status poll below is still authoritative.
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `The deposit could not be registered: ${detail.slice(0, 160)}`,
    );
  }
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

export async function getStatus(
  depositAddress: string,
  depositMemo?: string | null,
  assets?: {
    originAssetId?: string | null;
    destinationAssetId?: string | null;
  },
): Promise<SwapStatus> {
  // A memo-bearing address (XRP, Stellar, and similar) is ambiguous without
  // its memo; the status endpoint takes it as a second query parameter.
  const query = new URLSearchParams({ depositAddress });
  if (depositMemo) query.set("depositMemo", depositMemo);
  const res = await fetch(`${BASE}/v0/status?${query.toString()}`, {
    headers: oneClickHeaders({ "Content-Type": "application/json" }),
  });
  if (!res.ok) throw new Error("The trade status is unavailable");

  const body = (await res.json()) as {
    status: string;
    swapDetails?: {
      amountOutFormatted?: string;
      originChainTxHashes?: Array<{ hash?: string; explorerUrl?: string }>;
      destinationChainTxHashes?: Array<{ hash?: string; explorerUrl?: string }>;
    };
  };

  const details = body.swapDetails ?? {};
  const originHashes = details.originChainTxHashes ?? [];
  const destinationHashes = details.destinationChainTxHashes ?? [];
  // The URL is only resolved when the API left it empty, and only then is the
  // catalogue read: the chain is what turns a hash into a link.
  const missingUrl = [...originHashes, ...destinationHashes].some(
    (h) => h.hash && !h.explorerUrl,
  );
  const [originChain, destinationChain] = missingUrl
    ? await Promise.all([
        chainOfAsset(assets?.originAssetId),
        chainOfAsset(assets?.destinationAssetId),
      ])
    : [null, null];

  return {
    state: TERMINAL[body.status] ?? "pending",
    status: body.status,
    amountOut: details.amountOutFormatted,
    depositAddress,
    explorerUrls: settlementLinks([
      { chain: originChain, hashes: originHashes },
      { chain: destinationChain, hashes: destinationHashes },
    ]),
  };
}

/** The catalogue's chain for an asset id; a missing catalogue is no link. */
export async function chainOfAsset(
  assetId?: string | null,
): Promise<string | null> {
  if (!assetId) return null;
  try {
    const assets = await getAssets();
    return assets.find((asset) => asset.assetId === assetId)?.chain ?? null;
  } catch {
    return null;
  }
}
