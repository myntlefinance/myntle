import { getAssets } from "./service";

export type IntentsLedgerBalance = {
  assetId: string;
  symbol: string;
  decimals: number;
  balance: string;
  rawBalance: string;
  priceUsd?: number;
  valueUsd?: number;
};

export type IntentsBalancesResult = {
  status: "settled" | "empty" | "unauthenticated" | "error";
  balances: IntentsLedgerBalance[];
  totalValueUsd?: number;
  message?: string;
};

const BASE =
  process.env.NEXT_PUBLIC_ONE_CLICK_BASE_URL ?? "https://1click.chaindefuser.com";

/**
 * Reads the funds currently held inside the NEAR Intents verifier ledger ("in the box").
 * These funds are available for immediate trade execution without an on-chain deposit.
 */
export async function getIntentsLedgerBalances(
  _address?: string,
  authToken?: string,
): Promise<IntentsBalancesResult> {
  if (!authToken) {
    return {
      status: "empty",
      balances: [],
      totalValueUsd: 0,
      message:
        "No settled funds in the NEAR Intents ledger. Connected wallet funds can be deposited for trading.",
    };
  }

  try {
    const res = await fetch(`${BASE}/v0/account/balances`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (res.status === 401) {
      return {
        status: "unauthenticated",
        balances: [],
        totalValueUsd: 0,
        message:
          "Authentication required by NEAR Intents to view internal ledger balances.",
      };
    }

    if (!res.ok) {
      return {
        status: "error",
        balances: [],
        totalValueUsd: 0,
        message: `Failed to fetch settlement balances: HTTP ${res.status}`,
      };
    }

    const json = (await res.json()) as {
      balances?: Array<{
        assetId: string;
        amount: string;
        amountFormatted?: string;
      }>;
    };

    const rawList = json.balances ?? [];
    if (rawList.length === 0) {
      return {
        status: "empty",
        balances: [],
        totalValueUsd: 0,
        message: "Settlement ledger is empty.",
      };
    }

    const catalogue = await getAssets().catch(() => []);
    const balances: IntentsLedgerBalance[] = [];

    for (const item of rawList) {
      const asset = catalogue.find((a) => a.assetId === item.assetId);
      const symbol = asset?.symbol ?? "UNKNOWN";
      const decimals = asset?.decimals ?? 18;
      const priceUsd = asset?.price;
      const formatted = item.amountFormatted ?? item.amount;
      const numFormatted = Number.parseFloat(formatted);
      const valueUsd =
        priceUsd !== undefined && !Number.isNaN(numFormatted)
          ? Number.parseFloat((numFormatted * priceUsd).toFixed(2))
          : undefined;

      balances.push({
        assetId: item.assetId,
        symbol,
        decimals,
        balance: formatted,
        rawBalance: item.amount,
        priceUsd,
        valueUsd,
      });
    }

    const totalValueUsd = balances.reduce(
      (sum, b) => sum + (b.valueUsd ?? 0),
      0,
    );

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
