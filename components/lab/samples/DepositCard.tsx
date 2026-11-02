"use client";

import { useState } from "react";
import {
  IconArrowBarDown,
  IconCheck,
  IconCopy,
} from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { TokenAvatar } from "@/components/finance/TokenAvatar";

/**
 * Deposit execution prototype.
 *
 * A deposit moves tokens from a wallet into the intents.near ledger with
 * ft_transfer_call (NEP-141), nft_transfer_call (NEP-171), or
 * mt_batch_transfer_call (NEP-245). Native NEAR must be wrapped first.
 * Nothing here executes; the figures are sample data.
 */

type Variant = "Awaiting" | "Settling" | "Settled";

const COPY: Record<
  Variant,
  {
    pill: "orange" | "accent" | "green";
    pillText: string;
    foot: string;
    depositLine?: string;
  }
> = {
  Awaiting: {
    pill: "orange",
    pillText: "Pending",
    foot: "Sign once in wallet",
  },
  Settling: {
    pill: "accent",
    pillText: "Approved",
    foot: "Watching settlement",
    depositLine: "0x8f3a…91c2",
  },
  Settled: {
    pill: "green",
    pillText: "Executed",
    foot: "Transaction success.",
    depositLine: "0x8f3a…91c2",
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

export default function DepositCard({ variant }: { variant?: string }) {
  const state = (variant ?? "Awaiting") as Variant;
  const copy = COPY[state] ?? COPY.Awaiting;
  const decided = state !== "Awaiting";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad" style={{ paddingBottom: 10 }}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
            <IconArrowBarDown size={15} stroke={2} className="shrink-0 text-ink-2" />
            <span className="truncate">Deposit</span>
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
            badge="arb"
            amount="2.0"
            sub="≈ $2.00"
            place="Arbitrum"
          />
          <Leg
            label="You receive"
            symbol="USDC"
            badge="near"
            amount="2.0"
            sub="≈ $2.00"
            place="Near"
          />
        </div>

        <div className="mt-4">
          <DetailRow label="Method">ft_transfer_call → intents.near</DetailRow>
          <DetailRow label="Recipient">
            <span className="inline-flex min-w-0 items-center">
              <span className="truncate">alice.near</span>
              <button
                type="button"
                aria-label={copied ? "Copied" : "Copy address"}
                onClick={() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="ml-1 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                {copied ? (
                  <IconCheck size={13} stroke={2.6} className="text-green" />
                ) : (
                  <IconCopy size={13} stroke={1.8} />
                )}
              </button>
            </span>
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
            <DetailRow label="Ownership">Sender, unless msg names another</DetailRow>
            <DetailRow label="Cost">1 yoctoNEAR + ~100 TGas</DetailRow>
            <DetailRow label="Native NEAR">Wrap to wNEAR first</DetailRow>
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
