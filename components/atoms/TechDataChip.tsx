"use client";

import { useState, useEffect, useCallback, type MouseEvent } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export type SupportedChain = "evm" | "solana" | "near";

export type TechDataKind = "address" | "txHash" | "contract" | "custom";

export type TechData = {
  kind: TechDataKind;
  chain?: SupportedChain;
  raw: string;
  display: string;
  icon?: string;
  label?: string;
};

export const CHAIN_ICONS: Record<SupportedChain, string> = {
  evm: "/wallets/evm.webp",
  solana: "/wallets/solana.webp",
  near: "/wallets/near.webp",
};

/**
 * Standard design tokens for TechDataChip aligned to standard Tailwind scale.
 */
export const CHIP_LAYOUT_TOKENS = {
  paddingY: "py-1",
  paddingX: "px-1.5",
  gap: "gap-1.5",
  iconSize: "size-3.5",
  copyGlyphSize: 12,
} as const;

/**
 * Truncates an address or hash cleanly while preserving the prefix and suffix.
 */
export function truncateTechData(
  value: string,
  chain?: SupportedChain,
  kind: TechDataKind = "address",
): string {
  if (chain === "near" && !value.startsWith("0x") && value.includes(".")) {
    // Named NEAR accounts (e.g. alice.near) don't need truncation unless very long
    if (value.length <= 18) return value;
    const parts = value.split(".");
    const suffix = parts.slice(1).join(".");
    return `${parts[0].slice(0, 6)}…${suffix}`;
  }

  if (value.startsWith("0x")) {
    if (kind === "txHash" && value.length >= 66) {
      return `${value.slice(0, 8)}…${value.slice(-6)}`;
    }
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }

  if (value.length > 12) {
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  }

  return value;
}

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const EVM_TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const NEAR_NAMED_REGEX = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.(near|testnet)$/i;
const NEAR_IMPLICIT_REGEX = /^[0-9a-fA-F]{64}$/;
const SOLANA_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Detects whether a string is a blockchain address, tx hash, or technical token.
 * Highly robust: validates structural length and character sets, and checks
 * against connected wallet context to prevent false flags.
 */
export function detectTechData(
  rawText: string,
  activeWallet?: { address?: string; kind?: string } | null,
): TechData | null {
  const text = rawText.trim();
  if (!text || text.length < 3) return null;

  // 1. Check against active connected wallet (100% reliable identification)
  if (
    activeWallet?.address &&
    text.toLowerCase() === activeWallet.address.toLowerCase()
  ) {
    const chain = (activeWallet.kind as SupportedChain) || "evm";
    return {
      kind: "address",
      chain,
      raw: text,
      display: text,
      icon: CHAIN_ICONS[chain],
      label: "Connected wallet",
    };
  }

  // 2. EVM Address (0x + 40 hex chars)
  if (EVM_ADDRESS_REGEX.test(text)) {
    return {
      kind: "address",
      chain: "evm",
      raw: text,
      display: text,
      icon: CHAIN_ICONS.evm,
      label: "EVM address",
    };
  }

  // 3. EVM Transaction Hash (0x + 64 hex chars)
  if (EVM_TX_HASH_REGEX.test(text)) {
    return {
      kind: "txHash",
      chain: "evm",
      raw: text,
      display: truncateTechData(text, "evm", "txHash"),
      icon: CHAIN_ICONS.evm,
      label: "Transaction hash",
    };
  }

  // 4. NEAR named account (e.g. alice.near)
  if (NEAR_NAMED_REGEX.test(text)) {
    return {
      kind: "address",
      chain: "near",
      raw: text,
      display: text,
      icon: CHAIN_ICONS.near,
      label: "NEAR account",
    };
  }

  // 5. NEAR implicit account (64 hex characters)
  if (NEAR_IMPLICIT_REGEX.test(text)) {
    return {
      kind: "address",
      chain: "near",
      raw: text,
      display: text,
      icon: CHAIN_ICONS.near,
      label: "NEAR account",
    };
  }

  // 6. Solana Address (Base58, 32-44 characters, mixed case/numbers)
  if (
    SOLANA_REGEX.test(text) &&
    /[A-Z]/.test(text) &&
    /[a-z]/.test(text) &&
    /[0-9]/.test(text)
  ) {
    return {
      kind: "address",
      chain: "solana",
      raw: text,
      display: text,
      icon: CHAIN_ICONS.solana,
      label: "Solana address",
    };
  }

  return null;
}

export function TechDataChip({
  data,
  className,
}: {
  data: TechData;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      void (async () => {
        try {
          await navigator.clipboard.writeText(data.raw);
          setCopied(true);
        } catch {
          // Clipboard unavailable
        }
      })();
    },
    [data.raw],
  );

  const truncated = truncateTechData(data.raw, data.chain, data.kind);
  const canTruncate = truncated !== data.raw;

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`${data.label ?? "Address"}: ${data.raw} (Click to copy)`}
      aria-label={`Copy ${data.label ?? "address"}: ${data.raw}`}
      className={cn(
        "group/chip mx-1 inline-flex max-w-full items-center rounded-[6px] border border-accent/40 bg-field text-left align-middle font-mono text-[12px] leading-tight text-ink transition-[background-color,border-color,transform] duration-75 hover:border-accent/70 hover:bg-hover dark:border-accent/45 dark:hover:border-accent/75 active:scale-[0.99] cursor-pointer select-none",
        CHIP_LAYOUT_TOKENS.paddingY,
        CHIP_LAYOUT_TOKENS.paddingX,
        CHIP_LAYOUT_TOKENS.gap,
        className,
      )}
    >
      {/* Prefix chain logo: fitted with object-contain */}
      {data.icon && (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center",
            CHIP_LAYOUT_TOKENS.iconSize,
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.icon}
            alt=""
            aria-hidden="true"
            className="size-full object-contain select-none pointer-events-none"
          />
        </span>
      )}

      {/* Responsive mono value: middle-truncated on mobile (<640px), full on desktop */}
      <span className="min-w-0 font-mono text-[12px] tracking-tight">
        {canTruncate ? (
          <>
            <span className="sm:hidden">{truncated}</span>
            <span className="hidden sm:inline">{data.raw}</span>
          </>
        ) : (
          data.raw
        )}
      </span>

      {/* Suffix copy icon: always present, tactile morph into checkmark */}
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center text-ink-3 transition-colors duration-75 group-hover/chip:text-ink-2",
          CHIP_LAYOUT_TOKENS.iconSize,
        )}
      >
        <span
          aria-hidden={copied}
          className="absolute inset-0 flex items-center justify-center transition-opacity duration-100 ease-out"
          style={{
            opacity: copied ? 0 : 1,
            pointerEvents: copied ? "none" : "auto",
          }}
        >
          <IconCopy size={CHIP_LAYOUT_TOKENS.copyGlyphSize} stroke={1.8} />
        </span>
        <span
          aria-hidden={!copied}
          className="absolute inset-0 flex items-center justify-center text-green transition-opacity duration-100 ease-out"
          style={{
            opacity: copied ? 1 : 0,
            pointerEvents: copied ? "auto" : "none",
          }}
        >
          <IconCheck size={CHIP_LAYOUT_TOKENS.copyGlyphSize} stroke={2.2} />
        </span>
      </span>
    </button>
  );
}
