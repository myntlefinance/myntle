"use client";

import { useState } from "react";
import { IconArrowsLeftRight } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { TokenAvatar } from "@/components/finance/TokenAvatar";

/**
 * Swap execution prototype, one variant per 1Click swap type.
 *
 * EXACT_INPUT fixes what is sent, EXACT_OUTPUT fixes what must arrive
 * (the input carries a slippage buffer that is refunded), and FLEX_INPUT
 * accepts any deposit inside a band. ANY_INPUT is partner-only and has
 * no card here. Nothing here executes; the figures are sample data.
 */

type Variant = "Exact input" | "Exact output" | "Flex band";

const COPY: Record<
  Variant,
  { receive: string; receiveSub: string; minLabel: string; min: string; note: string }
> = {
  "Exact input": {
    receive: "13.99",
    receiveSub: "≈ $74.60",
    minLabel: "Minimum received",
    min: "13.85 NEAR",
    note: "You commit 14 USDC; the quote returns what arrives.",
  },
  "Exact output": {
    receive: "10.0",
    receiveSub: "≈ $10.00",
    minLabel: "Most you can send",
    min: "14.14 USDC",
    note: "You commit 10 USDT out; the input runs hot so execution is guaranteed.",
  },
  "Flex band": {
    receive: "9.95",
    receiveSub: "≈ $52.99",
    minLabel: "Band",
    min: "0.99 – 1.0 NEAR in, ≥ 9.9 out",
    note: "Any deposit inside the band swaps; below it refunds.",
  },
};

function Leg({
  label,
  symbol,
  badge,
  amount,
  sub,
  place,
}: {
  label: string;
  symbol: string;
  badge?: string;
  amount: string;
  sub?: string;
  place?: string;
}) {
  return (
    <div>
      <p className="text-xs text-ink-3">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-3xl font-semibold tabular-nums leading-[1.15] text-ink">
            {amount}
          </p>
          {sub ? (
            <p className="mt-0.5 truncate text-xs tabular-nums text-ink-3">{sub}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TokenAvatar symbol={symbol} networkBadge={badge} size={32} />
          <div className="w-[52px]">
            <p className="truncate text-sm font-medium text-ink">{symbol}</p>
            {place ? (
              <p className="truncate text-xs text-ink-3">{place}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

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

export default function SwapCard({ variant }: { variant?: string }) {
  const state = (variant ?? "Exact input") as Variant;
  const copy = COPY[state] ?? COPY["Exact input"];
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad" style={{ paddingBottom: 10 }}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
            <IconArrowsLeftRight size={15} stroke={2} className="shrink-0 text-ink-2" />
            <span className="truncate">Swap</span>
          </span>
          <StatusPill tone="orange">Pending</StatusPill>
        </div>
      </div>

      <div className="border-t border-line" aria-hidden="true" />

      <div className="primitive-card-pad" style={{ paddingTop: 10, paddingBottom: 6 }}>
        <div className="flex flex-col gap-2.5">
          <Leg
            label="You send"
            symbol="USDC"
            badge="eth"
            amount="14.0"
            sub="≈ $14.00"
            place="Ethereum"
          />
          <Leg
            label="You receive"
            symbol="NEAR"
            badge="near"
            amount={copy.receive}
            sub={copy.receiveSub}
            place="Near"
          />
        </div>

        <div className="mt-4">
          <DetailRow label={copy.minLabel}>{copy.min}</DetailRow>
          <DetailRow label="Recipient">
            <span className="truncate">0x3259…1073</span>
          </DetailRow>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-3">{copy.note}</p>
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
            <DetailRow label="Rate">1 USDC ≈ 0.9993 NEAR</DetailRow>
            <DetailRow label="Slippage">1.00%</DetailRow>
            <DetailRow label="Channel">Origin-chain deposit address</DetailRow>
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
          <Button variant="secondary" size="sm">
            Reject
          </Button>
          <Button variant="accent" size="sm">
            Approve
          </Button>
        </span>
      </div>
    </div>
  );
}
