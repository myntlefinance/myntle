"use client";

import { useEffect, useMemo, useRef, useState, useLayoutEffect, type ReactNode } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconWorld,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { Switch } from "@/components/atoms/Switch";
import { TokenAvatar } from "@/components/finance/TokenAvatar";
import NetworkIcon, { NETWORK_ALIASES } from "@/components/finance/NetworkIcon";
import { MorphNumber } from "@/components/finance/MorphMoney";
import {
  allocationGroupOf,
  type AllocationGroup,
} from "@/components/finance/PortfolioHero";
import {
  networkDisplayName,
  type AssetGroup,
  type AssetItem,
} from "@/lib/wallet/balances";

/* ─────────────────────────────────────────────────────────
 * HOLDINGS TABLE
 * Distilled from the FilterTable card surface and the SearchList
 * row with its clear button. One row per asset, sorted by value,
 * with the network shown inline. Group filtering lives in the
 * hero allocation bar above: it passes the selected group down,
 * and an empty selection shows everything.
 * ───────────────────────────────────────────────────────── */

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type HoldingRow = AssetItem & { groupName: string; groupIcon: string };

export function flattenGroups(groups: AssetGroup[]): HoldingRow[] {
  return groups
    .flatMap((group) =>
      group.items.map((item) => ({
        ...item,
        groupName: group.name,
        groupIcon: group.icon,
      })),
    )
    .sort((a, b) => b.valueUsd - a.valueUsd || a.symbol.localeCompare(b.symbol));
}

/* Networks canonicalized the same way NetworkIcon resolves them: the EVM
 * chains collapse to one parent, everything else filters on its own.
 * The alias table is shared with NetworkIcon so a spelling that draws one
 * badge never filters as another row. */
const EVM_NETWORKS = [
  "ethereum",
  "arbitrum",
  "base",
  "optimism",
  "polygon",
  "bnb",
  "avalanche",
  "gnosis",
  "linea",
  "scroll",
  "zksync",
  "blast",
  "mantle",
  "celo",
  "unichain",
  "soneium",
];

function canonicalNetwork(raw?: string | null): string {
  const norm = (raw ?? "").trim().toLowerCase();
  if (!norm) return "unknown";
  // Intents shares the NEAR mark, but stays its own filter option.
  if (norm === "intents") return norm;
  return NETWORK_ALIASES[norm] ?? norm;
}

/* The RecordsTable InputPicker square: filled with a check when on, and a
 * dash when a parent is half-on. */
function NetworkCheckbox({
  checked,
  mixed = false,
}: {
  checked: boolean;
  mixed?: boolean;
}) {
  const active = checked || mixed;
  return (
    <span
      className={`flex size-4 shrink-0 items-center justify-center rounded-[5px] border ${active ? "border-accent bg-accent text-white" : "border-line-strong text-transparent"}`}
    >
      {mixed ? (
        <span className="h-[2px] w-2 rounded-full bg-white" />
      ) : checked ? (
        <IconCheck size={11} stroke={2.4} aria-hidden />
      ) : null}
    </span>
  );
}

export function HoldingsTable({
  groups,
  group = null,
  error = false,
  onRetry,
  emptyTitle = "No assets found",
  bodyKey,
  animate = true,
}: {
  groups: AssetGroup[];
  /** Hero bar selection; null shows every holding. */
  group?: AllocationGroup | null;
  /** Read failure: headers stay, the body names it with a retry. */
  error?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  /** Watched account the rows belong to: only the card below replays
    * its entrance when this changes — the search, network, and dust
    * controls above stay put. Everywhere else the whole table mounts
    * as one, exactly as before. */
  bodyKey?: string;
  /** Skeleton and reduced states: plain numbers, no digit morph. */
  animate?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showDust, setShowDust] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  /* Null means every network on screen; the first toggle pins a set. */
  const [selected, setSelected] = useState<string[] | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const all = useMemo(() => flattenGroups(groups), [groups]);
  // Nothing to filter when the account holds nothing: the control stays in
  // the toolbar for the shape of the row, but it no longer opens.
  const noAssets = all.length === 0;

  const networkOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of all) {
      const id = canonicalNetwork(item.network ?? item.chain);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const evm = EVM_NETWORKS.filter((id) => counts.has(id)).map((id) => ({
      id,
      name: networkDisplayName(id),
    }));
    const rest = [...counts.keys()]
      .filter((id) => !EVM_NETWORKS.includes(id))
      .map((id) => ({
        id,
        name: networkDisplayName(id),
      }));
    return { evm, rest, allIds: [...counts.keys()] };
  }, [all]);

  const selectedIds = selected ?? networkOptions.allIds;
  const triggerLabel =
    selectedIds.length === networkOptions.allIds.length
      ? "All networks"
      : selectedIds.length === 1
        ? networkDisplayName(selectedIds[0])
        : `${selectedIds.length} networks`;

  const evmIds = networkOptions.evm.map((option) => option.id);
  const evmChecked =
    evmIds.length > 0 && evmIds.every((id) => selectedIds.includes(id));
  const evmMixed =
    !evmChecked && evmIds.some((id) => selectedIds.includes(id));

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected([...next]);
  };
  const toggleEvm = () => {
    const next = new Set(selectedIds);
    if (evmChecked) evmIds.forEach((id) => next.delete(id));
    else evmIds.forEach((id) => next.add(id));
    setSelected([...next]);
  };

  /* A read that lands empty closes the open filter: it can no longer
   * offer a network, so leaving it open would be a dead menu. */
  /* eslint-disable react-hooks/set-state-in-effect -- empty table: the trigger is disabled */
  useEffect(() => {
    if (noAssets) setFilterOpen(false);
  }, [noAssets]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* Dismissal matches the sidebar chat search: outside press, Escape with
   * focus back on the trigger, or any scroll or resize. */
  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!filterRef.current?.contains(event.target as Node))
        setFilterOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFilterOpen(false);
      triggerRef.current?.focus();
    };
    const onScroll = () => setFilterOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [filterOpen]);

  const rows = all.filter((item) => {
    if (error) return false;
    if (group && allocationGroupOf(item.category) !== group) return false;
    if (!selectedIds.includes(canonicalNetwork(item.network ?? item.chain)))
      return false;
    if (!showDust && item.valueUsd < 0.5) return false;
    if (!query) return true;
    const q = query.trim().toLowerCase();
    return (
      item.symbol.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q)
    );
  });

  /* Whale accounts page hundreds of rows: show the first 25 and grow
   * on demand. The count resets when the account or any filter
   * changes, never when the background full read adds rows. */
  const PAGE_SIZE = 25;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const filterKey = `${bodyKey ?? "all"}|${query}|${selectedIds.join(",")}|${showDust}|${group ?? "all"}`;
  /* eslint-disable react-hooks/set-state-in-effect -- filter-scoped reset:
   * a new account or filter restarts the list at the first page */
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filterKey]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const visibleRows = rows.slice(0, visibleCount);
  const hiddenCount = rows.length - visibleRows.length;

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
  }, [rows]);

  const networkRow = (
    option: { id: string; name: string },
    indented = false,
  ) => {
    const checked = selectedIds.includes(option.id);
    return (
      <button
        key={option.id}
        type="button"
        role="menuitemcheckbox"
        aria-checked={checked}
        onClick={() => toggleOne(option.id)}
        className={`flex h-8 w-full items-center gap-1.5 rounded-[8px] text-left text-[13px] font-medium text-ink hover:bg-hover ${indented ? "pl-7 pr-1.5" : "px-1.5"}`}
      >
        <NetworkCheckbox checked={checked} />
        <NetworkIcon network={option.id} size={15} />
        <span className="min-w-0 flex-1 truncate">{option.name}</span>
      </button>
    );
  };

  /* Within a mounted table the body replays when `bodyKey` changes — a
   * wallet/super switch or a watched card switch. On first mount the
   * page-level layout entrance owns the motion, so the body does not
   * double-animate. */
  const [animatedKey, setAnimatedKey] = useState<string | undefined>(
    undefined,
  );
  const mounted = useRef(false);
  const lastBodyKey = useRef(bodyKey);
  useIsomorphicLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      lastBodyKey.current = bodyKey;
      return;
    }
    if (bodyKey !== lastBodyKey.current) {
      lastBodyKey.current = bodyKey;
      setAnimatedKey(bodyKey);
    }
  }, [bodyKey]);
  const bodyEntrance = bodyKey !== undefined && animatedKey === bodyKey;
  const wrapBody = (node: ReactNode) => (
    <div
      key={bodyKey}
      className={
        bodyEntrance
          ? "animate-[fade-up_300ms_cubic-bezier(0.23,1,0.32,1)_both]"
          : undefined
      }
    >
      {node}
    </div>
  );

  return (
    <div className="mt-1">
      {error ? null : (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {/* Search chrome matches the sidebar chat search: half the
            toolbar, with the clear control blending into the field. */}
          <div
            className="flex h-8 w-1/2 min-w-0 items-center overflow-hidden rounded-[8px] bg-field text-ink-3 shadow-hairline focus-within:text-ink-2"
            {...{ "skullet-block": "" }}
          >
            <span className="ml-2 flex shrink-0 items-center justify-center">
              <IconSearch size={15} aria-hidden />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search assets"
              aria-label="Search assets"
              className="ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-3"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]"
              >
                <IconX size={16} aria-hidden />
              </button>
            ) : null}
          </div>

          <div className="relative min-w-0" ref={filterRef}>
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={filterOpen && !noAssets}
              aria-label="Filter by network"
              disabled={noAssets}
              onClick={() => {
                if (noAssets) return;
                setFilterOpen((open) => !open);
              }}
              className="flex h-8 min-w-0 items-center gap-1.5 rounded-[8px] bg-field px-2.5 text-[13px] font-medium text-ink shadow-hairline disabled:pointer-events-none disabled:opacity-40"
            >
              <IconWorld size={15} aria-hidden className="shrink-0 text-ink-3" />
              <span className="truncate">{triggerLabel}</span>
              <IconChevronDown
                size={15}
                aria-hidden
                className={`shrink-0 text-ink-3 transition-transform duration-150 ${filterOpen ? "rotate-180" : ""}`}
              />
            </button>
            {filterOpen && !noAssets ? (
              <div
                role="menu"
                aria-label="Filter by network"
                className="absolute left-0 top-full z-50 mt-1 w-[220px] rounded-[12px] bg-surface p-1.5 shadow-overlay"
                style={{
                  animation:
                    "pop-in 140ms cubic-bezier(0.23,1,0.32,1) both",
                  transformOrigin: "top left",
                }}
              >
                <div className="flex flex-col gap-px">
                  {networkOptions.evm.length > 0 ? (
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={evmChecked}
                      onClick={toggleEvm}
                      className="flex h-8 w-full items-center gap-1.5 rounded-[8px] px-1.5 text-left text-[13px] font-medium text-ink hover:bg-hover"
                    >
                      <NetworkCheckbox
                        checked={evmChecked}
                        mixed={evmMixed}
                      />
                      <NetworkIcon network="ethereum" size={15} />
                      <span className="min-w-0 flex-1 truncate">EVM</span>
                    </button>
                  ) : null}
                  {networkOptions.evm.map((option) =>
                    networkRow(option, true),
                  )}
                  {networkOptions.rest.map((option) => networkRow(option))}
                </div>
              </div>
            ) : null}
          </div>

          <div
            className="ml-auto flex items-center gap-2"
            {...{ "skullet-ignore": "" }}
          >
            <span className="text-[13px] text-ink-2">Show dust</span>
            <Switch
              checked={showDust}
              onChange={setShowDust}
              label="Show dust"
            />
          </div>
        </div>
      )}

      {wrapBody(
        <div
          ref={bodyRef}
          className="overflow-hidden rounded-card bg-surface shadow-card will-change-[height]"
          style={{ height: "auto" }}
        >
        <div ref={contentRef}>
        <table className="w-full border-collapse">
          <colgroup>
            <col style={{ width: "40%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "38%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="border-b border-line px-3 py-2 text-left text-[12px] font-medium text-ink-3">
                Asset
              </th>
              <th className="border-b border-line px-3 py-2 text-right text-[12px] font-medium text-ink-3">
                Balance
              </th>
              <th className="border-b border-line px-3 py-2 text-right text-[12px] font-medium text-ink-3">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center">
                  <p className="text-[13px] leading-relaxed text-ink-2">
                    Failed to read balances.
                  </p>
                  {onRetry ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      onClick={onRetry}
                      className="mt-4"
                    >
                      Refresh
                    </Button>
                  ) : null}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-24 text-center">
                  <p className="text-[13px] leading-relaxed text-ink-2">
                    {all.length === 0 ? emptyTitle : "No assets match."}
                  </p>
                  {all.length === 0 ? null : (
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
                      Try a different search or filter.
                    </p>
                  )}
                </td>
              </tr>
            ) : (
              visibleRows.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-line transition-colors duration-100 last:border-b-0 hover:bg-hover"
                >
                  <td className="px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <TokenAvatar
                        symbol={item.symbol}
                        name={item.name}
                        logo={item.logo}
                        contractAddress={item.contractAddress}
                        chain={item.chain}
                        networkBadge={item.network}
                        size={28}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium leading-tight text-ink">
                          {item.symbol}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-ink-3">
                          {item.groupName}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="block text-[13px] tabular-nums leading-tight text-ink">
                      <MorphNumber disabled={!animate}>{item.amount}</MorphNumber>
                    </span>
                    {item.priceUsd ? (
                      <span className="mt-0.5 block text-[11.5px] tabular-nums leading-tight text-ink-3">
                        <MorphNumber disabled={!animate}>
                          {`$${item.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 4 })}`}
                        </MorphNumber>
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-[11.5px] tabular-nums leading-tight text-ink-3">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-[14px] font-bold tabular-nums text-ink">
                    <MorphNumber disabled={!animate}>{money(item.valueUsd)}</MorphNumber>
                  </td>
                </tr>
              ))
            )}
            {hiddenCount > 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-2 text-center">
                  <span className="mr-2 text-[12px] tabular-nums text-ink-3">
                    Showing {visibleRows.length} of {rows.length}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setVisibleCount((count) => count + PAGE_SIZE)
                    }
                  >
                    Show more
                  </Button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>
        </div>
      )}
    </div>
  );
}

export default HoldingsTable;
