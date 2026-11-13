"use client";

import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { CopyButton } from "@/components/finance/AddressPill";
import { DepositButton } from "@/components/app/AddressQrDialog";
import { MorphAddress } from "@/components/finance/MorphAddress";
import MorphMoney, {
  MORPH_DURATION,
} from "@/components/finance/MorphMoney";
import type { ChainKind } from "@/lib/wallet/types";

/* ─────────────────────────────────────────────────────────
 * WALLET ADDRESS ROW
 * A section's identity, then its number: the full address as
 * title-style text — never truncated, bright, with tabular
 * figures like every other number on screen. The copy mark sits at
 * the end of the address it copies; the total sits beneath it with
 * the refresh mark to its right, and the Deposit action holds the
 * far edge.
 * ───────────────────────────────────────────────────────── */

function RefreshMark({
  onRefresh,
  refreshing = false,
  disabled = false,
}: {
  onRefresh: () => void;
  refreshing?: boolean;
  disabled?: boolean;
}) {
  // A locked account has no live read to re-run: the control stays in
  // place, dimmed, and never starts a spinner the gate cannot settle.
  const busy = refreshing && !disabled;
  return (
    <button
      type="button"
      title="Refresh balances"
      aria-label="Refresh balances"
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onRefresh}
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink disabled:opacity-40 disabled:pointer-events-none"
    >
      <span className="relative flex size-[22px] shrink-0 items-center justify-center">
        <span
          aria-hidden
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 [&_svg]:shrink-0 ${busy ? "opacity-0" : "opacity-100"}`}
        >
          <IconRefresh size={22} stroke={2} />
        </span>
        <span
          aria-hidden
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ${busy ? "opacity-100" : "opacity-0"}`}
        >
          <IconLoader2 size={22} stroke={2} className="animate-spin" />
        </span>
      </span>
    </button>
  );
}

export function WalletAddressRow({
  address,
  chain,
  qrTitle,
  actionLabel = "Deposit",
  onRefresh,
  refreshing = false,
  refreshDisabled = false,
  total,
  masked = false,
  animate = true,
  morphDuration = MORPH_DURATION,
}: {
  address: string;
  /** The address's chain family, for its explorer link. */
  chain: ChainKind;
  qrTitle: string;
  /** Wallet and super deposit; a watched address is a transfer target. */
  actionLabel?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** The account is locked; the refresh mark stays visible but inert. */
  refreshDisabled?: boolean;
  /** The section total beneath the address. */
  total: number;
  /** Locked state: the total is unknown, so it renders masked. */
  masked?: boolean;
  /** Skeleton and reduced states: plain text, no digit morph. */
  animate?: boolean;
  /** Per-surface timing, matching the hero it replaces. */
  morphDuration?: number;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* The address swaps as one line, from below; the copy mark
          * rides its right edge, close to the text it copies. */}
        <div className="flex min-w-0 items-start">
          <div className="min-w-0">
            <MorphAddress value={address} animate={animate} />
          </div>
          {/* The mark centers on the address's first line, not the block:
            * a wrapped address must not push it to the middle. */}
          <span className="flex h-[21px] shrink-0 items-center">
            <CopyButton value={address} size={16} tone="ink" />
          </span>
        </div>
        {/* The total sits under the address; the refresh mark follows it
          * on the right, in a fixed 22px slot for both states. */}
        <div className="flex min-w-0 items-center gap-2">
          <p className="shrink-0 text-[36px] font-medium tabular-nums tracking-[-0.02em] text-ink">
            <MorphMoney
              value={total}
              masked={masked}
              disabled={!animate}
              duration={morphDuration}
            />
          </p>
          {onRefresh ? (
            <RefreshMark
              onRefresh={onRefresh}
              refreshing={refreshing}
              disabled={refreshDisabled}
            />
          ) : null}
        </div>
      </div>
      <DepositButton
        address={address}
        title={qrTitle}
        chain={chain}
        label={actionLabel}
      />
    </div>
  );
}

export default WalletAddressRow;
