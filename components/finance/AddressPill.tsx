"use client";

import {
  CHAIN_ICONS,
  detectTechData,
  truncateTechData,
  type SupportedChain,
} from "@/components/atoms/TechDataChip";

export type AddressPillProps = {
  address: string;
  /** Chain family from the tool. The address shape wins when they disagree. */
  chain?: SupportedChain;
};

/**
 * The wallet a balance card belongs to, shown above it as a source-style tag.
 * It stays outside the card so the card remains a table and the full address
 * can use the conversation column instead of the card's 392px width.
 */
export function AddressPill({ address, chain }: AddressPillProps) {
  const resolvedChain = detectTechData(address)?.chain ?? chain;
  const icon = resolvedChain ? CHAIN_ICONS[resolvedChain] : undefined;

  return (
    <span
      className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-inset px-2 text-[12px] font-medium text-ink-2 shadow-btn"
      title={address}
    >
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={icon}
          alt=""
          aria-hidden="true"
          className="size-3.5 shrink-0 object-contain"
        />
      ) : null}
      <span className="min-w-0 truncate">
        <span className="sm:hidden">
          {truncateTechData(address, resolvedChain)}
        </span>
        <span className="hidden sm:inline">{address}</span>
      </span>
    </span>
  );
}

export default AddressPill;
