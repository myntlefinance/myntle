"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  IconCoin,
  IconCoins,
  IconGasStation,
} from "@tabler/icons-react";
import { TextMorph } from "torph/react";
import MorphMoney, {
  MORPH_DURATION,
  MORPH_EASE,
  formatMoney,
} from "@/components/finance/MorphMoney";
import {
  activateWarmState,
  onTooltipEnter,
  onTooltipLeave,
  TOOLTIP_ENTER_ANIMATION,
  TOOLTIP_PILL_CLASS,
  TOOLTIP_PILL_TEXT,
} from "@/components/app/tooltip";
import type { AssetItem } from "@/lib/wallet/balances";

/* ─────────────────────────────────────────────────────────
 * PORTFOLIO HERO
 * Distilled from InsightCards AllocationCard: a hero total with a
 * complete sentence (no eyebrow), then the proportional segmented
 * bar. Numbers on screen are the total and the allocation shares,
 * nothing else. The bar sits straight on the page with no track
 * behind it, so the gaps read as separation between the holdings.
 * One segment per asset group in fixed order; the selection is
 * owned by the page, which filters the holdings table to match.
 * Segments stay bare color pills — the glyph, name, and share live
 * in the agent-style tooltip on hover, focus, or tap, cold-delayed
 * then instant while warm.
 * ───────────────────────────────────────────────────────── */

export const SEGMENT_TONE = {
  Stables: "bg-green",
  Gas: "bg-accent",
  Others: "bg-orange",
} as const;

/** Floor under a segment's width so the smallest share stays clickable. */
export const SEGMENT_MIN_PX = 24;

export type AllocationGroup = keyof typeof SEGMENT_TONE;

export type AllocationSegment = {
  name: AllocationGroup;
  pct: number;
};

const CATEGORY_ORDER: Array<AllocationGroup> = [
  "Stables",
  "Gas",
  "Others",
];

/** The bar group a holding belongs to; anything neither stable nor
 * gas is compositional other. The table filters on the same rule. */
export function allocationGroupOf(category?: string): AllocationGroup {
  if (category === "stables") return "Stables";
  if (category === "native") return "Gas";
  return "Others";
}

/** Sums per group, keeping zeroes; the two segment helpers below read
 * the same totals so the bar and its contract never drift apart. */
function allocationSums(
  items: Array<{ category?: string; valueUsd: number }>,
): Record<AllocationGroup, number> {
  const sums: Record<AllocationGroup, number> = {
    Stables: 0,
    Gas: 0,
    Others: 0,
  };
  for (const item of items) sums[allocationGroupOf(item.category)] += item.valueUsd;
  return sums;
}

/** One segment per asset group in fixed order, skipping empty groups. */
export function allocationSegments(
  items: Array<{ category?: string; valueUsd: number }>,
  total: number,
): AllocationSegment[] {
  if (total <= 0 || items.length === 0) return [];
  const sums = allocationSums(items);
  return CATEGORY_ORDER.filter((name) => sums[name] > 0).map((name) => ({
    name,
    pct: (sums[name] / total) * 100,
  }));
}

/** One share per group in fixed order, keeping zeroes: the three slots
 * stay mounted so switching accounts glides every length instead of
 * popping pills in and out. */
export function allocationShares(
  items: Array<{ category?: string; valueUsd: number }>,
  total: number,
): AllocationSegment[] {
  const sums = allocationSums(items);
  return CATEGORY_ORDER.map((name) => ({
    name,
    pct: total > 0 ? (sums[name] / total) * 100 : 0,
  }));
}

function SegmentGlyph({ group }: { group: AllocationGroup }) {
  if (group === "Stables") return <IconCoin size={13} stroke={2} aria-hidden />;
  if (group === "Gas") return <IconGasStation size={13} stroke={2} aria-hidden />;
  return <IconCoins size={13} stroke={2} aria-hidden />;
}

/* The tooltip label: the group glyph plus name and share, in the
 * agent-tooltip pill. Rendered on hover, focus, or tap — never inline. */
export function AllocationTooltipLabel({
  group,
  pct,
}: {
  group: AllocationGroup;
  pct: number;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <SegmentGlyph group={group} />
      <span className="tabular-nums">
        {group} {pct.toFixed(1)}%
      </span>
    </span>
  );
}

/** Shift a centered tooltip so it stays inside the viewport with room
 * to spare. Oversized tooltips stay centered; everything else gets the
 * smallest push that keeps both edges on screen. */
export function clampTooltipShift(
  centerX: number,
  tipWidth: number,
  viewportWidth: number,
  margin = 8,
): number {
  const half = tipWidth / 2;
  if (tipWidth >= viewportWidth - margin * 2) return 0;
  const clamped = Math.min(
    Math.max(centerX, margin + half),
    viewportWidth - margin - half,
  );
  return clamped - centerX;
}

/* One bar segment: a bare color pill that filters the table on click.
 * The tooltip follows the agent-response recipe — the shared pill with
 * the glyph, name, and share — but opens instantly on hover instead of
 * the usual cold delay, keeping only the pop-in entrance. It still
 * joins the product-wide warm coordinator so the neighbors stay snappy. */
function AllocationSegmentButton({
  segment,
  selected,
  onSelect,
  steady = false,
}: {
  segment: AllocationSegment;
  selected: boolean;
  onSelect: () => void;
  /** Watched bar only: the slot stays mounted when its share hits zero
    * and glides its length back, instead of popping in and out. */
  steady?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  // Measure after mount but before paint, so the first frame is
  // already clamped and the pop-in never starts off-screen.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    setShift(clampTooltipShift(a.left + a.width / 2, t.width, window.innerWidth));
  }, [isOpen]);

  const handleMouseEnter = () => {
    onTooltipEnter();
    setIsOpen(true);
    activateWarmState();
  };

  const handleMouseLeave = () => {
    setIsOpen(false);
    onTooltipLeave();
  };

  const handleFocus = () => {
    setIsOpen(true);
    activateWarmState();
  };

  const handleBlur = () => {
    setIsOpen(false);
    onTooltipLeave();
  };

  const empty = steady && segment.pct <= 0;

  return (
    // A watched slot never unmounts: an empty share collapses to nothing
    // and glides back on the same curve as the hero total, hidden from
    // sight, pointer, keyboard, and screen readers alike. Everywhere else
    // the bar keeps its mount-on-share behavior, untouched.
    <div
      ref={anchorRef}
      className={
        steady
          ? "relative h-full transition-[width,min-width,opacity] duration-[350ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
          : "relative h-full"
      }
      style={{
        // A unitless zero would jump units against the percentage widths;
        // "0%" keeps the interpolation on one unit so lengths glide.
        width: empty ? "0%" : `${segment.pct}%`,
        minWidth: empty ? 0 : SEGMENT_MIN_PX,
        opacity: empty ? 0 : 1,
      }}
      aria-hidden={empty ? true : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <button
        key={segment.name}
        type="button"
        tabIndex={empty ? -1 : undefined}
        aria-pressed={selected}
        aria-label={`${segment.name}: ${segment.pct.toFixed(1)}%`}
        onClick={onSelect}
        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-full ${SEGMENT_TONE[segment.name]} transition-[box-shadow,opacity] duration-300`}
        style={{
          opacity: selected ? 1 : 0.58,
          boxShadow: selected
            ? "inset 0 0 0 1px rgba(255,255,255,0.22)"
            : undefined,
        }}
      >
        <span
          className="absolute inset-y-1 left-1 rounded-full bg-white/20 transition-[width,opacity] duration-500"
          style={{
            width: selected ? "calc(100% - 8px)" : "0%",
            opacity: selected ? 1 : 0,
            transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </button>
      {isOpen ? (
        <div
          ref={tipRef}
          role="tooltip"
          className={`absolute bottom-[calc(100%+6px)] left-1/2 z-30 origin-bottom ${TOOLTIP_PILL_CLASS} ${TOOLTIP_PILL_TEXT}`}
          style={{
            // translate (not transform) so the pop-in scale composes.
            translate: `calc(-50% + ${shift}px)`,
            animation: TOOLTIP_ENTER_ANIMATION,
          }}
        >
          <AllocationTooltipLabel group={segment.name} pct={segment.pct} />
        </div>
      ) : null}
    </div>
  );
}

export type HeroScope = "wallet" | "super" | "watched";

export function PortfolioHero({
  total,
  count,
  scope,
  subject,
  items,
  selected,
  onSelect,
  masked = false,
  steadyBar = false,
  animate = true,
  morphDuration = MORPH_DURATION,
  hideTotal = false,
}: {
  total: number;
  count: number;
  scope: HeroScope;
  /** The watched label; the sentence always marks the public state. */
  subject?: string;
  items: AssetItem[];
  /** Bar selection, owned by the page; null shows every holding. */
  selected: AllocationGroup | null;
  onSelect: (group: AllocationGroup) => void;
  /** Locked state: the totals are unknown, so they render masked. */
  masked?: boolean;
  /** Watched bar only: keep all three slots mounted and glide their
    * lengths on account switch, instead of the mount-on-share bar
    * everywhere else. */
  steadyBar?: boolean;
  /** Skeleton and reduced states: plain text, no digit or sentence morph. */
  animate?: boolean;
  /** Per-surface timing; the watched hero runs slower so progressive
    * chunk merges glide instead of flickering. */
  morphDuration?: number;
  /** Wallet and super render the total in the address row above, so the
    * hero keeps the sentence and the bar only. Watched keeps it here. */
  hideTotal?: boolean;
}) {
  const bar = steadyBar
    ? allocationShares(items, total)
    : allocationSegments(items, total);
  const sentence =
    scope === "watched"
      ? subject
        ? `${subject}’s wallet holds ${formatMoney(total)} across ${count} ${count === 1 ? "asset" : "assets"}.`
        : `This wallet holds ${formatMoney(total)} across ${count} ${count === 1 ? "asset" : "assets"}.`
      : scope === "wallet"
        ? masked
          ? "Your wallet holds $•••••• across •• assets."
          : `Your wallet holds ${formatMoney(total)} across ${count} ${count === 1 ? "asset" : "assets"}.`
        : masked
          ? "Your super account holds $•••••• across •• assets."
          : `Your super account holds ${formatMoney(total)} across ${count} ${count === 1 ? "asset" : "assets"}.`;

  return (
    <div className="w-full">
      {/* The sentence morphs like the total below it: switching watched
        * accounts glides the label and count instead of cutting them.
        * The skeleton's ghost renders the same sentence as plain text, so
        * no hidden morph work runs while the bars are on screen. */}
      <p className="text-[13px] leading-relaxed text-ink-2">
        {animate ? (
          <TextMorph
            duration={morphDuration}
            ease={MORPH_EASE}
            respectReducedMotion
          >
            {sentence}
          </TextMorph>
        ) : (
          sentence
        )}
      </p>
      {hideTotal ? null : (
        <p className="mt-1 text-[26px] font-medium tabular-nums tracking-[-0.02em] text-ink">
          <MorphMoney
            value={total}
            masked={masked}
            disabled={!animate}
            duration={morphDuration}
          />
        </p>
      )}
      {bar.some((s) => s.pct > 0) ? (
        <div
          className="mt-3 flex h-9 gap-1"
          role="group"
          aria-label="Allocation"
        >
          {bar.map((s) => (
            <AllocationSegmentButton
              key={s.name}
              segment={s}
              selected={selected === s.name}
              onSelect={() => onSelect(s.name)}
              steady={steadyBar}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default PortfolioHero;
