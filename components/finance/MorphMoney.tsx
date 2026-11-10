"use client";

import type { CSSProperties, ElementType } from "react";
import { TextMorph } from "torph/react";

/* ─────────────────────────────────────────────────────────
 * MORPH MONEY
 * The single place a visually important total is rendered.
 * Torph morphs the digits by place value on the product's
 * strong ease-out, so a refreshed balance glides instead of
 * cutting. The masked and skeleton states never animate, and
 * reduced motion falls back to plain text by default.
 * ───────────────────────────────────────────────────────── */

/** The shared USD rendering, kept here so the hero total and
 * its sentence never drift apart. */
export function formatMoney(n: number): string {
  return `$${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const MASKED_MONEY = "$••••••";

/** The hero ease, matching --ease-out-strong in app/globals.css. */
export const MORPH_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

/** The shared morph timing, so hero totals and table numbers glide alike. */
export const MORPH_DURATION = 350;

export function MorphNumber({
  children,
  className,
  style,
  as = "span",
  disabled = false,
  duration = MORPH_DURATION,
}: {
  /** The rendered number text; only changes after mount animate. */
  children: string;
  className?: string;
  style?: CSSProperties;
  as?: ElementType;
  /** Forces the plain rendering, skipping the morph. */
  disabled?: boolean;
  /** Per-surface timing; the shared hero timing by default. */
  duration?: number;
}) {
  const Tag = as;
  if (disabled) {
    return (
      <Tag className={className} style={style}>
        {children}
      </Tag>
    );
  }
  return (
    <TextMorph
      as={as}
      className={className}
      style={style}
      duration={duration}
      ease={MORPH_EASE}
      numbers
      respectReducedMotion
    >
      {children}
    </TextMorph>
  );
}

export default function MorphMoney({
  value,
  masked = false,
  disabled = false,
  className,
  style,
  as = "span",
  duration = MORPH_DURATION,
}: {
  /** The total in dollars; only changes after mount animate. */
  value: number;
  /** Locked state: the total is unknown, so it renders masked. */
  masked?: boolean;
  /** Forces the plain rendering, skipping the morph. */
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  as?: ElementType;
  /** Per-surface timing; the shared hero timing by default. */
  duration?: number;
}) {
  const Tag = as;
  // Torph paints the first value instantly and only morphs later updates.
  // The masked and real totals share one mounted TextMorph so unredacting
  // morphs both ways; swapping to a plain node on lock would cut the
  // redacted value in and never let it morph back out.
  if (disabled) {
    return (
      <Tag className={className} style={style}>
        {masked ? MASKED_MONEY : formatMoney(value)}
      </Tag>
    );
  }
  return (
    <TextMorph
      as={as}
      className={className}
      style={style}
      duration={duration}
      ease={MORPH_EASE}
      numbers
      respectReducedMotion
    >
      {masked ? MASKED_MONEY : formatMoney(value)}
    </TextMorph>
  );
}
