"use client";

import { useRouter } from "next/navigation";
import { Skeleton } from "skullet/react";
import { IconChevronLeft, IconRefresh, IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import SidebarNav from "@/components/primitives/SidebarNav";
import { AccountControl } from "@/components/app/AccountControl";
import { openWalletPicker } from "@/components/app/ConnectGate";
import { PasskeyPortfolio } from "@/components/app/PasskeyPortfolio";
import { AssetMatrix } from "@/components/finance/AssetMatrix";
import { useAuth } from "@/lib/auth/auth-provider";
import { openSignIn } from "@/components/app/SignInDialog";
import { openPasskeyDialog } from "@/components/app/PasskeyDialog";
import { usePasskeysAvailable } from "@/lib/auth/passkey-client";
import {
  useThreads,
  useTrashed,
} from "@/components/app/threadQueries";
import { usePortfolio } from "./portfolioQueries";
import {
  SAMPLE_PORTFOLIO,
  type PortfolioSnapshot,
} from "./portfolioCache";

/* ─────────────────────────────────────────────────────────
 * PORTFOLIO
 * Every holding in one place: the connected wallet beside the
 * NEAR Intents settlement ledger, or the private balance of a
 * passkey account. A wallet reads nothing until it is connected
 * and signed in. A passkey account has no wallet, so it reads its
 * confidential ledger in the browser after its own unlock.
 * ───────────────────────────────────────────────────────── */

function PortfolioBody({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const money = (n: number) =>
    `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  return (
    <>
      <p className="mb-4 text-[13.5px] leading-relaxed text-ink">
        Your holdings total{" "}
        <strong className="font-semibold tabular-nums">
          {money(snapshot.totalUsd)}
        </strong>{" "}
        across your wallet and settlement ledger.
      </p>
      <AssetMatrix
        groups={snapshot.groups}
        title="Portfolio balances"
        totalValueUsd={snapshot.totalUsd}
        emptyMessage="No holdings found."
      />
    </>
  );
}

export default function PortfolioView() {
  const router = useRouter();
  const { data: threads = [] } = useThreads();
  const { data: trashed = [] } = useTrashed();
  const { account, connected, signedIn, status, identity } = useAuth();
  const passkeys = usePasskeysAvailable();
  const passkeyIdentity = identity?.kind === "passkey" ? identity : null;
  const passkeyAccount = passkeyIdentity !== null;
  const accountAddress = account?.address;
  const accountKind = account?.kind;

  const portfolio = usePortfolio(
    accountKind ?? null,
    accountAddress ?? null,
    !passkeyAccount && connected && signedIn,
  );
  const snapshot = portfolio.snapshot;
  const passkeySignIn = !connected && passkeys;

  const signInPrompt = (
    <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
        <IconWallet size={18} stroke={1.7} aria-hidden />
      </span>
      <h2 className="mt-3 text-[15px] font-medium text-ink">
        Portfolio &amp; Balances
      </h2>
      <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
        Please sign-in to view your portfolio and balances.
      </p>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={passkeySignIn ? openPasskeyDialog : openSignIn}
        className="mt-4"
      >
        Sign In
      </Button>
    </div>
  );

  const skeleton = (
    <Skeleton
      id="portfolio"
      data={null}
      sample={SAMPLE_PORTFOLIO}
      label="Reading your balances."
    >
      {(sample) => <PortfolioBody snapshot={sample} />}
    </Skeleton>
  );

  return (
    <main className="flex h-[100dvh] gap-0 bg-canvas p-2.5 text-ink lg:pl-0">
      <SidebarNav
        fill
        className="hidden lg:flex"
        recents={threads.map((t) => ({ id: t.id, label: t.label ?? "New chat" }))}
        onPick={(id) => router.push(`/chat/${encodeURIComponent(id)}`)}
        onNewChat={() => router.push("/")}
        onOpenPortfolio={() => router.push("/portfolio")}
        portfolioActive
        onOpenHistory={() => router.push("/history")}
        trashCount={trashed.length}
        onOpenTrash={() => router.push("/trash")}
        footer={<AccountControl />}
        footerCompact={<AccountControl compact />}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
          <header className="shrink-0 border-b border-line px-4 pb-2.5 pt-3">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  aria-label="Back to chat"
                  className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink lg:hidden"
                >
                  <IconChevronLeft size={16} stroke={2} />
                </button>
                <span className="flex size-5 shrink-0 items-center justify-center text-ink-3">
                  <IconWallet size={17} stroke={1.7} />
                </span>
                <h1 className="truncate text-[14px] font-medium text-ink">
                  Portfolio
                </h1>
              </div>
              {!passkeyIdentity && connected && accountAddress && signedIn ? (
                <button
                  type="button"
                  onClick={() => void portfolio.refresh()}
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
                >
                  <IconRefresh size={13} stroke={2} aria-hidden />
                  Refresh
                </button>
              ) : null}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-4 py-4 sm:px-6">
            <div className="mx-auto w-full max-w-[860px]">
              {passkeyIdentity ? (
                <PasskeyPortfolio accountId={passkeyIdentity.accountId} />
              ) : !connected || !accountAddress ? (
                <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
                  <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
                    <IconWallet size={18} stroke={1.7} aria-hidden />
                  </span>
                  <h2 className="mt-3 text-[15px] font-medium text-ink">
                    Portfolio &amp; Balances
                  </h2>
                  <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
                    Please log in to view your portfolio and balances.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={openWalletPicker}
                    className="mt-4"
                  >
                    Log In
                  </Button>
                </div>
              ) : !signedIn ? (
                status === "unknown" ? skeleton : signInPrompt
              ) : portfolio.authExpired ? (
                signInPrompt
              ) : portfolio.error && snapshot === null ? (
                <p className="text-[13.5px] leading-relaxed text-ink-2">
                  Balances are unavailable. Please try again.
                </p>
              ) : (
                <Skeleton
                  id="portfolio"
                  data={snapshot}
                  sample={SAMPLE_PORTFOLIO}
                  label="Reading your balances."
                >
                  {(loaded) => <PortfolioBody snapshot={loaded} />}
                </Skeleton>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
