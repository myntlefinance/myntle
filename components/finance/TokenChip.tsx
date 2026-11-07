"use client";

import { cn } from "@/lib/utils";
import { TokenAvatar } from "./TokenAvatar";

/* The pill is a flex row so the icon and ticker share one optical centre.
 * An inline-block with an align-middle icon stretched the line box below
 * the text, leaving more space under the ticker than above it. */
export function TokenChip({
  symbol,
  badge,
  className,
}: {
  symbol: string;
  badge?: string;
  className?: string;
}) {
  return (
    <span
      data-token-chip=""
      className={cn(
        "inline-flex items-center gap-[0.4em] whitespace-nowrap rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-middle font-medium leading-none text-ink",
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex shrink-0">
        <TokenAvatar symbol={symbol} networkBadge={badge} size={18} />
      </span>
      <span>{symbol}</span>
    </span>
  );
}

export default TokenChip;
