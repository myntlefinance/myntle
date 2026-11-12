"use client";

import { IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { NetworkIcon } from "@/components/finance/NetworkIcon";
import { TokenChip } from "@/components/finance/TokenChip";
import { cn } from "@/lib/utils";

/**
 * The venue pill at a line break.
 *
 * The shipping chip is an inline-flex box, which is atomic: the whole pill
 * moves to the next line. The four states show what the alternatives do.
 *
 * atomic — current behaviour; the pill wraps whole.
 * cloned — an inline box breaks at its space and the browser clones the
 *          rounded ends and padding onto each fragment.
 * sliced — the same break, with the decoration sliced at the inner edges.
 * tall   — one inline-flex box whose label wraps inside it; the capsule stays
 *          whole but becomes two lines tall.
 */

const VARIANTS = [
  "Atomic inline-flex",
  "Inline, cloned",
  "Inline, sliced",
  "Label wraps inside",
] as const;

type Variant = (typeof VARIANTS)[number];

function VenuePill({ variant }: { variant: Variant }) {
  if (variant === "Atomic inline-flex") {
    return (
      <span
        data-venue=""
        className="inline-flex items-center gap-[0.4em] whitespace-nowrap rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-middle font-medium leading-none text-ink"
      >
        <span aria-hidden="true" className="inline-flex shrink-0">
          <NetworkIcon network="near" size={18} />
        </span>
        <span>Near Account</span>
      </span>
    );
  }

  if (variant === "Label wraps inside") {
    return (
      <span
        data-venue=""
        className="inline-flex w-[6.7em] items-center gap-[0.4em] rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-middle font-medium leading-[1.3] text-ink"
      >
        <span aria-hidden="true" className="inline-flex shrink-0">
          <NetworkIcon network="near" size={18} />
        </span>
        <span className="min-w-0">Near Account</span>
      </span>
    );
  }

  return (
    <span
      data-venue=""
      className={cn(
        "rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-middle font-medium leading-none text-ink",
        variant === "Inline, cloned"
          ? "[box-decoration-break:clone]"
          : "[box-decoration-break:slice]",
      )}
    >
      <span
        aria-hidden="true"
        className="mr-[0.4em] inline-block align-middle"
      >
        <NetworkIcon network="near" size={18} />
      </span>
      Near Account
    </span>
  );
}

function AddressPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-[0.4em] whitespace-nowrap rounded-full bg-field px-[0.625em] py-[0.25em] align-middle font-medium leading-none text-ink">
      <span
        aria-hidden="true"
        className="relative -top-[0.1em] inline-flex shrink-0"
      >
        <IconWallet size={18} stroke={2} className="text-ink-2" />
      </span>
      <span>{label}</span>
    </span>
  );
}

function Card({ variant }: { variant: Variant }) {
  return (
    <div
      data-pill-demo={variant}
      className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card"
    >
      <div
        className="primitive-card-pad"
        style={{ paddingTop: 14, paddingBottom: 14 }}
      >
        <div
          data-sentence
          className="text-[15px] leading-[2] text-ink [text-wrap:pretty]"
        >
          Withdraw <strong className="font-semibold tabular-nums text-ink">2.0</strong>{" "}
          <TokenChip symbol="USDC" badge="arb" /> from your{" "}
          <VenuePill variant={variant} /> to <AddressPill label="Ambre" />
        </div>
      </div>
      <div
        className="primitive-card-footer flex items-center justify-between gap-3 bg-surface"
        style={{ paddingTop: 6, paddingBottom: 6 }}
      >
        <span className="-ml-0.5 flex shrink-0 items-center">
          <Button variant="secondary" size="sm" className="px-2.5 text-xs">
            Details
          </Button>
        </span>
        <span className="-mr-0.5 flex min-w-0 items-center gap-2">
          <StatusPill tone="green">Executed</StatusPill>
        </span>
      </div>
    </div>
  );
}

export default function PillWrapping({ variant }: { variant?: string }) {
  const selected =
    VARIANTS.find((candidate) => candidate === variant) ?? VARIANTS[0];
  return <Card variant={selected} />;
}
