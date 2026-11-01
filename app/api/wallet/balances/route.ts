import { NextResponse } from "next/server";
import {
  getConnectedWalletBalances,
  type SupportedNetwork,
} from "@/lib/wallet/balances";
import { getIntentsLedgerBalances } from "@/lib/intents/balances";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cookieId = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const session = cookieId
    ? await getSession(decodeURIComponent(cookieId))
    : null;

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
    getIntentsLedgerBalances(address),
  ]);

  return NextResponse.json({
    wallet,
    intentsLedger,
  });
}
