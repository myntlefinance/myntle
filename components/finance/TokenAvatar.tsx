"use client";

import type { ReactNode } from "react";
import { useState, useMemo } from "react";
import { NetworkIcon } from "./NetworkIcon";
import { UPLOADED_TOKENS } from "./uploadedSvgs";

export type TokenAvatarProps = {
  symbol: string;
  name?: string;
  logo?: string | null;
  contractAddress?: string | null;
  chain?: string;
  networkBadge?: string;
  size?: number;
  className?: string;
};

/**
 * Resolves a token symbol to its official uploaded SVG vector and appropriate styling.
 */
export function resolveUploadedToken(symbol: string): {
  svg: string;
  paddingClass: string;
} | null {
  if (!symbol) return null;
  const s = symbol.trim().toLowerCase();

  let key: string | null = null;
  if (UPLOADED_TOKENS[s]) {
    key = s;
  } else if (
    s === "weth" ||
    s === "vweth" ||
    s === "steth" ||
    s.startsWith("eth-") ||
    s.endsWith("-eth")
  ) {
    key = "eth";
  } else if (
    s === "btc" ||
    s === "tbtc" ||
    s === "cbtc" ||
    s.startsWith("btc-") ||
    s.endsWith("-btc")
  ) {
    key = "wbtc";
  } else if (s.includes("usdc")) {
    key = "usdc";
  } else if (s.includes("usdt")) {
    key = "usdt";
  } else if (s === "wnear" || s.startsWith("near-")) {
    key = "near";
  } else if (s === "wsol" || s.startsWith("sol-") || s.endsWith("-sol")) {
    key = "sol";
  } else if (s === "arbitrum") {
    key = "arb";
  } else if (s === "optimism") {
    key = "op";
  } else if (s === "hyperliquid") {
    key = "hype";
  }

  if (!key || !UPLOADED_TOKENS[key]) return null;

  // Ethereum has a dark charcoal diamond on a transparent background with tight vertical bounds.
  // We place it on a clean white circular disc with 3.5px padding so it is 100% visible, centered,
  // and the points never touch or clip the circular boundary.
  // WBTC has black outer rings on a transparent background, so it also uses a white backing disc.
  let paddingClass = "";
  if (key === "eth") {
    paddingClass = "bg-white p-[3.5px]";
  } else if (key === "wbtc") {
    paddingClass = "bg-white p-[2px]";
  }

  return {
    svg: UPLOADED_TOKENS[key],
    paddingClass,
  };
}

/**
 * Direct inline vector SVG for curated tokens.
 * Renders pure mathematical vectors directly in the DOM, eliminating
 * rasterization blur, anti-aliasing bleeding, and cropped edges.
 */
export function TokenSvg({
  symbol,
  size = 28,
}: {
  symbol: string;
  size?: number;
}): ReactNode {
  const resolved = resolveUploadedToken(symbol);
  if (!resolved) return null;

  return (
    <div
      className={`w-full h-full inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden [&>svg]:w-full [&>svg]:h-full select-none ${resolved.paddingClass}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: resolved.svg }}
    />
  );
}

/**
 * Direct inline vector Token Avatar.
 * Renders official uploaded vector SVGs directly into the DOM for 100% sharpness.
 * Never uses <img> rasterization for uploaded / curated tokens.
 */
export function TokenAvatar({
  symbol,
  name,
  logo,
  contractAddress,
  chain,
  networkBadge,
  size = 28,
  className = "",
}: TokenAvatarProps) {
  const [remoteFailed, setRemoteFailed] = useState(false);
  const sym = symbol.toUpperCase();
  const label = name || symbol;
  const badgeSize = Math.max(7, Math.round(size * 0.39));
  // The ring separating badge from token thins out with small badges so the
  // stroke never eats the glyph; large avatars keep the wider ring.
  const badgeRing = badgeSize < 10 ? "ring-1" : "ring-2";
  const monogram = sym.length <= 4 ? sym.slice(0, 3) : sym.slice(0, 2);

  // 1. Direct inline SVG lookup for curated / uploaded tokens (instant, zero rasterization)
  const uploaded = resolveUploadedToken(symbol);

  // 2. Candidate remote URL fallback for unlisted / dynamic tokens
  const remoteUrl = useMemo(() => {
    if (uploaded) return null;
    if (logo) return logo;
    if (contractAddress && chain) {
      return `https://icons.llamao.fi/token/${chain}:${contractAddress}`;
    }
    return null;
  }, [uploaded, logo, contractAddress, chain]);

  return (
    <div
      className={`relative inline-flex shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
      title={label}
    >
      {uploaded ? (
        <div
          className={`w-full h-full inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden [&>svg]:w-full [&>svg]:h-full select-none ${uploaded.paddingClass}`}
          style={{ width: size, height: size }}
          dangerouslySetInnerHTML={{ __html: uploaded.svg }}
        />
      ) : remoteUrl && !remoteFailed ? (
        <div
          className="w-full h-full inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden bg-white/5"
          style={{ width: size, height: size }}
        >
          <img
            src={remoteUrl}
            alt={label}
            width={size}
            height={size}
            className="w-full h-full object-contain rounded-full"
            onError={() => setRemoteFailed(true)}
            loading="lazy"
          />
        </div>
      ) : (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-field font-semibold text-ink-2"
          style={{
            width: size,
            height: size,
            fontSize: Math.max(9, Math.round(size * 0.44)),
          }}
        >
          {monogram}
        </span>
      )}

      {/* Overlapping network badge at bottom-right corner */}
      {networkBadge && (
        <div
          className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full ${badgeRing} ring-surface`}
        >
          <NetworkIcon network={networkBadge} size={badgeSize} />
        </div>
      )}
    </div>
  );
}

export default TokenAvatar;
