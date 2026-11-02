"use client";

import { useState } from "react";
import { IconArrowsExchange } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { TokenAvatar } from "@/components/finance/TokenAvatar";

/**
 * Limit order execution prototype.
 *
 * A LIMIT order rests at the user's price through POST /v0/orders (SELL
 * commits the base, BUY commits the quote side). Partial fills allowed,
 * GTC, seven-day default deadline, asynchronous cancel. Requires a
 * partner key in production, so this card is lab-only for now.
 * Nothing here executes; the figures are sample data.
 */

type Variant = "Open" | "Partially filled" | "Filled";

const COPY: Record<
  Variant,
  {
    pill: "accent" | "green";
    pillText: string;
    filledPct: number;
    filledLabel: string;
    foot: string;
  }
> = {
  Open: {
    pill: "accent",
    pillText: "Approved",
    filledPct: 0,
    filledLabel: "0 of 1 wNEAR filled",
    foot: "Transaction pending.",
  },
  "Partially filled": {
    pill: "accent",
    pillText: "Approved",
    filledPct: 40,
    filledLabel: "0.4 of 1 wNEAR filled",
    foot: "Transaction pending.",
  },
  Filled: {
    pill: "green",
    pillText: "Executed",
    filledPct: 100,
    filledLabel: "1 of 1 wNEAR filled",
    foot: "Transaction success.",
  },
};

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-ink-3">{label}</span>
      <span className="min-w-0 text-right text-xs tabular-nums text-ink">
        {children}
      </span>
    </div>
  );
}

export default function LimitOrderCard({ variant }: { variant?: string }) {
  const state = (variant ?? "Open") as Variant;
  const copy = COPY[state] ?? COPY.Open;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const filled = state === "Open";

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad" style={{ paddingBottom: 10 }}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
            <IconArrowsExchange size={15} stroke={2} className="shrink-0 text-ink-2" />
            <span className="truncate">Trade</span>
          </span>
          <StatusPill tone={copy.pill}>{copy.pillText}</StatusPill>
        </div>
      </div>

      <div className="border-t border-line" aria-hidden="true" />

      <div className="primitive-card-pad" style={{ paddingTop: 10, paddingBottom: 6 }}>
        <div className="flex items-center gap-2.5">
          <TokenAvatar symbol="wNEAR" networkBadge="near" size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-3xl font-semibold tabular-nums leading-[1.15] text-ink">
              1.0
            </p>
            <p className="mt-0.5 truncate text-xs tabular-nums text-ink-3">
              SELL at 5.00 USDC
            </p>
          </div>
          <div className="w-[52px] shrink-0">
            <p className="truncate text-sm font-medium text-ink">wNEAR</p>
            <p className="truncate text-xs text-ink-3">Near</p>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-xs text-ink-3">Filled</span>
            <span className="text-xs tabular-nums text-ink">{copy.filledLabel}</span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-field"
            role="progressbar"
            aria-valuenow={copy.filledPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-green transition-[width] duration-500"
              style={{ width: `${copy.filledPct}%` }}
            />
          </div>
        </div>

        <div className="mt-2">
          <DetailRow label="Payout">5.00 USDC to 0x3259…1073</DetailRow>
        </div>
      </div>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: detailsOpen ? "1fr" : "0fr",
          opacity: detailsOpen ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-line bg-surface px-3.5 py-2">
            <DetailRow label="Side">SELL base for quote</DetailRow>
            <DetailRow label="Deadline">7 days, then unfilled refunds</DetailRow>
            <DetailRow label="Cancel">Async; a last slice can still fill</DetailRow>
          </div>
        </div>
      </div>

      <div
        className="primitive-card-footer flex items-center justify-between gap-3 bg-surface"
        style={{ paddingTop: 6, paddingBottom: 6 }}
      >
        <span className="-ml-0.5 flex shrink-0 items-center">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((current) => !current)}
            className="px-2.5 text-xs"
          >
            Details
          </Button>
        </span>
        <span className="-mr-0.5 flex min-w-0 items-center gap-2">
          {filled ? (
            <Button variant="secondary" size="sm">
              Cancel
            </Button>
          ) : (
            <span className="truncate text-xs text-ink-2">{copy.foot}</span>
          )}
        </span>
      </div>
    </div>
  );
}
