"use client";

/**
 * A prototype of the quote card.
 *
 * The numbers on here are the ones a user needs in order to decide, and the
 * question this prototype is answering is whether the contract id earns its
 * place under the ticker.
 */
export default function QuotePreview({ variant }: { variant?: string }) {
  const compact = variant === "Compact";

  return (
    <div className="w-[340px] rounded-[10px] border border-line bg-surface p-3.5 shadow-card">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-ink-2">You receive</span>
        <span className="font-mono text-[15px] tabular-nums text-ink">
          18.7399 NEAR
        </span>
      </div>

      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-[13px] text-ink-2">At least</span>
        <span className="font-mono text-[13px] tabular-nums text-ink-3">
          18.5525 NEAR
        </span>
      </div>

      {compact ? null : (
        <>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[13px] text-ink-2">Rate</span>
            <span className="font-mono text-[13px] tabular-nums text-ink-3">
              5.336 USDC per NEAR
            </span>
          </div>

          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[13px] text-ink-2">Fee</span>
            <span className="font-mono text-[13px] tabular-nums text-ink-3">
              0.20%
            </span>
          </div>
        </>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
        <span className="text-[12.5px] text-ink-3">Price held for</span>
        <span className="text-[12.5px] tabular-nums text-ink-2">
          41 minutes
        </span>
      </div>

      <p className="mt-2 truncate font-mono text-[10.5px] text-ink-3">
        nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1
      </p>
    </div>
  );
}
