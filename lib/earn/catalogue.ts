/**
 * The yield vaults the assistant can offer.
 *
 * The list is a constant rather than a catalogue read. 1Click publishes the
 * receipt tokens on `/v0/tokens`, but it publishes neither the protocol nor an
 * APY, and a deposit is only worth offering when the product can name the
 * protocol, the chain, and the asset the user pays with. Every receipt id and
 * its decimals were read from the live `/v0/tokens` response before this file
 * was written; a token that disappears upstream simply stops quoting, and the
 * quote remains the final gate before money moves.
 */

export type EarnVault = {
  id: string;
  name: string;
  protocol: string;
  chain: string;
  /** The token the user receives; the deposit quote's destination asset. */
  receiptAssetId: string;
  receiptSymbol: string;
  receiptDecimals: number;
  /** The token the user pays with; the deposit quote's origin asset. */
  paymentAssetId: string;
  paymentSymbol: string;
  paymentDecimals: number;
  /**
   * The smallest payment amount the live route quoted when this catalogue was
   * observed. It is a display hint, not a guarantee: the quote is the final
   * gate, and the number can change with solver liquidity.
   */
  minimumPaymentFormatted?: string;
  /** DefiLlama pool id. Absent when no pool is known, which yields a null APY. */
  apyPoolId?: string;
  apySourceUrl?: string;
};

const VAULTS: readonly EarnVault[] = [
  {
    id: "gtusdcp",
    name: "USDC Prime",
    protocol: "Morpho",
    chain: "base",
    receiptAssetId:
      "nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near",
    receiptSymbol: "gtUSDCp",
    receiptDecimals: 18,
    paymentAssetId:
      "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    paymentSymbol: "USDC",
    paymentDecimals: 6,
    // Observed 2026-11-13: 10 USDC returned no quote, 20 USDC quoted.
    minimumPaymentFormatted: "20",
    apyPoolId: "e0672197-9f3e-4414-bca5-e6b4c90aa469",
    apySourceUrl:
      "https://defillama.com/yields/pool/e0672197-9f3e-4414-bca5-e6b4c90aa469",
  },
  {
    id: "kv-gtsolb",
    name: "SOL Balanced",
    protocol: "Kamino",
    chain: "sol",
    receiptAssetId:
      "nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near",
    receiptSymbol: "kV-gtSOLb",
    receiptDecimals: 9,
    paymentAssetId: "nep141:sol.omft.near",
    paymentSymbol: "SOL",
    paymentDecimals: 9,
    // Observed 2026-11-13: 0.1 SOL returned no quote, 0.5 SOL quoted.
    minimumPaymentFormatted: "0.5",
    apyPoolId: "9a9cfa6c-8ec9-5d09-857e-aa596901f3ee",
    apySourceUrl:
      "https://defillama.com/yields/pool/9a9cfa6c-8ec9-5d09-857e-aa596901f3ee",
  },
  {
    id: "tlo",
    name: "Taler USDC",
    protocol: "Taler",
    chain: "eth",
    receiptAssetId:
      "nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near",
    receiptSymbol: "TLO",
    receiptDecimals: 8,
    paymentAssetId:
      "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
    paymentSymbol: "USDC",
    paymentDecimals: 6,
    // Observed 2026-11-13: 5 USDC returned no quote, 10 USDC quoted.
    minimumPaymentFormatted: "10",
  },
];

/** A copy, so a caller cannot reorder or annotate the shared constant. */
function copyVault(vault: EarnVault): EarnVault {
  return { ...vault };
}

/** Every vault, in the order the assistant should offer them. */
export function earnVaults(): EarnVault[] {
  return VAULTS.map(copyVault);
}

/** The vault whose receipt token this is, or null when the id is not ours. */
export function findEarnVaultByReceipt(
  receiptAssetId: string,
): EarnVault | null {
  const vault = VAULTS.find((entry) => entry.receiptAssetId === receiptAssetId);
  return vault ? copyVault(vault) : null;
}

/**
 * Every vault the user can fund with this payment asset.
 *
 * The same ticker exists as a different contract on another chain, so the
 * lookup is by full asset id and returns all matches rather than choosing one.
 */
export function findEarnVaultByPayment(paymentAssetId: string): EarnVault[] {
  return VAULTS.filter(
    (vault) => vault.paymentAssetId === paymentAssetId,
  ).map(copyVault);
}
