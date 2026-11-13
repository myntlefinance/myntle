import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";

export const GET_LIMIT_ORDERS_CAPABILITY: Capability = {
  tool: "get_limit_orders",
  tier: "read-private",
  subject: "session",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_limit_orders"],
};

const LIST_LIMIT = 10;

/** The account that owns the record, never an address from the model. */
async function resolveUserId(context?: ToolContext): Promise<string | null> {
  if (context?.userId) return context.userId;
  const chain = context?.activeChain;
  const address = context?.activeAddress;
  if (
    (chain === "evm" || chain === "solana" || chain === "near") &&
    address
  ) {
    const { findUserIdByWallet } = await import("@/lib/db/wallets");
    return findUserIdByWallet(chain, address);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The output side of a stored swap view, in the asset and raw units. */
function swapOutput(
  swapView: unknown,
  side: string | null,
  baseAsset: string | null,
  quoteAsset: string | null,
): { assetId: string | null; raw: string | null } {
  const swap = asRecord(swapView);
  if (!swap || !side) return { assetId: null, raw: null };
  if (side === "SELL") {
    return {
      assetId: quoteAsset,
      raw: swap.swapType === "EXACT_INPUT" ? text(swap.minAmountOut) : null,
    };
  }
  return {
    assetId: baseAsset,
    raw: swap.swapType === "EXACT_OUTPUT" ? text(swap.amountOut) : null,
  };
}

export function createGetLimitOrdersTool(context?: ToolContext) {
  return tool({
    description:
      "List this account's limit orders, newest first. Returns the side, the pair, the " +
      "quantity, the limit price, the output at that price, and whether the order is " +
      "waiting, resting, partially filled, settled, cancelled, or refunded. It reads the " +
      "stored record only, so a status it returns is the last one the application wrote.",
    inputSchema: z.object({}),
    execute: async () => {
      const userId = await resolveUserId(context);
      if (!userId) {
        return {
          orders: [],
          note: "No signed-in account is attached to this conversation, so there is no order record to read.",
        };
      }

      const { listLimitOrderTransactions } = await import(
        "@/lib/db/transactions"
      );
      let rows: Awaited<ReturnType<typeof listLimitOrderTransactions>>;
      try {
        rows = await listLimitOrderTransactions(userId, LIST_LIMIT);
      } catch {
        return {
          orders: [],
          note: "The limit order record could not be read just now.",
        };
      }

      if (rows.length === 0) {
        return { orders: [], note: "This account has no limit orders yet." };
      }

      // One catalogue read for the whole list. The symbol and the decimals
      // are display facts; a missing catalogue keeps the raw figures rather
      // than failing a record the user already owns.
      const [{ getAssets }, { formatUnits }] = await Promise.all([
        import("@/lib/intents/service"),
        import("@/lib/intents/balances"),
      ]);
      const assets = await getAssets().catch(
        (): Awaited<ReturnType<typeof getAssets>> => [],
      );
      const byId = new Map(assets.map((asset) => [asset.assetId, asset]));

      const orders = rows.map((row) => {
        const refs = row.refs ?? {};
        const outcome = row.outcome ?? {};
        const side = text(refs.side);
        const baseAsset = text(refs.baseAsset);
        const quoteAsset = text(refs.quoteAsset);
        const quantityRaw = text(refs.quantity);
        const price = text(refs.price);
        const base = baseAsset ? byId.get(baseAsset) : undefined;
        const quote = quoteAsset ? byId.get(quoteAsset) : undefined;
        const output = swapOutput(refs.swapView, side, baseAsset, quoteAsset);
        const outputAsset = output.assetId ? byId.get(output.assetId) : undefined;
        // The filled figure is a base quantity: a SELL reports it as the
        // filled input and a BUY as the filled output.
        const filledRaw =
          side === "SELL"
            ? text(outcome.filledAmountIn)
            : side === "BUY"
              ? text(outcome.filledAmountOut)
              : null;

        return {
          id: row.id,
          state: row.state,
          side,
          baseSymbol: base?.symbol ?? null,
          quoteSymbol: quote?.symbol ?? null,
          quantity:
            quantityRaw && base
              ? formatUnits(quantityRaw, base.decimals)
              : quantityRaw,
          price,
          output:
            output.raw && outputAsset
              ? formatUnits(output.raw, outputAsset.decimals)
              : output.raw,
          orderId: text(refs.orderId),
          fillStatus: text(refs.fillStatus),
          payoutStatus: text(refs.payoutStatus),
          filled:
            filledRaw && base
              ? formatUnits(filledRaw, base.decimals)
              : filledRaw,
          deadline: text(refs.orderDeadline) ?? text(refs.deadline),
          createdAt: row.created_at,
        };
      });

      return { orders };
    },
  });
}

export const getLimitOrders = createGetLimitOrdersTool();
