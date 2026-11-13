import { NextResponse } from "next/server";
import { readEarnApys } from "@/lib/earn/apy";
import { earnVaults } from "@/lib/earn/catalogue";

/**
 * The public yield catalogue.
 *
 * 1Click publishes the receipt tokens but neither the protocol nor an APY;
 * the catalogue supplies the first two and DefiLlama supplies the third when
 * it has a matching pool. The route is read-only and cached for ten minutes,
 * so opening the portfolio does not hammer either source.
 */
export const revalidate = 600;

export async function GET() {
  const vaults = earnVaults();
  const apys = await readEarnApys(vaults);
  return NextResponse.json({
    vaults: vaults.map((vault) => ({
      id: vault.id,
      name: vault.name,
      protocol: vault.protocol,
      chain: vault.chain,
      receiptSymbol: vault.receiptSymbol,
      paymentSymbol: vault.paymentSymbol,
      apy: apys.get(vault.id) ?? null,
    })),
    note: "APY is variable and is set by the protocol, not by Myntle. The APY is read from DefiLlama and may be stale.",
  });
}
