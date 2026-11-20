import type { LivelinePoint } from "liveline";
import { cn } from "@/lib/utils";

/* The chart's own coordinate box. The line is drawn at this resolution and
 * stretched to the card's width, so its stroke stays at 2px at any size. */
const VIEW_W = 1000;
const CHART_H = 84;
const PAD_TOP = 16;
const PAD_BOTTOM = 4;
/** The 24 hours the line covers, ending at the newest observation. */
const WINDOW_SECS = 24 * 60 * 60;
/** The headroom Liveline keeps at the right edge when no badge is drawn. */
const EDGE_HEADROOM = 0.015;

type Chart = {
  path: string;
  /** Where the line ends, as a percentage of the card's width. */
  lastXPct: number;
  /** The last value's vertical position in the chart's 84px box. */
  lastY: number;
};

/**
 * The 24-hour line in the token hover card.
 *
 * The chart is static: it draws its final frame on mount, with no reveal
 * animation and no value badge. It is the same line the insight cards show
 * through Liveline, but a hover card appears and disappears under the
 * pointer, and a chart that redraws itself on every hover is motion the
 * person did not ask for. The curve is the same monotone cubic Liveline
 * uses, so the chart is unchanged once it is on screen.
 */
export function TokenPriceChart({
  points = [],
  changePct,
  className,
}: {
  /** 24-hour price history. Empty is the honest no-data state for now. */
  points?: LivelinePoint[];
  /** Optional pre-computed change; otherwise derived from the points. */
  changePct?: number | null;
  className?: string;
}) {
  const ordered = points
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
  const hasData = ordered.length > 1;
  const last = ordered.at(-1)?.value ?? 0;
  const first = ordered[0]?.value ?? last;
  const derived =
    hasData && first !== 0 ? ((last - first) / first) * 100 : null;
  const chart = hasData ? chartGeometry(ordered) : null;
  const change = chart ? (changePct ?? derived) : null;
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
        className="relative"
        style={{ height: CHART_H }}
        role="img"
        aria-label={
          chart
            ? "24 hour price chart"
            : "24 hour price chart. No data to display."
        }
      >
        {chart ? (
          <>
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${VIEW_W} ${CHART_H}`}
              preserveAspectRatio="none"
              fill="none"
              aria-hidden="true"
            >
              <path
                d={chart.path}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {/* The current-value line, drawn as a stripe so its 4px dashes
             * do not stretch with the SVG's wide coordinate box. */}
            <div
              className="pointer-events-none absolute inset-x-0 h-px"
              style={{
                top: chart.lastY,
                backgroundImage: `repeating-linear-gradient(to right, ${color}66 0 4px, ${color}00 4px 8px)`,
              }}
            />
            {/* Liveline fades the line's first 40px into the surface; the
             * same fade keeps the curve from starting on a hard edge. */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-surface to-transparent" />
            <span
              className="pointer-events-none absolute size-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface"
              style={{ left: `${chart.lastXPct}%`, top: chart.lastY }}
            >
              <span
                className="absolute left-1/2 top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ backgroundColor: color }}
              />
            </span>
          </>
        ) : (
          <div className="relative flex h-full items-center justify-center">
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-3/35" />
            <span className="relative bg-surface px-2 text-[11px] text-ink-3">
              No data to display
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Map the points into the chart box and join them with the monotone cubic
 * Liveline uses (Fritsch-Carlson, so the curve cannot overshoot a local
 * min or max). */
function chartGeometry(points: readonly LivelinePoint[]): Chart | null {
  const last = points.at(-1);
  if (!last) return null;
  const rightEdge = last.time + WINDOW_SECS * EDGE_HEADROOM;
  const leftEdge = rightEdge - WINDOW_SECS;
  const visible = points.filter((p) => p.time >= leftEdge);
  if (visible.length < 2) return null;

  let min = last.value;
  let max = last.value;
  for (const p of visible) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  const raw = max - min;
  const minRange = raw * 0.1 || 0.4;
  if (raw < minRange) {
    const mid = (min + max) / 2;
    min = mid - minRange / 2;
    max = mid + minRange / 2;
  } else {
    const margin = raw * 0.12;
    min -= margin;
    max += margin;
  }

  const chartH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const toX = (time: number) => ((time - leftEdge) / WINDOW_SECS) * VIEW_W;
  const toY = (value: number) =>
    PAD_TOP + (1 - (value - min) / (max - min)) * chartH;
  const xy = visible.map((p) => ({ x: toX(p.time), y: toY(p.value) }));
  const lastX = xy[xy.length - 1]?.x ?? 0;

  return {
    path: monotonePath(xy),
    lastXPct: (lastX / VIEW_W) * 100,
    lastY: toY(last.value),
  };
}

function monotonePath(points: readonly { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${n(points[0].x)},${n(points[0].y)}L${n(points[1].x)},${n(points[1].y)}`;
  }
  const count = points.length;
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    h[i] = points[i + 1].x - points[i].x;
    delta[i] = h[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / h[i];
  }
  const m: number[] = new Array(count).fill(0);
  m[0] = delta[0];
  m[count - 1] = delta[count - 2];
  for (let i = 1; i < count - 1; i += 1) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  for (let i = 0; i < count - 1; i += 1) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / delta[i];
      const beta = m[i + 1] / delta[i];
      const magnitude = alpha * alpha + beta * beta;
      if (magnitude > 9) {
        const scale = 3 / Math.sqrt(magnitude);
        m[i] = scale * alpha * delta[i];
        m[i + 1] = scale * beta * delta[i];
      }
    }
  }
  let d = `M${n(points[0].x)},${n(points[0].y)}`;
  for (let i = 0; i < count - 1; i += 1) {
    const step = h[i];
    d +=
      `C${n(points[i].x + step / 3)},${n(points[i].y + (m[i] * step) / 3)} ` +
      `${n(points[i + 1].x - step / 3)},${n(points[i + 1].y - (m[i + 1] * step) / 3)} ` +
      `${n(points[i + 1].x)},${n(points[i + 1].y)}`;
  }
  return d;
}

/** One decimal is a fifth of a pixel at this width. */
function n(value: number): number {
  return Math.round(value * 10) / 10;
}

export default TokenPriceChart;
