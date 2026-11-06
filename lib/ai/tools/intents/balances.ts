import { tool } from "ai";
import { z } from "zod";
import { getAssets } from "@/lib/intents/service";
import { formatUnits } from "@/lib/intents/balances";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";

const ONE_CLICK =
  process.env.NEXT_PUBLIC_ONE_CLICK_BASE_URL ??
  "https://1click.chaindefuser.com";

export const GET_SUPER_BALANCES_CAPABILITY: Capability = {
  tool: "get_super_balances",
  tier: "read-private",
  subject: "session",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_super_balances"],
};

type AccountBalance = {
  tokenId?: string;
  available?: string;
  source?: string;
};

export type SuperBalance = {
  tokenId: string;
  symbol: string;
  decimals: number;
  amount: string;
  rawAmount: string;
  source?: string;
  priceUsd?: number;
  valueUsd?: number;
};

export type SuperBalancesResult = {
  status: "read" | "empty" | "locked" | "error";
  balances: SuperBalance[];
  totalValueUsd: number;
  /** Signals the interface to render the unlock card. */
  needsSuperUnlock?: boolean;
  message?: string;
};

function locked(accountKind: "wallet" | "passkey"): SuperBalancesResult {
  return {
    status: "locked",
    balances: [],
    totalValueUsd: 0,
    needsSuperUnlock: true,
    message:
      accountKind === "passkey"
        ? "The private balance is locked. Unlock it to read the balance."
        : "The super account is locked. Unlock it to read the private balance.",
  };
}

function failed(): SuperBalancesResult {
  return {
    status: "error",
    balances: [],
    totalValueUsd: 0,
    message: "The private balance could not be read.",
  };
}

/**
 * Reads the confidential ledger through the user's own session.
 *
 * The access token arrives in a request header, is used for this call, and
 * dies with the request. The tool takes no address: the token identifies the
 * account, so the model cannot point it at anyone else.
 */
export function createSuperBalancesTool(context?: ToolContext) {
  const accountKind = context?.accountKind ?? "wallet";

  return tool({
    description:
      accountKind === "passkey"
        ? "Read the private balance inside the user's account. " +
          "Use this whenever the user asks about their private balance or what they can spend " +
          "from the account. This is the confidential ledger; get_wallet_balances only reads the " +
          "account's public settlement ledger."
        : "Read the private balance inside the user's super account. " +
          "Use this whenever the user asks about their private balance, their super account holdings, " +
          "or what they can spend from super. This is the confidential ledger; get_wallet_balances " +
          "only sees public on-chain balances and the public settlement ledger.",
    inputSchema: z.object({}),
    execute: async (): Promise<SuperBalancesResult> => {
      const token = context?.intentsAccessToken;
      if (!token) return locked(accountKind);

      let res: Response;
      try {
        res = await fetch(`${ONE_CLICK}/v0/account/balances`, {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
      } catch {
        return failed();
      }

      if (res.status === 401) return locked(accountKind);
      if (!res.ok) return failed();

      const data = (await res.json().catch(() => null)) as {
        balances?: AccountBalance[];
      } | null;
      const entries = Array.isArray(data?.balances) ? data.balances : [];
      const catalogue = await getAssets().catch(() => []);
      const byId = new Map(catalogue.map((asset) => [asset.assetId, asset]));

      const balances: SuperBalance[] = [];
      for (const entry of entries) {
        const tokenId = typeof entry.tokenId === "string" ? entry.tokenId : "";
        const available =
          typeof entry.available === "string" ? entry.available : "";
        if (!tokenId || !available) continue;

        let raw: bigint;
        try {
          raw = BigInt(available);
        } catch {
          continue;
        }
        if (raw <= 0n) continue;

        const asset = byId.get(tokenId);
        const decimals = asset?.decimals ?? 18;
        const amount = formatUnits(available, decimals);
        const numeric = Number.parseFloat(amount);
        const valueUsd =
          asset?.price !== undefined && !Number.isNaN(numeric)
            ? Number.parseFloat((numeric * asset.price).toFixed(2))
            : undefined;

        balances.push({
          tokenId,
          symbol: asset?.symbol ?? "UNKNOWN",
          decimals,
          amount,
          rawAmount: available,
          source: typeof entry.source === "string" ? entry.source : undefined,
          priceUsd: asset?.price,
          valueUsd,
        });
      }

      if (balances.length === 0) {
        return {
          status: "empty",
          balances: [],
          totalValueUsd: 0,
          message:
            accountKind === "passkey"
              ? "The private balance is empty."
              : "The super account is empty.",
        };
      }

      balances.sort(
        (a, b) =>
          (b.valueUsd ?? 0) - (a.valueUsd ?? 0) ||
          a.symbol.localeCompare(b.symbol),
      );

      const totalValueUsd = balances.reduce(
        (sum, balance) => sum + (balance.valueUsd ?? 0),
        0,
      );

      return {
        status: "read",
        balances,
        totalValueUsd: Number.parseFloat(totalValueUsd.toFixed(2)),
      };
    },
  });
}
