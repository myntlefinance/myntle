"use client";

import type { ReactNode } from "react";
import { useId, useMemo } from "react";
import { NETWORK_FILES } from "./iconFiles";
import { UPLOADED_NETWORKS } from "./uploadedSvgs";

export type NetworkIconProps = {
  network: string;
  size?: number;
  className?: string;
  title?: string;
};

export const NETWORK_ALIASES: Record<string, string> = {
  /* Ethereum and the EVM chains 1Click names with short slugs. */
  arb: "arbitrum",
  "arb-mainnet": "arbitrum",
  "arbitrum-one": "arbitrum",
  arbitrum: "arbitrum",
  "arb-nova": "arbitrumnova",
  "arbitrum-nova": "arbitrumnova",
  base: "base",
  "base-mainnet": "base",
  eth: "ethereum",
  "eth-mainnet": "ethereum",
  "ethereum-mainnet": "ethereum",
  ethereum: "ethereum",
  mainnet: "ethereum",
  opt: "optimism",
  "opt-mainnet": "optimism",
  "optimism-mainnet": "optimism",
  optimism: "optimism",
  op: "optimism",
  pol: "polygon",
  "pol-mainnet": "polygon",
  polygon: "polygon",
  "polygon-mainnet": "polygon",
  "polygon-pos": "polygon",
  matic: "polygon",
  "matic-mainnet": "polygon",
  bsc: "bnb",
  bnb: "bnb",
  binance: "bnb",
  "binance-smart-chain": "bnb",
  "bnb-mainnet": "bnb",
  avax: "avalanche",
  avalanche: "avalanche",
  "avax-mainnet": "avalanche",
  "avalanche-mainnet": "avalanche",
  gnosis: "gnosis",
  "gnosis-mainnet": "gnosis",
  gno: "gnosis",
  xdai: "gnosis",
  linea: "linea",
  "linea-mainnet": "linea",
  scroll: "scroll",
  "scroll-mainnet": "scroll",
  zksync: "zksync",
  "zksync-mainnet": "zksync",
  "zksync-era": "zksync",
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

  /* The long tail of EVM chains, by the other names each goes by. */
  abs: "abstract",
  "abstract-chain": "abstract",
  aca: "acala",
  adi: "adichain",
  "adi-chain": "adichain",
  ape: "apechain",
  astr: "astar",
  cfx: "conflux",
  frax: "fraxtal",
  /* HyperCore is the Hyperliquid L1; HyperEVM is its separate EVM. */
  hypercore: "hyperliquid",
  "hyperliquid-l1": "hyperliquid",
  "hyper-evm": "hyperevm",
  hl: "hyperliquid",
  hyperliquid: "hyperliquid",
  hood: "robinhood",
  imx: "immutable",
  "immutable-zkevm": "immutable",
  inkonchain: "ink",
  kar: "karura",
  kardiachain: "kardia",
  klaytn: "kaia",
  klay: "kaia",
  manta: "mantapacific",
  "manta-pacific": "mantapacific",
  neon: "neonevm",
  "neon-evm": "neonevm",
  pls: "pulsechain",
  shimmer: "shimmerevm",
  "shimmer-evm": "shimmerevm",
  "taiko-alethia": "taiko",
  tlos: "telos",
  tomo: "viction",
  worldchain: "world",
  "world-chain": "world",
  "x-layer": "xlayer",
  "zero-network": "zeronetwork",

  /* Non-EVM chains, and the identifiers the catalogue and users use. */
  sol: "solana",
  "solana-mainnet": "solana",
  solana: "solana",
  near: "near",
  "near-mainnet": "near",
  // Intents assets settle on NEAR, so they carry the NEAR mark in the UI.
  intents: "near",
  apt: "aptos",
  aptos: "aptos",
  "aptos-mainnet": "aptos",
  sui: "sui",
  "sui-mainnet": "sui",
  ton: "ton",
  "ton-mainnet": "ton",
  tron: "tron",
  trx: "tron",
  "tron-mainnet": "tron",
  btc: "bitcoin",
  bitcoin: "bitcoin",
  "bitcoin-mainnet": "bitcoin",
  bch: "bch",
  "bitcoin-cash": "bch",
  dash: "dash",
  doge: "doge",
  dogecoin: "doge",
  cardano: "cardano",
  ada: "cardano",
  ltc: "litecoin",
  litecoin: "litecoin",
  xrp: "xrp",
  "xrp-ledger": "xrp",
  prl: "pearl",
  qtc: "quantus",
  quantus: "quantus",
  zec: "zcash",
  zcash: "zcash",
  stellar: "stellar",
  "stellar-mainnet": "stellar",
  xlm: "stellar",
  flow: "flow",
  sei: "sei",
  "sei-mainnet": "sei",
  algorand: "algorand",
  algo: "algorand",
  starknet: "starknet",
  strk: "starknet",
  bera: "berachain",
  berachain: "berachain",
  osmosis: "osmosis",
  osmo: "osmosis",
  injective: "injective",
  inj: "injective",
  tao: "tao",
  bittensor: "tao",
  tia: "tia",
  celestia: "tia",
  stacks: "stacks",
  stx: "stacks",
  tezos: "xtz",
  oasis: "rose",
  icp: "icp",
  "internet-computer": "icp",
  xinfin: "xdc",
  proton: "xpr",
  terra: "luna",
  "terra-classic": "terraclassic",
  lunc: "terraclassic",
  iota: "iotaevm",
  "iota-evm": "iotaevm",
};

const NETWORK_FILE_SET = new Set<string>(NETWORK_FILES);

/* Dark vectors on a transparent field need a clean white backing disc. */
function networkPaddingClass(canonical: string): string {
  return canonical === "ethereum" || canonical === "stellar"
    ? "bg-white p-[2px]"
    : "";
}

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

  return {
    svg,
    paddingClass: networkPaddingClass(canonical),
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
  const resolvedSvg = resolved?.svg;
  const svg = resolvedSvg ? isolateSvgIds(resolvedSvg, uid) : null;

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

  /* The curated marks above are inlined so the first screen paints without
   * a request. The long tail is served from public/networks as a static
   * vector, which keeps the client bundle from carrying every chain. */
  if (NETWORK_FILE_SET.has(canonical)) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden select-none ${networkPaddingClass(canonical)} ${className}`}
        style={{ width: size, height: size }}
        title={label}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- long-tail static SVG from public/networks; next/image skips SVG optimization */}
        <img
          src={`/networks/${canonical}.svg`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          draggable={false}
          className="block h-full w-full object-contain"
        />
      </span>
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
