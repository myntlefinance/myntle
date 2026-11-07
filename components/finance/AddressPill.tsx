"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import {
  CHAIN_ICONS,
  detectTechData,
  truncateTechData,
  type SupportedChain,
} from "@/components/atoms/TechDataChip";

export type AddressPillProps = {
  address: string;
  /** Chain family from the tool. Wins over address-shape detection when set. */
  chain?: SupportedChain;
  /** Connected wallet brand mark, shown when this address is the connected wallet. */
  walletIcon?: string | null;
  /** Connected wallet name, for the tooltip only. */
  walletName?: string | null;
};

/**
 * The wallet a balance card belongs to, shown above it as a source-style tag.
 * It stays outside the card so the card remains a table and the full address
 * can use the conversation column instead of the card's 392px width.
 *
 * The icon names the wallet, not the network: the connected wallet's brand
 * mark when this address is the connected one, otherwise the queried chain's
 * mark. The explicit chain wins over address-shape detection, because a NEAR
 * balance read for an EVM-shaped Intents account is still a NEAR read.
 */
export function AddressPill({ address, chain, walletIcon, walletName }: AddressPillProps) {
  const detectedChain = detectTechData(address)?.chain;
  const resolvedChain = chain ?? detectedChain;
  const chainIcon = resolvedChain ? CHAIN_ICONS[resolvedChain] : undefined;
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => {
    setIconFailed(false);
  }, [walletIcon, address]);
  const providerIcon = walletIcon && !iconFailed ? walletIcon : undefined;
  const icon = providerIcon ?? chainIcon;

  return (
    <span
      className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-inset px-2 text-[12px] font-medium text-ink-2 shadow-btn"
      title={walletName ? `${walletName} · ${address}` : address}
    >
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={icon}
          alt=""
          aria-hidden="true"
          onError={providerIcon ? () => setIconFailed(true) : undefined}
          className="size-3.5 shrink-0 rounded-full object-contain"
        />
      ) : null}
      <span className="min-w-0 truncate">
        <span className="sm:hidden">
          {truncateTechData(address, resolvedChain)}
        </span>
        <span className="hidden sm:inline">{address}</span>
      </span>
      <CopyButton value={address} />
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  /* Same crossfade as the wallet menu: the copy mark blurs and shrinks
   * out while the green check blurs and grows in. */
  const swap =
    "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), filter 240ms cubic-bezier(0.16, 1, 0.3, 1), transform 240ms cubic-bezier(0.16, 1, 0.3, 1)";
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy address"}
      title={copied ? "Copied" : "Copy address"}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard unavailable; the address stays visible to copy by hand.
          }
        })();
      }}
      className="relative ml-1 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
    >
      <span
        aria-hidden={copied}
        className="absolute inset-0 flex items-center justify-center"
        style={{
          opacity: copied ? 0 : 1,
          filter: copied ? "blur(2.5px)" : "blur(0px)",
          transform: copied ? "scale(0.85)" : "scale(1)",
          pointerEvents: copied ? "none" : "auto",
          transition: swap,
          willChange: "transform, opacity, filter",
        }}
      >
        <IconCopy size={13} stroke={1.8} strokeWidth={1.8} />
      </span>
      <span
        aria-hidden={!copied}
        className="absolute inset-0 flex items-center justify-center text-green"
        style={{
          opacity: copied ? 1 : 0,
          filter: copied ? "blur(0px)" : "blur(2.5px)",
          transform: copied ? "scale(1)" : "scale(0.85)",
          pointerEvents: copied ? "auto" : "none",
          transition: swap,
          willChange: "transform, opacity, filter",
        }}
      >
        <IconCheck size={13} stroke={2.6} strokeWidth={2.6} />
      </span>
    </button>
  );
}

export default AddressPill;
