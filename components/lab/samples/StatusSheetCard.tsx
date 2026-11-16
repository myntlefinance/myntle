"use client";

import { useState } from "react";
import {
  IconAlertSquareRoundedFilled,
  IconRosetteDiscountCheckFilled,
} from "@tabler/icons-react";
import { Button, buttonVariants } from "@/components/atoms/Button";
import { TokenChip } from "@/components/finance/TokenChip";
import { TokenAvatar } from "@/components/finance/TokenAvatar";
import { NetworkIcon } from "@/components/finance/NetworkIcon";

/**
 * Terminal status sheet prototype.
 *
 * The sentence on top, the record drawer in the middle, and the outcome
 * as a one-line drawer-styled strip: rounded top corners, a tonal edge,
 * and an upward shadow. The drawer look is purely visual — the strip is
 * static layout, not an interactive panel — and the footer below carries
 * the record controls.
 *
 * Success — the transfer was seen and credited.
 * Failed  — settlement failed on chain. Nothing was credited.
 * Error   — the action could not finish. Nothing was moved.
 */

type Variant = "Success" | "Failed" | "Error";

const COPY: Record<
  Variant,
  { body: string; tone: "green" | "red"; href: string | null }
> = {
  Success: {
    body: "Your deposit was detected and credited to your account.",
    tone: "green",
    href: "https://explorer.near-intents.org/mask/0x8f3a91c2",
  },
  Failed: {
    body: "Nothing was credited. The record has the details.",
    tone: "red",
    href: "https://explorer.near-intents.org/mask/0x8f3a91c2",
  },
  Error: {
    body: "The transfer was seen but the trade did not complete.",
    tone: "red",
    href: null,
  },
};

function StatusMark({
  tone,
  variant,
}: {
  tone: "green" | "red";
  variant: Variant;
}) {
  const Icon =
    variant === "Success"
      ? IconRosetteDiscountCheckFilled
      : IconAlertSquareRoundedFilled;
  return (
    <Icon
      size={18}
      aria-hidden
      className="shrink-0"
      style={{ color: tone === "green" ? "var(--green)" : "var(--red)" }}
    />
  );
}

function RecordRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="py-1 text-xs text-ink-3">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 py-1 text-right text-xs tabular-nums text-ink">
        {children}
      </span>
    </>
  );
}

export default function StatusSheetCard({ variant }: { variant?: string }) {
  const state = (variant ?? "Success") as Variant;
  const copy = COPY[state] ?? COPY.Success;
  const [recordOpen, setRecordOpen] = useState(false);

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div
        className="primitive-card-pad"
        style={{ paddingTop: 14, paddingBottom: 14 }}
      >
        <p className="text-[15px] leading-[2] text-ink [text-wrap:pretty]">
          Deposit <strong className="font-semibold tabular-nums">0.005155</strong>{" "}
          <TokenChip symbol="ETH" badge="eth" /> in your{" "}
          <span className="inline-flex items-center gap-[0.4em] whitespace-nowrap rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-middle font-medium leading-none text-ink">
            <span aria-hidden="true" className="inline-flex shrink-0">
              <NetworkIcon network="near" size={18} />
            </span>
            <span>Myntle account</span>
          </span>
        </p>
      </div>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: recordOpen ? "1fr" : "0fr",
          opacity: recordOpen ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-line bg-surface px-3 py-2">
            <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3">
              <RecordRow label="Token">
                <span className="inline-flex items-center gap-1">
                  <TokenAvatar symbol="ETH" size={14} />
                  ETH
                </span>
              </RecordRow>
              <RecordRow label="Contract address">
                <span
                  className="min-w-0 truncate"
                  title="0x0000000000000000000000000000000000000000"
                >
                  0x0000…0000
                </span>
              </RecordRow>
              <RecordRow label="Network">
                <span className="inline-flex items-center gap-1">
                  <NetworkIcon network="eth" size={14} />
                  Ethereum
                </span>
              </RecordRow>
              <RecordRow label="Valid until">Nov 16, 2026, 12:00 PM UTC</RecordRow>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`primitive-card-footer flex items-center gap-3 bg-surface ${
          copy.href ? "justify-between" : "justify-end"
        }`}
        style={{ paddingTop: 6, paddingBottom: 6 }}
      >
        <span className="-ml-0.5 flex shrink-0 items-center">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={recordOpen}
            onClick={() => setRecordOpen((current) => !current)}
          >
            Details
          </Button>
        </span>
        {copy.href ? (
          <span className="-mr-0.5 flex min-w-0 items-center">
            <a
              href={copy.href}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              View Txn
            </a>
          </span>
        ) : null}
      </div>

      {/* The outcome strip: a one-line status at the very bottom. The
          footer above carries the record controls. */}
      <div
        className="mt-1.5 rounded-t-card border-t"
        style={{
          background:
            copy.tone === "green"
              ? "color-mix(in oklch, var(--green) 12%, var(--surface))"
              : "color-mix(in oklch, var(--red) 12%, var(--surface))",
          borderColor:
            copy.tone === "green"
              ? "color-mix(in oklch, var(--green) 28%, transparent)"
              : "color-mix(in oklch, var(--red) 28%, transparent)",
          boxShadow: "0 -12px 32px -16px oklch(0 0 0 / 0.3)",
        }}
      >
        <div className="px-3 pt-2.5 pb-2.5">
          <div className="flex items-center gap-2">
            <StatusMark tone={copy.tone} variant={state} />
            <p className="min-w-0 flex-1 text-xs font-medium text-ink">{copy.body}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
