import { NextResponse } from "next/server";
import {
  getConnectedWalletBalances,
  type SupportedNetwork,
} from "@/lib/wallet/balances";
import { getIntentsLedgerBalances } from "@/lib/intents/balances";
import { requireSession } from "@/lib/auth/session";

type BalancesBody = {
  wallet: Awaited<ReturnType<typeof getConnectedWalletBalances>>;
  intentsLedger: Awaited<ReturnType<typeof getIntentsLedgerBalances>>;
};

const balancesCache = new Map<string, { at: number; body: BalancesBody }>();

export function __clearBalancesCacheForTests() {
  balancesCache.clear();
}

export async function GET(req: Request) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  const address = searchParams.get("address") || session?.address;
  const chain = searchParams.get("chain") || session?.chain;

  if (!address || !chain) {
    return NextResponse.json(
      { error: "Missing address or chain parameters" },
      { status: 400 },
    );
  }

  const rawNetworks = searchParams.get("networks");
  const rawMode = searchParams.get("mode");
  const mode = rawMode === "fast" ? "fast" : "full";
  const networks = rawNetworks
    ? (rawNetworks.split(",").map((n) => n.trim()) as SupportedNetwork[])
    : mode === "fast"
      ? (["ethereum", "base", "arbitrum", "optimism", "polygon"] as SupportedNetwork[])
      : undefined;
  const symbol = searchParams.get("symbol") || undefined;
  const maxPages = mode === "fast" ? 1 : 20;
  const refresh = searchParams.get("refresh") === "1";

  const cacheKey = `${chain}|${address.toLowerCase()}|${rawNetworks ?? "all"}|${symbol ?? ""}|${mode}`;
  if (!refresh) {
    const cached = balancesCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 60_000) {
      return NextResponse.json(cached.body);
    }
  }

  const [wallet, intentsLedger] = await Promise.all([
    getConnectedWalletBalances(chain, address, { networks, symbol, maxPages }),
    getIntentsLedgerBalances(address, chain),
  ]);

  const body: BalancesBody = { wallet, intentsLedger };
  balancesCache.set(cacheKey, { at: Date.now(), body });
  if (balancesCache.size > 200) {
    const oldest = balancesCache.keys().next().value;
    if (oldest !== undefined) balancesCache.delete(oldest);
  }

  return NextResponse.json(body);
}
