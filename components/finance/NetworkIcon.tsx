"use client";

import type { ReactNode } from "react";
import { UPLOADED_NETWORKS } from "./uploadedSvgs";

export type NetworkIconProps = {
  network: string;
  size?: number;
  className?: string;
  title?: string;
};

const NETWORK_ALIASES: Record<string, string> = {
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
  avax: "avalanche",
  avalanche: "avalanche",
  "avax-mainnet": "avalanche",
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
  if (!resolved) return null;

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden [&>svg]:w-full [&>svg]:h-full select-none ${resolved.paddingClass}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: resolved.svg }}
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

  if (resolved) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden [&>svg]:w-full [&>svg]:h-full select-none ${resolved.paddingClass} ${className}`}
        style={{ width: size, height: size }}
        title={label}
        dangerouslySetInnerHTML={{ __html: resolved.svg }}
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
