"use client";

import { useMemo, useState, type ReactNode } from "react";
import { NetworkIcon } from "./NetworkIcon";
import {
  BrandIcon,
  BrandMonogram,
  resolveBrandIcon,
  type BrandRef,
} from "./BrandIcon";

export type TokenAvatarProps = {
  symbol: string;
  name?: string;
  /** A logo supplied by the balance source. No third-party icon URL is invented. */
  logo?: string | null;
  assetId?: string | null;
  contractAddress?: string | null;
  chain?: string;
  networkBadge?: string;
  size?: number;
  className?: string;
};

function paddingClass(padding: number, backing: "white" | null): string {
  return `${backing === "white" ? "bg-white" : ""} ${padding === 3.5 ? "p-[3.5px]" : padding === 2 ? "p-[2px]" : ""}`.trim();
}

/** Compatibility helper for callers that need a curated inline token SVG. */
export function resolveUploadedToken(symbol: string): {
  svg: string;
  paddingClass: string;
} | null {
  const resolved = resolveBrandIcon({ kind: "token", symbol });
  if (!resolved?.svg) return null;
  return {
    svg: resolved.svg,
    paddingClass: paddingClass(resolved.padding, resolved.backing),
  };
}

export function TokenSvg({ symbol, size = 28 }: { symbol: string; size?: number }): ReactNode {
  const resolved = resolveBrandIcon({ kind: "token", symbol });
  if (!resolved?.svg) return null;
  return <BrandIcon of={{ kind: "token", symbol }} size={size} fallback={null} />;
}

function RemoteLogo({
  src,
  label,
  size,
  fallback,
}: {
  src: string;
  label: string;
  size: number;
  fallback: ReactNode;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <>{fallback}</>;
  return (
    <span
      className="inline-flex h-full w-full shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- caller-supplied token metadata may use an arbitrary host, with a monogram fallback */}
      <img
        src={src}
        alt={label}
        width={size}
        height={size}
        className="h-full w-full rounded-full object-contain"
        onError={() => setFailedSrc(src)}
        loading="lazy"
      />
    </span>
  );
}

/** A token brand mark with an optional network badge. */
export function TokenAvatar({
  symbol,
  name,
  logo,
  assetId,
  contractAddress,
  chain,
  networkBadge,
  size = 28,
  className = "",
}: TokenAvatarProps) {
  const sym = symbol.toUpperCase();
  const label = name || symbol;
  const badgeSize = Math.max(7, Math.round(size * 0.39));
  // An 11px badge (28px avatar) with ring-2 reads as a halo: 2px is ~18%
  // of the diameter and eats the glyph. Keep ring-1 until the badge is
  // large enough (~14px) to carry the wider ring.
  const badgeRing = badgeSize < 14 ? "ring-1" : "ring-2";
  const iconRef = useMemo<BrandRef>(
    () => ({
      kind: "token",
      assetId,
      chain,
      contract: contractAddress,
      symbol,
    }),
    [assetId, chain, contractAddress, symbol],
  );
  const resolved = useMemo(() => resolveBrandIcon(iconRef), [iconRef]);
  const monogram = <BrandMonogram label={sym || label} size={size} title={label} />;
  const fallback = logo ? (
    <RemoteLogo src={logo} label={label} size={size} fallback={monogram} />
  ) : (
    monogram
  );

  return (
    <span
      /* One bone for the token disc. Without this the badge is measured on
       * its own and the skeleton draws two overlapping circles. */
      {...{ "skullet-block": "" }}
      className={`relative inline-flex shrink-0 select-none rounded-full ${className}`}
      style={{ width: size, height: size }}
      title={label}
    >
      {resolved ? (
        <BrandIcon
          of={iconRef}
          size={size}
          className="h-full w-full"
          title={label}
          fallback={fallback}
        />
      ) : (
        fallback
      )}

      {/* Overlapping network badge at bottom-right corner */}
      {networkBadge ? (
        <span
          className={`absolute -bottom-0.5 -right-0.5 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface ${badgeRing} ring-surface`}
        >
          <NetworkIcon network={networkBadge} size={badgeSize} />
        </span>
      ) : null}
    </span>
  );
}

export default TokenAvatar;
