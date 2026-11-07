"use client";

import { Liveline, type LivelinePoint } from "liveline";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/* Same theme probe as the insight cards: liveline paints a canvas, so it
 * needs the resolved theme rather than a CSS variable. */
function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const digits = Math.abs(value) >= 1 ? 2 : 4;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export type TokenPriceChartProps = {
  /** 24-hour price history. Empty is the honest no-data state for now. */
  points?: LivelinePoint[];
  /** Optional pre-computed change; otherwise derived from the points. */
  changePct?: number | null;
  className?: string;
};

/**
 * The 24-hour line in the token hover card.
 *
 * The chart is the same `Liveline` setup the insight cards use for the
 * “High freezer spend” card: paused, no fill, no pulse, a thin line and a
 * crosshair cursor. When `points` is empty, Liveline draws its built-in
 * empty state — a grey line and “No data to display” — which is exactly
 * the fallback before a price-history feed exists.
 */
export function TokenPriceChart({
  points = [],
  changePct,
  className,
}: TokenPriceChartProps) {
  const dark = useDarkMode();
  const hasData = points.length > 1;
  const last = points.at(-1)?.value ?? 0;
  const first = points[0]?.value ?? last;
  const derived =
    hasData && first !== 0 ? ((last - first) / first) * 100 : null;
  const change = hasData ? (changePct ?? derived) : null;
  const color =
    change == null
      ? "#3d9aff"
      : change >= 0
        ? "#22c55e"
        : "#ef4444";

  return (
    <div className={cn("relative mt-2", className)}>
      {change != null ? (
        <span
          className={cn(
            "pointer-events-none absolute left-0 top-0 z-10 text-[11px] font-medium tabular-nums",
            change >= 0 ? "text-green" : "text-red",
          )}
        >
          {change >= 0 ? "+" : ""}
          {change.toFixed(2)}%
        </span>
      ) : null}
      <span className="pointer-events-none absolute right-0 top-0 z-10 text-[11px] text-ink-3">
        24h
      </span>
      <div
        className="h-[84px]"
        role="img"
        aria-label={
          hasData
            ? "24 hour price chart"
            : "24 hour price chart. No data to display."
        }
      >
        <Liveline
          data={hasData ? points : []}
          value={hasData ? last : 0}
          theme={dark ? "dark" : "light"}
          color={color}
          grid={false}
          scrub={false}
          fill={false}
          pulse={false}
          momentum={false}
          paused
          window={24 * 60 * 60}
          lineWidth={2}
          cursor="crosshair"
          showValue={false}
          padding={{ top: 16, right: 0, bottom: 4, left: 0 }}
          formatValue={formatPrice}
          emptyText="No data to display"
        />
      </div>
    </div>
  );
}

export default TokenPriceChart;
