"use client";

import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  type ReactNode,
} from "react";
import {
  IconWallet,
  IconLayoutGrid,
  IconCoin,
  IconCoins,
} from "@tabler/icons-react";
import {
  CHAIN_ICONS,
  detectTechData,
  truncateTechData,
  type SupportedChain,
} from "@/components/atoms/TechDataChip";
import { NetworkIcon } from "./NetworkIcon";
import { TokenAvatar } from "./TokenAvatar";
import {
  type TokenBalance,
  type AssetItem,
  type AssetGroup,
  type AssetCategory,
  groupBalancesByNetwork,
} from "@/lib/wallet/balances";

export type { AssetItem, AssetGroup, AssetCategory };
export { groupBalancesByNetwork };

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type AssetFilter = "all" | "stables" | "dust";

export type AssetMatrixProps = {
  /** The grouped asset data to render */
  groups?: AssetGroup[];
  /** Flat token balances; automatically grouped by network if groups is omitted */
  balances?: TokenBalance[];
  /** Title shown in the header bar. Defaults to "Portfolio balances" */
  title?: string;
  /** Address the figures belong to, shown under the title when the card is
   * not the connected wallet's own holdings. */
  address?: string;
  /** Chain family of that address, for its icon and truncation. */
  chain?: SupportedChain;
  /** Total value in USD displayed in header bar. If omitted, computed from all items */
  totalValueUsd?: number;
  /** Whether to show the filter bar (All / Stables / Dust chips). Defaults to true */
  showFilters?: boolean;
  /** Initial active filter. Defaults to "all" */
  initialFilter?: AssetFilter;
  /** Empty state message. Defaults to "No holdings found." */
  emptyMessage?: string;
  /** Optional container class name */
  className?: string;
  /** Variant for backwards-compatibility */
  variant?: string;
};

const FILTER_CONFIG: Array<{
  id: AssetFilter;
  label: string;
  icon: typeof IconLayoutGrid;
}> = [
  { id: "all", label: "All", icon: IconLayoutGrid },
  { id: "stables", label: "Stables", icon: IconCoin },
  { id: "dust", label: "Dust", icon: IconCoins },
];

/** The chain family of an attribution address, when the tool did not say. */
function addressChain(
  address: string,
  chain?: SupportedChain,
): SupportedChain | undefined {
  return chain ?? detectTechData(address)?.chain;
}

/**
 * Configurable multi-network asset matrix component.
 * Renders verified holdings with native vector icons, clean numeric hierarchy,
 * and optional category filtering.
 */
export function AssetMatrix({
  groups: rawGroups,
  balances,
  title = "Portfolio balances",
  address,
  chain,
  totalValueUsd: explicitTotal,
  showFilters = true,
  initialFilter = "all",
  emptyMessage = "No holdings found in this category.",
  className = "",
}: AssetMatrixProps) {
  const [activeFilter, setActiveFilter] = useState<AssetFilter>(initialFilter);

  // Synchronize activeFilter if initialFilter prop changes
  useEffect(() => {
    setActiveFilter(initialFilter);
  }, [initialFilter]);

  // Resolve grouped data either from prop or auto-grouping from flat balances
  const groups = useMemo(() => {
    if (rawGroups && rawGroups.length > 0) return rawGroups;
    if (balances && balances.length > 0) return groupBalancesByNetwork(balances);
    return [];
  }, [rawGroups, balances]);

  // Overall counts and persistent portfolio total across all categories
  const { totalPortfolioUsd, filterCounts, itemCount } = useMemo(() => {
    let sum = 0;
    let allCount = 0;
    let stablesCount = 0;
    let dustCount = 0;

    for (const g of groups) {
      for (const item of g.items) {
        sum += item.valueUsd;
        allCount++;
        if (
          item.category === "stables" ||
          item.symbol.toUpperCase().includes("USD") ||
          item.symbol.toUpperCase() === "DAI" ||
          item.symbol.toUpperCase() === "AUSD"
        ) {
          stablesCount++;
        }
        if (item.category === "dust" || item.valueUsd < 1.0) {
          dustCount++;
        }
      }
    }

    return {
      totalPortfolioUsd: explicitTotal !== undefined ? explicitTotal : sum,
      filterCounts: {
        all: allCount,
        stables: stablesCount,
        dust: dustCount,
      },
      itemCount: allCount,
    };
  }, [groups, explicitTotal]);

  // A single row already states its own chain and its own value, so the header
  // and the filter bar would only repeat it. Binary: both or neither.
  const hasMultipleItems = itemCount > 1;
  const resolvedChain = address ? addressChain(address, chain) : undefined;
  const addressIcon = resolvedChain ? CHAIN_ICONS[resolvedChain] : undefined;

  // Active items based on selected filter
  const visibleGroups = useMemo(() => {
    return groups
      .map((g) => {
        const filtered = g.items.filter((item) => {
          if (activeFilter === "all") return true;
          if (activeFilter === "stables") {
            return (
              item.category === "stables" ||
              item.symbol.toUpperCase().includes("USD") ||
              item.symbol.toUpperCase() === "DAI" ||
              item.symbol.toUpperCase() === "AUSD"
            );
          }
          if (activeFilter === "dust") {
            return item.category === "dust" || item.valueUsd < 1.0;
          }
          return true;
        });
        return { ...g, items: filtered };
      })
      .filter((g) => g.items.length > 0);
  }, [groups, activeFilter]);

  // Smooth monotonic container height resizing without dip-and-rebound flicker
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!body || !content) return;

    const newHeight = content.offsetHeight;
    if (prevHeightRef.current === null) {
      prevHeightRef.current = newHeight;
      return;
    }

    const oldHeight = prevHeightRef.current;
    if (oldHeight !== newHeight) {
      const anim = body.animate(
        [
          { height: `${oldHeight}px` },
          { height: `${newHeight}px` },
        ],
        {
          duration: 220,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
          fill: "forwards",
        },
      );

      anim.onfinish = () => {
        body.style.height = "auto";
        anim.cancel();
      };

      prevHeightRef.current = newHeight;
    }
  }, [visibleGroups]);

  return (
    <div className={`w-full max-w-[392px] sm:w-[392px] ${className}`}>
      <div className="overflow-hidden rounded-[14px] border border-[var(--grid-line)] bg-surface shadow-xs">
        {/* Header Bar */}
        {hasMultipleItems && (
          <div className="flex items-center justify-between border-b border-[var(--grid-line)] bg-surface px-3 sm:px-4 py-2.5 select-none">
            <div className="flex items-center gap-2 min-w-0">
              <IconWallet
                size={15}
                stroke={1.5}
                className="text-ink-3 shrink-0"
                aria-hidden="true"
              />
              <span className="text-[13px] font-medium text-ink truncate">
                {title}
              </span>
            </div>

            {/* Persistent Total Value */}
            <span className="text-[14px] font-semibold tabular-nums text-ink shrink-0 pl-2">
              ${totalPortfolioUsd.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        )}

        {/* Attribution: an address the reader did not connect. */}
        {address && (
          <div className="flex items-center gap-2 border-b border-[var(--grid-line)] px-3 sm:px-4 py-2">
            {addressIcon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={addressIcon}
                alt=""
                aria-hidden="true"
                className="size-4 shrink-0 select-none object-contain"
              />
            )}
            <span
              className="min-w-0 truncate text-[12.5px] leading-tight text-ink-2"
              title={address}
            >
              <span className="sm:hidden">
                {truncateTechData(address, resolvedChain)}
              </span>
              <span className="hidden sm:inline">{address}</span>
            </span>
          </div>
        )}

        {/* Filter Chips Bar (Configurable) */}
        {showFilters && hasMultipleItems && (
          <div className="flex items-center gap-1.5 p-2 bg-hover-1/10 border-b border-[var(--grid-line)] select-none">
            {FILTER_CONFIG.map((f) => {
              const active = activeFilter === f.id;
              const Icon = f.icon;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setActiveFilter(f.id)}
                  className={`flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer select-none ${
                    active
                      ? "bg-surface text-ink shadow-xs"
                      : "text-ink-2 hover:text-ink hover:bg-hover/50"
                  }`}
                >
                  <Icon
                    size={13}
                    stroke={1.5}
                    className={`shrink-0 ${
                      active ? "text-ink-2" : "text-ink-3"
                    }`}
                    aria-hidden="true"
                  />
                  <span>{f.label}</span>
                  <span
                    className={`rounded-[4px] px-1 text-[10.5px] tabular-nums ${
                      active ? "bg-field text-ink" : "text-ink-3"
                    }`}
                  >
                    {filterCounts[f.id]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Matrix Table with Smooth Height Resizing */}
        <div
          ref={bodyRef}
          className="overflow-hidden will-change-[height]"
          style={{ height: "auto" }}
        >
          <div ref={contentRef} className="divide-y divide-[var(--grid-line)]">
            {visibleGroups.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-ink-3">
                {emptyMessage}
              </div>
            ) : (
              visibleGroups.map((group) => (
                <div
                  key={group.id}
                  className="flex items-stretch border-b border-[var(--grid-line)] last:border-b-0 animate-[fade-in_180ms_cubic-bezier(0.23,1,0.32,1)]"
                >
                  {/* Column 1: Network Rail (Mobile: compact 44px rail; Desktop: 116px full name) */}
                  <div
                    title={group.name}
                    aria-label={group.name}
                    className="flex w-11 sm:w-[116px] shrink-0 items-center justify-center sm:justify-start border-r border-[var(--grid-line)] bg-hover-1/10 px-2 sm:px-3 py-2.5 select-none"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <NetworkIcon network={group.icon} size={16} />
                      <span className="hidden sm:inline text-[12.5px] font-medium text-ink truncate">
                        {group.name}
                      </span>
                    </div>
                  </div>

                  {/* Columns 2 & 3: Token Rows */}
                  <div className="flex-1 min-w-0 divide-y divide-[var(--grid-line)]">
                    {group.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between px-2.5 sm:px-3.5 py-2 text-[13px] transition-colors duration-100 hover:bg-hover gap-2"
                      >
                        {/* Column 2: Token Icon with Network Badge + Stacked Ticker and Amount */}
                        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                          <TokenAvatar
                            symbol={item.symbol}
                            name={item.name}
                            networkBadge={group.icon}
                            size={28}
                          />

                          {/* Stacked Ticker and Numeric Balance */}
                          <div className="flex flex-col justify-center min-w-0">
                            <span className="text-[13px] font-medium leading-tight text-ink truncate">
                              {item.symbol}
                            </span>
                            <span className="mt-0.5 text-[11.5px] tabular-nums text-ink-3 leading-tight truncate">
                              {item.amount}
                            </span>
                          </div>
                        </div>

                        {/* Column 3: Token Estimated Dollar Value */}
                        <div className="shrink-0 text-right tabular-nums text-[13px] font-medium text-ink pl-1 sm:w-[76px]">
                          ${item.valueUsd >= 0
                            ? item.valueUsd.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                            : `-${Math.abs(item.valueUsd).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AssetMatrix;
