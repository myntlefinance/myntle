import { tool } from "ai";
import { z } from "zod";
import { readEarnApys } from "@/lib/earn/apy";
import { earnVaults } from "@/lib/earn/catalogue";
import type { Capability } from "../capability";

export const GET_EARN_OPTIONS_CAPABILITY: Capability = {
  tool: "get_earn_options",
  tier: "read-public",
  subject: "none",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_earn_options"],
};

/**
 * The one disclaimer every Earn answer carries.
 *
 * It names where the rate comes from and says that it moves. It promises
 * nothing about principal and nothing about a return, because the protocol
 * owns both and neither is ours to guarantee.
 */
const EARN_NOTE =
  "APY is variable and is set by the protocol, not by Myntle. The APY is read from DefiLlama and may be stale. Some vaults have a minimum deposit; it is a display hint and the quote is the final gate.";

/** The explanation attached to a vault with no published rate. */
const NO_APY_NOTE = "DefiLlama lists no APY for this vault.";

export function createEarnOptionsTool() {
  return tool({
    description:
      "List the yield vaults the user can deposit into. Each result names the vault, " +
      "the protocol, the chain, the receipt token, the payment token, and the current " +
      "APY when the aggregator reports one. Use this before quoting an earn deposit; " +
      "never guess a vault or an APY.",
    inputSchema: z.object({
      asset: z
        .string()
        .optional()
        .describe(
          "Optional payment asset id or symbol, such as USDC or SOL. Leave empty " +
            "for every vault.",
        ),
    }),
    execute: async ({ asset }) => {
      const all = earnVaults();
      const wanted = asset?.trim() || null;

      // An unmatched filter returns the whole catalogue rather than an empty
      // list. A wrong guess at a ticker should narrow nothing, not hide every
      // vault the user could actually use.
      const matched = wanted
        ? all.filter(
            (vault) =>
              vault.paymentAssetId === wanted ||
              vault.paymentSymbol.toLowerCase() === wanted.toLowerCase(),
          )
        : all;
      const listed = matched.length > 0 ? matched : all;

      // One aggregator read covers the whole list, and a vault whose pool is
      // unknown comes back null without a request of its own.
      const apys = await readEarnApys(listed);

      return {
        vaults: listed.map((vault) => {
          const apy = apys.get(vault.id) ?? null;
          return {
            id: vault.id,
            name: vault.name,
            protocol: vault.protocol,
            chain: vault.chain,
            receiptSymbol: vault.receiptSymbol,
            receiptAssetId: vault.receiptAssetId,
            paymentSymbol: vault.paymentSymbol,
            paymentAssetId: vault.paymentAssetId,
            minimumPaymentFormatted: vault.minimumPaymentFormatted ?? null,
            apy,
            // Null is a statement about the source, not a zero: the model
            // must say the rate is unavailable rather than fill the gap.
            apySource: apy === null ? null : ("DefiLlama" as const),
            // The top-level note already says a published rate is variable,
            // so a note here appears only when there is something extra to
            // explain.
            note: apy === null ? NO_APY_NOTE : "",
          };
        }),
        note: EARN_NOTE,
      };
    },
  });
}

export const getEarnOptions = createEarnOptionsTool();
