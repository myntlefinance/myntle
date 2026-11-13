import bs58 from "bs58";
import { getAssets } from "./service";

export type IntentsLedgerBalance = {
  assetId: string;
  symbol: string;
  decimals: number;
  balance: string;
  rawBalance: string;
  priceUsd?: number;
  valueUsd?: number;
  /** Whole-unit quantity, from the formatted ledger amount. */
  quantity?: number;
  /** When the catalogue observed the unit price, in milliseconds. */
  priceAsOf?: number;
};

export type IntentsBalancesResult = {
  status: "settled" | "empty" | "error";
  balances: IntentsLedgerBalance[];
  totalValueUsd?: number;
  message?: string;
};

/**
 * The implicit account the verifier derives from a wallet key.
 *
 * Named NEAR accounts keep their name; an EVM key maps to its lowercase
 * address and an EdDSA key (Solana) to the 64-hex implicit address. No
 * registration and no signature: the mapping is deterministic.
 */
export function intentsAccountId(
  chain: string,
  address: string,
): string | null {
  const c = chain.toLowerCase();
  if (c === "near" || c === "near-mainnet") return address;
  if (
    c === "evm" ||
    c === "eth" ||
    c === "ethereum" ||
    c === "base" ||
    c === "arbitrum" ||
    c === "arb" ||
    c === "optimism" ||
    c === "op" ||
    c === "polygon" ||
    c === "matic"
  ) {
    return address.toLowerCase();
  }
  if (c === "solana" || c === "sol" || c === "solana-mainnet") {
    try {
      return Array.from(bs58.decode(address))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return null;
    }
  }
  return null;
}

/** Raw smallest-unit integer to whole units, truncated, never rounded up. */
export function formatUnits(raw: string, decimals: number): string {
  if (decimals <= 0) return raw;
  const digits = raw.trim();
  if (!/^\d+$/.test(digits)) return raw;
  const padded = digits.replace(/^0+(?=\d)/, "").padStart(decimals + 1, "0");
  const head = padded.slice(0, -decimals);
  const tail = padded.slice(-decimals).replace(/0+$/, "").slice(0, 6);
  return tail ? `${head}.${tail}` : head;
}

function rpcArgsBase64(args: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(args)).toString("base64");
}

function parseUtf8(result: number[]): string {
  return Buffer.from(result).toString("utf8").replace(/^"|"$/g, "");
}

/**
 * Reads the funds settled inside the NEAR Intents verifier ledger.
 *
 * Two public view calls against `intents.near`, no signature and no session
 * token: enumerate the account's token ids, then read every balance at once.
 * A token the account never touched never appears, so empty ledgers cost
 * exactly one cheap call.
 */
export async function getIntentsLedgerBalances(
  address?: string,
  chain?: string,
): Promise<IntentsBalancesResult> {
  const empty: IntentsBalancesResult = {
    status: "empty",
    balances: [],
    totalValueUsd: 0,
    message: "Settlement ledger is empty.",
  };
  if (!address) return empty;

  const accountId = intentsAccountId(chain ?? "near", address);
  if (!accountId) return empty;

  const rpc =
    process.env.NEAR_RPC_PRIMARY ??
    process.env.NEXT_PUBLIC_NEAR_RPC_PRIMARY ??
    "https://free.rpc.fastnear.com";

  async function view<T>(method: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "intents-ledger",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: "intents.near",
          method_name: method,
          args_base64: rpcArgsBase64(args),
        },
      }),
    });
    if (!res.ok) throw new Error(`ledger rpc ${res.status}`);
    const body = (await res.json()) as {
      result?: { result?: number[] };
      error?: unknown;
    };
    if (body.error || !body.result?.result) throw new Error("ledger rpc error");
    return JSON.parse(parseUtf8(body.result.result)) as T;
  }

  try {
    const owned = await view<Array<{ token_id: string }>>("mt_tokens_for_owner", {
      account_id: accountId,
    });
    const tokenIds = [...new Set(owned.map((t) => t.token_id).filter(Boolean))];
    if (tokenIds.length === 0) return empty;

    const amounts = await view<string[]>("mt_batch_balance_of", {
      account_id: accountId,
      token_ids: tokenIds,
    });

    const catalogue = await getAssets().catch(() => []);
    const balances: IntentsLedgerBalance[] = [];
    for (let i = 0; i < tokenIds.length; i += 1) {
      const tokenId = tokenIds[i];
      const raw = amounts[i] ?? "0";
      let amount: bigint;
      try {
        amount = BigInt(raw || "0");
      } catch {
        continue;
      }
      if (amount <= 0n) continue;
      const asset = catalogue.find((a) => a.assetId === tokenId);
      const symbol = asset?.symbol ?? "UNKNOWN";
      const decimals = asset?.decimals ?? 18;
      const priceUsd = asset?.price;
      const formatted = formatUnits(raw, decimals);
      const numFormatted = Number.parseFloat(formatted);
      const valueUsd =
        priceUsd !== undefined && !Number.isNaN(numFormatted)
          ? Number.parseFloat((numFormatted * priceUsd).toFixed(2))
          : undefined;
      balances.push({
        assetId: tokenId,
        symbol,
        decimals,
        balance: formatted,
        rawBalance: raw,
        priceUsd,
        valueUsd,
        ...(Number.isFinite(numFormatted) ? { quantity: numFormatted } : {}),
        ...(asset?.priceUpdatedAt !== undefined
          ? { priceAsOf: asset.priceUpdatedAt }
          : {}),
      });
    }

    if (balances.length === 0) return empty;

    const totalValueUsd = balances.reduce((sum, b) => sum + (b.valueUsd ?? 0), 0);

    return {
      status: "settled",
      balances,
      totalValueUsd: Number.parseFloat(totalValueUsd.toFixed(2)),
    };
  } catch (error) {
    return {
      status: "error",
      balances: [],
      totalValueUsd: 0,
      message:
        error instanceof Error ? error.message : "Error reading NEAR Intents ledger",
    };
  }
}
