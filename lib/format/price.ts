/** Unit price for a token, or undefined when the catalogue never priced it.
 * Precision follows magnitude so dust stays readable. */
export function formatUsdPrice(priceUsd?: number): string | undefined {
  if (priceUsd === undefined || !Number.isFinite(priceUsd)) return undefined;
  if (priceUsd >= 1000) {
    return `$${Math.round(priceUsd).toLocaleString("en-US")}`;
  }
  if (priceUsd >= 1) return `$${priceUsd.toFixed(2)}`;
  if (priceUsd >= 0.01) return `$${priceUsd.toFixed(4)}`;
  if (priceUsd > 0) return `$${priceUsd.toPrecision(2)}`;
  return "$0.00";
}
