"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  activateWarmState,
  isTooltipWarm,
  onTooltipEnter,
  onTooltipLeave,
  TOOLTIP_ENTER_ANIMATION,
  TOOLTIP_PILL_CLASS,
  TOOLTIP_PILL_TEXT,
} from "@/components/app/tooltip";

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
  paddingY: "py-0.5",
  paddingX: "px-1.5",
  gap: "gap-1.5",
  iconSize: "size-3.5",
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
  const [tooltipPos, setTooltipPos] = useState<{
    x: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const [isInstant, setIsInstant] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearOpenTimer();
  }, [clearOpenTimer]);

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

  const placeTooltip = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const isNearTop = rect.top < 44;
    setTooltipPos({
      x: Math.min(
        Math.max(rect.left + rect.width / 2, 56),
        window.innerWidth - 56,
      ),
      bottom: isNearTop ? undefined : window.innerHeight - rect.top + 6,
      top: isNearTop ? rect.bottom + 6 : undefined,
    });
  }, []);

  const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
    const element = event.currentTarget;
    onTooltipEnter();

    if (isTooltipWarm()) {
      // Warm window: skip the delay and the entrance animation
      setIsInstant(true);
      placeTooltip(element);
      return;
    }

    // Cold hover: wait 400ms to prevent accidental activation
    setIsInstant(false);
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      placeTooltip(element);
      activateWarmState();
    }, 400);
  };

  const handleMouseLeave = () => {
    clearOpenTimer();
    setTooltipPos(null);
    onTooltipLeave();
  };

  const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
    setIsInstant(false);
    placeTooltip(event.currentTarget);
    activateWarmState();
  };

  const handleBlur = () => {
    clearOpenTimer();
    setTooltipPos(null);
    onTooltipLeave();
  };

  useEffect(() => {
    if (!tooltipPos) return;
    const dismiss = () => {
      clearOpenTimer();
      setTooltipPos(null);
      onTooltipLeave();
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [tooltipPos, clearOpenTimer]);

  const truncated = truncateTechData(data.raw, data.chain, data.kind);
  const canTruncate = truncated !== data.raw;

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        aria-label={`Copy ${data.label ?? "address"}: ${data.raw}`}
        className={cn(
          "mx-1 inline-flex max-w-full cursor-pointer select-none items-center rounded-[6px] bg-field text-left align-middle leading-tight text-ink transition-[background-color,transform] duration-75 hover:bg-hover active:scale-[0.99]",
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
              className="pointer-events-none size-full object-contain select-none"
            />
          </span>
        )}

        {/* Responsive value: middle-truncated on mobile (<640px), full on desktop */}
        <span className="min-w-0">
          {canTruncate ? (
            <>
              <span className="sm:hidden">{truncated}</span>
              <span className="hidden sm:inline">{data.raw}</span>
            </>
          ) : (
            data.raw
          )}
        </span>
      </button>

      {typeof document !== "undefined" &&
        tooltipPos &&
        createPortal(
          <div
            role="tooltip"
            data-instant={isInstant ? "" : undefined}
            className="pointer-events-none fixed z-[9999] -translate-x-1/2"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.top,
              bottom: tooltipPos.bottom,
            }}
          >
            <div
              className={cn(TOOLTIP_PILL_CLASS, TOOLTIP_PILL_TEXT)}
              style={
                isInstant
                  ? { transition: "none", animation: "none" }
                  : { animation: TOOLTIP_ENTER_ANIMATION }
              }
            >
              {copied ? "Copied!" : "Click to copy"}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
