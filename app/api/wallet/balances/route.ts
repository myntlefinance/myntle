import { NextResponse } from "next/server";
import {
  getConnectedWalletBalances,
  type SupportedNetwork,
} from "@/lib/wallet/balances";
import { getIntentsLedgerBalances } from "@/lib/intents/balances";
import { requireSession } from "@/lib/auth/session";

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
  const networks = rawNetworks
    ? (rawNetworks.split(",").map((n) => n.trim()) as SupportedNetwork[])
    : undefined;
  const symbol = searchParams.get("symbol") || undefined;

  const [wallet, intentsLedger] = await Promise.all([
    getConnectedWalletBalances(chain, address, { networks, symbol }),
    getIntentsLedgerBalances(address, chain),
  ]);

  return NextResponse.json({
    wallet,
    intentsLedger,
  });
}
