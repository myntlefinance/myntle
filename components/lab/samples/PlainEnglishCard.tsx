"use client";

import { useState } from "react";
import { IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { TokenAvatar } from "@/components/finance/TokenAvatar";
import { NetworkIcon } from "@/components/finance/NetworkIcon";

/**
 * Plain English trade sentence prototype.
 *
 * The same approval, rendered as one sentence the reader can say aloud
 * instead of a swap ticket. Every highlighted span is a deterministic chip
 * built from the signed parameters, never from model text, so the sentence
 * cannot drift from what the wallet signs. Figures are sample data.
 */

type Variant = "Deposit" | "Swap" | "Limit order";

/* Chips are inline-block so the label stays in normal text flow and keeps
 * the sentence baseline exactly; only the icon is lifted with align-middle.
 * (An inline-flex pill centers its content in the pill box instead, which
 * drops the text below the baseline.) */
/* Token icon with a deliberately small network badge: 7px on an 18px token
 * with a 1px ring (≈25% area coverage), against TokenAvatar's built-in 10px
 * badge with a 2px ring (≈60%). Local to the prototype; if this wins, the
 * production change is the badgeSize ratio and ring in TokenAvatar. */
function TokenWithBadge({
  symbol,
  badge,
}: {
  symbol: string;
  badge?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className="relative mr-[0.4em] inline-block align-middle"
      style={{ width: 18, height: 18 }}
    >
      <TokenAvatar symbol={symbol} size={18} />
      {badge ? (
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex rounded-full ring-1 ring-surface">
          <NetworkIcon network={badge} size={7} />
        </span>
      ) : null}
    </span>
  );
}
function TokenChip({
  symbol,
  badge,
}: {
  symbol: string;
  badge?: string;
}) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-baseline font-medium leading-none text-ink">
      <TokenWithBadge symbol={symbol} badge={badge} />
      {symbol}
    </span>
  );
}

function VenueChip({ label }: { label: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-baseline font-medium leading-none text-ink">
      <span aria-hidden="true" className="mr-[0.4em] inline-block align-middle">
        <NetworkIcon network="near" size={18} />
      </span>
      {label}
    </span>
  );
}

function WalletChip({ label }: { label: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-field px-[0.7em] py-[0.25em] align-baseline font-medium leading-none text-ink">
      <span aria-hidden="true" className="mr-[0.4em] inline-block align-middle">
        <IconWallet
          size={14}
          stroke={2}
          aria-hidden="true"
          className="text-ink-2"
        />
      </span>
      {label}
    </span>
  );
}

function Amount({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold tabular-nums text-ink">{children}</strong>
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

const swapSentence = (
  <>
    Swap <Amount>55</Amount> <TokenChip symbol="USDT" badge="near" />{" "}
    for <Amount>0.05</Amount> <TokenChip symbol="ETH" badge="near" /> on{" "}
    <VenueChip label="Near Intents" />
  </>
);

const swapDetails = (
  <>
    <DetailRow label="Minimum received">0.0495 ETH</DetailRow>
    <DetailRow label="Fee">$0.12</DetailRow>
    <DetailRow label="Price held until">2:04:31 PM</DetailRow>
    <DetailRow label="Rate">1 USDT ≈ 0.000909 ETH</DetailRow>
    <DetailRow label="Slippage">1.00%</DetailRow>
    <DetailRow label="Destination">
      <span className="truncate">0x3259…1073</span>
    </DetailRow>
  </>
);

/* Clickable demo: the same swap sentence with a live footer. Approve or
 * Reject swaps the buttons for the badge; clicking the badge replays.
 * Demo-only wiring — production state comes from the approval record. */
function InteractiveDemo() {
  const [demoState, setDemoState] = useState<
    "awaiting" | "approved" | "rejected"
  >("awaiting");
  return (
    <SentenceCard
      state={demoState}
      sentence={swapSentence}
      details={swapDetails}
      onApprove={() => setDemoState("approved")}
      onReject={() => setDemoState("rejected")}
      onReset={() => setDemoState("awaiting")}
    />
  );
}

function SentenceCard({
  sentence,
  details,
  state,
  onApprove,
  onReject,
  onReset,
}: {
  sentence: React.ReactNode;
  details: React.ReactNode;
  state: "awaiting" | "approved" | "rejected" | "expired";
  onApprove?: () => void;
  onReject?: () => void;
  /** Demo-only: clicking the decided badge returns to awaiting. */
  onReset?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pill =
    state === "approved"
      ? { tone: "accent", label: "Approved" }
      : state === "rejected"
        ? { tone: "red", label: "Rejected" }
        : { tone: "red", label: "Expired" };

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div
        className="primitive-card-pad"
        style={{ paddingTop: 14, paddingBottom: 14 }}
      >
        {/* A div, not a p: TokenAvatar and NetworkIcon render div roots,
            which cannot descend from a paragraph without a hydration error. */}
        <div className="text-[15px] leading-[2] text-ink [text-wrap:pretty]">
          {sentence}
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
            {details}
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
        <span
          key={state}
          className="-mr-0.5 flex min-w-0 items-center gap-2"
          style={{
            animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both",
          }}
        >
          {state === "awaiting" ? (
            <>
              <Button variant="secondary" size="sm" onClick={onReject}>
                Reject
              </Button>
              <Button variant="accent" size="sm" onClick={onApprove}>
                Approve
              </Button>
            </>
          ) : onReset ? (
            <button
              type="button"
              onClick={onReset}
              title="Replay the decision"
              aria-label="Show the approval buttons again"
              className="cursor-pointer rounded-full"
            >
              <StatusPill tone={pill.tone as "accent" | "red"}>
                {pill.label}
              </StatusPill>
            </button>
          ) : (
            <StatusPill tone={pill.tone as "accent" | "red"}>
              {pill.label}
            </StatusPill>
          )}
        </span>
      </div>
    </div>
  );
}

export default function PlainEnglishCard({ variant }: { variant?: string }) {
  const [actionRaw, stateRaw] = (variant ?? "Deposit").split(" — ");
  const action = (actionRaw || "Deposit") as Variant;
  const lowered = (stateRaw || "awaiting").toLowerCase();
  const state =
    lowered === "approved" ||
    lowered === "rejected" ||
    lowered === "expired"
      ? lowered
      : "awaiting";

  if (actionRaw === "Clickable") {
    return <InteractiveDemo />;
  }

  if (action === "Swap") {
    return (
      <SentenceCard
        state={state}
        sentence={swapSentence}
        details={swapDetails}
      />
    );
  }

  if (action === "Limit order") {
    return (
      <SentenceCard
        state={state}
        sentence={
          <>
            Buy <Amount>0.5</Amount> <TokenChip symbol="ETH" badge="near" />{" "}
            with <TokenChip symbol="USDC" badge="near" /> when one ETH costs{" "}
            <Amount>$2,900</Amount>
          </>
        }
        details={
          <>
            <DetailRow label="Most you can spend">1,450 USDC</DetailRow>
            <DetailRow label="Good until">Cancelled by you</DetailRow>
            <DetailRow label="Settles on">
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="inline-flex">
                  <NetworkIcon network="near" size={12} />
                </span>
                Near Intents
              </span>
            </DetailRow>
            <DetailRow label="Fills">Partial fills allowed</DetailRow>
            <DetailRow label="Cancel">Any time, no fee</DetailRow>
            <DetailRow label="Destination">
              <span className="truncate">0x3259…1073</span>
            </DetailRow>
          </>
        }
      />
    );
  }

  return (
    <SentenceCard
      state={state}
      sentence={
        <>
          Send <Amount>2</Amount> <TokenChip symbol="USDC" badge="arb" /> from{" "}
          <WalletChip label="0x3259…1073" /> to <VenueChip label="Near Intents" />
        </>
      }
      details={
        <>
          <DetailRow label="Arrives as">2.0 USDC on Near</DetailRow>
          <DetailRow label="Cost">1 yoctoNEAR + ~100 TGas</DetailRow>
          <DetailRow label="Recipient">alice.near</DetailRow>
          <DetailRow label="Method">ft_transfer_call → intents.near</DetailRow>
          <DetailRow label="Ownership">Sender, unless msg names another</DetailRow>
          <DetailRow label="Native NEAR">Wrap to wNEAR first</DetailRow>
        </>
      }
    />
  );
}
