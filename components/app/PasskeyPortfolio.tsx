"use client";

import type { ReactNode } from "react";
import { IconLock } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { AssetMatrix } from "@/components/finance/AssetMatrix";
import { openSuperUnlock } from "@/components/app/SuperUnlockDialog";
import { usePasskeyPortfolio } from "./portfolioQueries";
import type { PortfolioSnapshot } from "./portfolioCache";
import type { PasskeyPortfolioStatus } from "./passkeyPortfolioData";

/* ─────────────────────────────────────────────────────────
 * PASSKEY PORTFOLIO
 * The confidential ledger is the whole portfolio for a passkey
 * account. Locked, empty, and unreadable are separate states, and
 * only the locked one has an action. The unlock dialog itself is
 * mounted once by AccountControl in the footer.
 * ───────────────────────────────────────────────────────── */

function StateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
      {children}
    </div>
  );
}

function money(value: number): string {
  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

export function PasskeyPortfolioBody({
  status,
  snapshot,
  onUnlock,
  onRetry,
}: {
  status: PasskeyPortfolioStatus | "pending";
  snapshot: PortfolioSnapshot | null;
  onUnlock: () => void;
  onRetry?: () => void;
}) {
  if (status === "pending") {
    return (
      <StateFrame>
        <p className="text-[13.5px] leading-relaxed text-ink-3">
          Reading your private balance.
        </p>
      </StateFrame>
    );
  }

  if (status === "locked") {
    return (
      <StateFrame>
        <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
          <IconLock size={18} stroke={1.7} aria-hidden />
        </span>
        <p className="mt-3 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
          Your private balance is locked.
        </p>
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={onUnlock}
          className="mt-4"
        >
          Unlock
        </Button>
      </StateFrame>
    );
  }

  if (status === "empty") {
    return (
      <StateFrame>
        <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
          Your private balance is empty. Ask the assistant to deposit.
        </p>
      </StateFrame>
    );
  }

  if (status === "error" || !snapshot) {
    return (
      <StateFrame>
        <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
          The private balance service is unavailable. Try again later.
        </p>
        {onRetry ? (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onRetry}
            className="mt-4"
          >
            Try again
          </Button>
        ) : null}
      </StateFrame>
    );
  }

  return (
    <>
      <p className="mb-4 text-[13.5px] leading-relaxed text-ink">
        Your private balance totals{" "}
        <strong className="font-semibold tabular-nums">
          {money(snapshot.totalUsd)}
        </strong>
        .
      </p>
      <AssetMatrix
        groups={snapshot.groups}
        title="Private balance"
        totalValueUsd={snapshot.totalUsd}
      />
    </>
  );
}

export function PasskeyPortfolio({ accountId }: { accountId: string }) {
  const portfolio = usePasskeyPortfolio(accountId, true);

  return (
    <PasskeyPortfolioBody
      status={portfolio.status}
      snapshot={portfolio.snapshot}
      onUnlock={() => openSuperUnlock()}
      onRetry={() => void portfolio.refresh()}
    />
  );
}

export default PasskeyPortfolio;
