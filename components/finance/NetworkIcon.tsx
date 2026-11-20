"use client";

import type { ReactNode } from "react";
import { NETWORK_BY_ALIAS } from "./brandIcons.generated";
import { BrandIcon, canonicalNetworkName, resolveBrandIcon } from "./BrandIcon";

export type NetworkIconProps = {
  network: string;
  size?: number;
  className?: string;
  title?: string;
};

/* Kept as a public alias for network filtering and other canonicalizers. */
export const NETWORK_ALIASES: Record<string, string> = NETWORK_BY_ALIAS;
export { isolateSvgIds } from "./BrandIcon";

function paddingClass(padding: number, backing: "white" | null): string {
  return `${backing === "white" ? "bg-white" : ""} ${padding === 3.5 ? "p-[3.5px]" : padding === 2 ? "p-[2px]" : ""}`.trim();
}

/** Compatibility helper for callers that need the curated inline SVG itself. */
export function resolveUploadedNetwork(network: string): {
  svg: string;
  paddingClass: string;
} | null {
  const resolved = resolveBrandIcon({ kind: "network", chain: network });
  if (!resolved?.svg) return null;
  return {
    svg: resolved.svg,
    paddingClass: paddingClass(resolved.padding, resolved.backing),
  };
}

export function NetworkSvg({ id, size = 16 }: { id: string; size?: number }): ReactNode {
  return (
    <BrandIcon
      of={{ kind: "network", chain: id }}
      size={size}
      fallback={null}
    />
  );
}

/** A network brand mark resolved by the shared local registry. */
export function NetworkIcon({
  network,
  size = 16,
  className = "",
  title,
}: NetworkIconProps) {
  const canonical = canonicalNetworkName(network);
  return (
    <BrandIcon
      of={{ kind: "network", chain: canonical }}
      size={size}
      className={className}
      title={title ?? (canonical ? canonical.charAt(0).toUpperCase() + canonical.slice(1) : "Network")}
    />
  );
}

export default NetworkIcon;
