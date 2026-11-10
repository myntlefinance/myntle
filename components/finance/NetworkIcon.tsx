"use client";

import type { ReactNode } from "react";
import { useId, useMemo } from "react";
import { UPLOADED_NETWORKS } from "./uploadedSvgs";

export type NetworkIconProps = {
  network: string;
  size?: number;
  className?: string;
  title?: string;
};

export const NETWORK_ALIASES: Record<string, string> = {
  arb: "arbitrum",
  "arb-mainnet": "arbitrum",
  arbitrum: "arbitrum",
  base: "base",
  "base-mainnet": "base",
  eth: "ethereum",
  "eth-mainnet": "ethereum",
  ethereum: "ethereum",
  mainnet: "ethereum",
  sol: "solana",
  "solana-mainnet": "solana",
  solana: "solana",
  near: "near",
  "near-mainnet": "near",
  opt: "optimism",
  "opt-mainnet": "optimism",
  optimism: "optimism",
  op: "optimism",
  pol: "polygon",
  polygon: "polygon",
  "polygon-mainnet": "polygon",
  matic: "polygon",
  hl: "hyperliquid",
  hyperliquid: "hyperliquid",
  btc: "bitcoin",
  bitcoin: "bitcoin",
  bnb: "bnb",
  binance: "bnb",
  bsc: "bnb",
  "bnb-mainnet": "bnb",
  avax: "avalanche",
  avalanche: "avalanche",
  "avax-mainnet": "avalanche",
  gnosis: "gnosis",
  "gnosis-mainnet": "gnosis",
  gno: "gnosis",
  linea: "linea",
  "linea-mainnet": "linea",
  scroll: "scroll",
  "scroll-mainnet": "scroll",
  zksync: "zksync",
  "zksync-mainnet": "zksync",
  blast: "blast",
  "blast-mainnet": "blast",
  mantle: "mantle",
  "mantle-mainnet": "mantle",
  celo: "celo",
  "celo-mainnet": "celo",
  unichain: "unichain",
  "unichain-mainnet": "unichain",
  soneium: "soneium",
  "soneium-mainnet": "soneium",
  sui: "sui",
  aptos: "aptos",
  apt: "aptos",
  ton: "ton",
  tron: "tron",
  trx: "tron",
  berachain: "berachain",
  bera: "berachain",
  starknet: "starknet",
  stellar: "stellar",
  xlm: "stellar",
  flow: "flow",
  sei: "sei",
  algorand: "algorand",
  algo: "algorand",
};

/**
 * Namespaces def ids per inline instance so two copies of the same
 * artwork (e.g. SOL token + Solana badge in one row) never share a
 * document-wide `url(#…)` reference. Without this the badge's
 * `userSpaceOnUse` gradient resolves to the token's defs at the wrong
 * scale and the bars render shifted or dull.
 */
export function isolateSvgIds(svg: string, uid: string): string {
  const clean = uid.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!clean) return svg;
  return svg
    .replaceAll(/id="([^"]+)"/g, `id="$1-${clean}"`)
    .replaceAll(/url\(#([^)]+)\)/g, `url(#$1-${clean})`)
    .replaceAll(/href="#([^"]+)"/g, `href="#$1-${clean}"`);
}

/**
 * Resolves a network identifier to its official uploaded SVG vector and styling.
 */
export function resolveUploadedNetwork(network: string): {
  svg: string;
  paddingClass: string;
} | null {
  if (!network) return null;
  const norm = network.trim().toLowerCase();
  const canonical = NETWORK_ALIASES[norm] || norm;

  const svg = UPLOADED_NETWORKS[canonical];
  if (!svg) return null;

  // Dark vectors with transparent backgrounds need a clean white backing circle
  let paddingClass = "";
  if (canonical === "ethereum" || canonical === "stellar") {
    paddingClass = "bg-white p-[2px]";
  }

  return {
    svg,
    paddingClass,
  };
}

/**
 * Direct inline vector SVG for blockchain networks.
 * Uses official uploaded SVGs rendered directly inside an inline <span> for 100% mathematical vector sharpness.
 */
export function NetworkSvg({
  id,
  size = 16,
}: {
  id: string;
  size?: number;
}): ReactNode {
  const resolved = resolveUploadedNetwork(id);
  const uid = useId();
  const svg = useMemo(
    () => (resolved ? isolateSvgIds(resolved.svg, uid) : null),
    [resolved, uid],
  );
  if (!resolved || !svg) return null;

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden [&>svg]:block [&>svg]:w-full [&>svg]:h-full select-none ${resolved.paddingClass}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Direct inline vector Network Icon.
 * Renders pure mathematical vectors directly in the DOM without any <img> rasterization.
 */
export function NetworkIcon({
  network,
  size = 16,
  className = "",
  title,
}: NetworkIconProps) {
  const norm = (network || "").trim().toLowerCase();
  const canonical = NETWORK_ALIASES[norm] || norm;
  const label = title || canonical.charAt(0).toUpperCase() + canonical.slice(1);

  const resolved = resolveUploadedNetwork(canonical);
  const uid = useId();
  const svg = useMemo(
    () => (resolved ? isolateSvgIds(resolved.svg, uid) : null),
    [resolved, uid],
  );

  if (resolved && svg) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden [&>svg]:block [&>svg]:w-full [&>svg]:h-full select-none ${resolved.paddingClass} ${className}`}
        style={{ width: size, height: size }}
        title={label}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  // Fallback monogram
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-field font-semibold text-ink-2 select-none ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.55)),
      }}
      title={label}
    >
      {canonical.charAt(0).toUpperCase()}
    </span>
  );
}

export default NetworkIcon;
