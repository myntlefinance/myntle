"use client";

import { useState } from "react";
import { IconBuildingBridge } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { TokenAvatar } from "@/components/finance/TokenAvatar";

/**
 * Bridge execution prototype.
 *
 * A bridge is a same-ticker move across chains through a normal 1Click
 * EXACT_INPUT quote — no special endpoint, the pair just shares a symbol
 * on two asset ids. Nothing here executes; the figures are sample data.
 */

type Variant = "Awaiting" | "Settled";

const COPY: Record<Variant, { pill: "orange" | "green"; pillText: string; foot: string }> = {
  Awaiting: { pill: "orange", pillText: "Pending", foot: "Sign once in wallet" },
  Settled: { pill: "green", pillText: "Executed", foot: "Transaction success." },
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

export default function BridgeCard({ variant }: { variant?: string }) {
  const state = (variant ?? "Awaiting") as Variant;
  const copy = COPY[state] ?? COPY.Awaiting;
  const decided = state !== "Awaiting";
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad" style={{ paddingBottom: 10 }}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
            <IconBuildingBridge size={15} stroke={2} className="shrink-0 text-ink-2" />
            <span className="truncate">Bridge</span>
          </span>
          <StatusPill tone={copy.pill}>{copy.pillText}</StatusPill>
        </div>
      </div>

      <div className="border-t border-line" aria-hidden="true" />

      <div className="primitive-card-pad" style={{ paddingTop: 10, paddingBottom: 6 }}>
        <div className="flex flex-col gap-2.5">
          <Leg
            label="You send"
            symbol="USDC"
            badge="eth"
            amount="100.0"
            sub="≈ $100.00"
            place="Ethereum"
          />
          <Leg
            label="You receive"
            symbol="USDC"
            badge="base"
            amount="99.92"
            sub="≈ $99.92"
            place="Base"
          />
        </div>

        <div className="mt-4">
          <DetailRow label="Minimum received">99.82 USDC</DetailRow>
          <DetailRow label="Recipient">
            <span className="truncate">0x3259…1073</span>
          </DetailRow>
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
            <DetailRow label="Route">Same ticker, two asset ids</DetailRow>
            <DetailRow label="Channel">Origin-chain deposit address</DetailRow>
            <DetailRow label="Slippage">1.00%</DetailRow>
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
          {decided ? (
            <span className="truncate text-xs text-ink-2">{copy.foot}</span>
          ) : (
            <>
              <Button variant="secondary" size="sm">
                Reject
              </Button>
              <Button variant="accent" size="sm">
                Approve
              </Button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
