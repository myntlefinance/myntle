"use client";

import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  useId,
} from "react";
import {
  IconWallet,
  IconLayoutGrid,
  IconCoin,
  IconCoins,
} from "@tabler/icons-react";
import { NetworkIcon } from "./NetworkIcon";
import { TokenAvatar } from "./TokenAvatar";
import { Button } from "@/components/atoms/Button";
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

const PREVIEW_LIMIT = 5;

export type AssetMatrixProps = {
  /** The grouped asset data to render */
  groups?: AssetGroup[];
  /** Flat token balances; automatically grouped by network if groups is omitted */
  balances?: TokenBalance[];
  /** Title shown in the header bar. Defaults to "Portfolio balances" */
  title?: string;
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

/** Filter before picking the largest holdings, while keeping network groups. */
export function selectAssetMatrixGroups(
  groups: AssetGroup[],
  filter: AssetFilter,
  expanded: boolean,
): { groups: AssetGroup[]; count: number } {
  const matching = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (filter === "all") return true;
        if (filter === "stables") {
          return (
            item.category === "stables" ||
            item.symbol.toUpperCase().includes("USD") ||
            item.symbol.toUpperCase() === "DAI" ||
            item.symbol.toUpperCase() === "AUSD"
          );
        }
        return item.category === "dust" || item.valueUsd < 1.0;
      }),
    }))
    .filter((group) => group.items.length > 0);

  const count = matching.reduce((sum, group) => sum + group.items.length, 0);
  if (expanded || count <= PREVIEW_LIMIT) return { groups: matching, count };

  // Select across networks, not the first five rows of the first network.
  // Indices keep identical tickers or contract IDs on different networks
  // distinct, and break value ties in their original order.
  const ranked = matching.flatMap((group, groupIndex) =>
    group.items.map((item, itemIndex) => ({
      groupIndex,
      itemIndex,
      value: Number.isFinite(item.valueUsd) ? item.valueUsd : -Infinity,
    })),
  );
  ranked.sort(
    (a, b) =>
      b.value - a.value ||
      a.groupIndex - b.groupIndex ||
      a.itemIndex - b.itemIndex,
  );
  // Rank first, then bucket back into one group per network. The preview is
  // still genuinely highest first, but a network whose holdings alternate with
  // another chain's in value order keeps a single rail instead of repeating
  // it. Buckets are ordered by each network's highest holding, and their items
  // stay in ranked order. The group index keeps identical tickers or contract
  // IDs on different networks distinct.
  const buckets = new Map<number, AssetItem[]>();
  for (const entry of ranked.slice(0, PREVIEW_LIMIT)) {
    const item = matching[entry.groupIndex].items[entry.itemIndex];
    const bucket = buckets.get(entry.groupIndex);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(entry.groupIndex, [item]);
    }
  }

  const preview: AssetGroup[] = [...buckets].map(([groupIndex, items]) => ({
    ...matching[groupIndex],
    id: `${matching[groupIndex].id}-preview-${groupIndex}`,
    items,
  }));

  return { groups: preview, count };
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
  totalValueUsd: explicitTotal,
  showFilters = true,
  initialFilter = "all",
  emptyMessage = "No holdings found in this category.",
  className = "",
}: AssetMatrixProps) {
  const [activeFilter, setActiveFilter] = useState<AssetFilter>(initialFilter);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

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

  const { groups: visibleGroups, count: matchingCount } = useMemo(
    () => selectAssetMatrixGroups(groups, activeFilter, expanded),
    [groups, activeFilter, expanded],
  );
  const canExpand = matchingCount > PREVIEW_LIMIT;
  const expandedList = expanded && canExpand;

  // Smooth monotonic container height resizing without dip-and-rebound flicker
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const renderedHeightRef = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!body || !content) return;

    // The expanded list is capped, so its animation target is the cap rather
    // than the height of hundreds of rows. The same helper keeps collapse and
    // filter changes animating between the heights the reader can see.
    const maxHeight = expandedList
      ? Number.parseFloat(getComputedStyle(body).maxHeight)
      : Number.POSITIVE_INFINITY;
    const newHeight = Math.min(
      content.offsetHeight,
      Number.isFinite(maxHeight) ? maxHeight : Number.POSITIVE_INFINITY,
    );
    const oldHeight = renderedHeightRef.current;
    renderedHeightRef.current = newHeight;
    if (oldHeight === null) {
      return;
    }

    if (
      Math.abs(oldHeight - newHeight) < 0.5 ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      body.style.height = "";
      body.style.overflow = "";
      return;
    }

    // Pin the previous height before the browser paints the new one, and clip
    // rows while the frame grows or shrinks. Scroll returns when it lands.
    body.style.height = `${oldHeight}px`;
    body.style.overflow = "hidden";
    const anim = body.animate(
      [{ height: `${oldHeight}px` }, { height: `${newHeight}px` }],
      {
        duration: 220,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "forwards",
      },
    );

    anim.onfinish = () => {
      body.style.height = "";
      body.style.overflow = "";
      anim.cancel();
    };
    return () => {
      anim.onfinish = null;
      anim.cancel();
      body.style.height = "";
      body.style.overflow = "";
    };
  }, [visibleGroups, expandedList]);

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
                /* The radius is what skullet measures: an icon with no
                 * radius becomes a sharp square in the skeleton. */
                className="text-ink-3 shrink-0 rounded-[4px]"
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

        {/* Filter Chips Bar (Configurable) */}
        {showFilters && hasMultipleItems && (
          <div className="flex flex-wrap items-center gap-1.5 p-2 bg-hover-1/10 border-b border-[var(--grid-line)] select-none">
            {FILTER_CONFIG.map((f) => {
              const active = activeFilter === f.id;
              const Icon = f.icon;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (bodyRef.current) bodyRef.current.scrollTop = 0;
                    setActiveFilter(f.id);
                  }}
                  className={`flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer select-none ${
                    active
                      ? "bg-surface text-ink shadow-xs"
                      : "text-ink-2 hover:text-ink hover:bg-hover/50"
                  }`}
                >
                  <Icon
                    size={13}
                    stroke={1.5}
                    className={`shrink-0 rounded-[4px] ${
                      active ? "text-ink-2" : "text-ink-3"
                    }`}
                    aria-hidden="true"
                  />
                  <span>{f.label}</span>
                  <span
                    className={`rounded-[4px] px-1 text-[12px] tabular-nums ${
                      active ? "bg-field text-ink" : "text-ink-2"
                    }`}
                  >
                    {filterCounts[f.id]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Keep long results in the conversation without growing the thread.
            The stable gutter reserves the scrollbar before it appears, so row
            values never reflow when scrolling becomes available. */}
        <div
          ref={bodyRef}
          id={bodyId}
          role={expandedList ? "region" : undefined}
          aria-label={expandedList ? title : undefined}
          tabIndex={expandedList ? 0 : undefined}
          className={
            expandedList
              ? "max-h-[min(460px,75dvh)] overflow-y-auto scroll-slim [scrollbar-gutter:stable] focus-visible:outline-offset-[-2px]"
              : "overflow-hidden will-change-[height]"
          }
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
                  // The preview and the expanded list must share this key, so
                  // growing a group reuses its DOM instead of remounting it.
                  // The group's own id carries a preview suffix, which would
                  // restart the fade-in and read as a flicker on every expand.
                  key={group.name}
                  role="group"
                  aria-label={group.name}
                  className="flex items-stretch border-b border-[var(--grid-line)] last:border-b-0 animate-[fade-in_180ms_cubic-bezier(0.23,1,0.32,1)]"
                >
                  {/* Column 1: Network Rail (Mobile: compact 44px rail; Desktop: 116px full name) */}
                  <div
                    title={group.name}
                    aria-hidden="true"
                    className="flex w-11 sm:w-[116px] shrink-0 items-center justify-center sm:justify-start border-r border-[var(--grid-line)] bg-hover-1/10 px-2 sm:px-3 py-2.5 select-none"
                  >
                    {/* The rail stays centered in both states. Sticky only
                        pins the label once a long expanded group scrolls it
                        to the top; it does not change the resting alignment. */}
                    <div className={`flex items-center gap-2 min-w-0 ${expandedList ? "sticky top-2.5" : ""}`}>
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
        {canExpand ? (
          <div className="flex items-center justify-between gap-2 border-t border-[var(--grid-line)] px-3 py-2">
            <span className="text-[12px] tabular-nums text-ink-2">
              {expandedList
                ? `${matchingCount} holdings`
                : `${PREVIEW_LIMIT} of ${matchingCount} holdings`}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-expanded={expandedList}
              aria-controls={bodyId}
              onClick={() => {
                if (bodyRef.current) bodyRef.current.scrollTop = 0;
                setExpanded((value) => !value);
              }}
            >
              {expandedList ? "Show less" : "Show all"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AssetMatrix;
