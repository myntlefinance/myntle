"use client";

import { useState, type ReactNode } from "react";
import { IconLock } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import {
  PortfolioHero,
  type AllocationGroup,
} from "@/components/finance/PortfolioHero";
import {
  HoldingsTable,
  flattenGroups,
} from "@/components/finance/HoldingsTable";
import { openSuperUnlock } from "@/components/app/SuperUnlockDialog";
import { usePasskeyPortfolio } from "./portfolioQueries";
import type { PortfolioSnapshot } from "./portfolioCache";
import { SAMPLE_PORTFOLIO } from "./portfolioCache";
import type { PasskeyPortfolioStatus } from "./passkeyPortfolioData";

/* ─────────────────────────────────────────────────────────
 * PASSKEY PORTFOLIO
 * The confidential ledger is the whole portfolio for a passkey
 * account. Locked, empty, and unreadable are separate states, and
 * only the locked one has an action. The unlock dialog itself is
 * mounted once by AccountControl in the footer.
 * ───────────────────────────────────────────────────────── */

/** The private side of the sample: what the first paint measures. */
const SAMPLE_PRIVATE: PortfolioSnapshot = {
  groups: SAMPLE_PORTFOLIO.superGroups ?? [],
  totalUsd: SAMPLE_PORTFOLIO.superUsd ?? 0,
  walletGroups: [],
  superGroups: SAMPLE_PORTFOLIO.superGroups ?? [],
  walletUsd: 0,
  superUsd: SAMPLE_PORTFOLIO.superUsd ?? 0,
};

function StateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
      {children}
    </div>
  );
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
  // Bar selection doubles as the table filter; null shows everything.
  const [group, setGroup] = useState<AllocationGroup | null>(null);

  // First read with nothing cached: paint the sample shape at once and
  // revalidate behind it, exactly like the wallet tab does. Never a
  // bare loading line.
  const view =
    snapshot ?? (status === "pending" ? SAMPLE_PRIVATE : null);

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

  if (status === "error" || !view) {
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
    <div className="flex flex-col gap-3">
      <PortfolioHero
        total={view.totalUsd}
        count={flattenGroups(view.superGroups ?? view.groups).length}
        scope="super"
        items={flattenGroups(view.superGroups ?? view.groups)}
        selected={group}
        onSelect={(next) => setGroup((prev) => (prev === next ? null : next))}
      />
      <HoldingsTable groups={view.superGroups ?? view.groups} group={group} />
    </div>
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
