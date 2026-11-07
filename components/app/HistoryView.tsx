"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "skullet/react";
import { IconChevronLeft, IconHistory } from "@tabler/icons-react";
import { StatusPill } from "@/components/atoms/StatusPill";
import { Button } from "@/components/atoms/Button";
import SidebarNav from "@/components/primitives/SidebarNav";
import { AccountControl } from "@/components/app/AccountControl";
import { openWalletPicker } from "@/components/app/ConnectGate";
import { openSignIn } from "@/components/app/SignInDialog";
import { openPasskeyDialog } from "@/components/app/PasskeyDialog";
import { usePasskeysAvailable } from "@/lib/auth/passkey-client";
import { useResolvedAssetMeta } from "@/components/app/useAssetMeta";
import { useAuth } from "@/lib/auth/auth-provider";
import { accountScope } from "@/lib/auth/session-identity";
import {
  useThreads,
  useTrashed,
} from "@/components/app/threadQueries";
import { networkDisplayName } from "@/lib/wallet/balances";
import { assetName, type AssetMeta } from "@/components/app/toolParts";
import { useHistory } from "./historyQueries";
import {
  historyStateMeta,
  SAMPLE_HISTORY_ROWS,
  type HistoryRow,
} from "./historyCache";

/* ─────────────────────────────────────────────────────────
 * HISTORY
 * Every trade and deposit this account has approved, newest
 * first. The same transaction record the chat cards and the
 * assistant read, kept current by the settlement workflow.
 * ───────────────────────────────────────────────────────── */

function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const NO_META = new Map<string, AssetMeta>();
const NO_SYMBOLS = new Map<string, string>();

function HistoryList({
  rows,
  meta,
  symbols,
}: {
  rows: HistoryRow[];
  meta: Map<string, AssetMeta>;
  symbols: Map<string, string>;
}) {
  return (
    <ol className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const from = row.originAsset
          ? assetName(row.originAsset, symbols)
          : "—";
        const to = row.destinationAsset
          ? assetName(row.destinationAsset, symbols)
          : "—";
        const out = row.amountOut ?? row.expectedOut;
        const fromChain = row.originAsset
          ? meta.get(row.originAsset)?.chain
          : undefined;
        const toChain = row.destinationAsset
          ? meta.get(row.destinationAsset)?.chain
          : undefined;
        const route =
          fromChain || toChain
            ? ` · ${networkDisplayName(fromChain)} → ${networkDisplayName(toChain)}`
            : "";
        const { label, tone } = historyStateMeta(row.state);
        return (
          <li
            key={row.id}
            className="rounded-card bg-surface px-3.5 py-3 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-[14px] leading-snug text-ink">
                <strong className="font-semibold tabular-nums">
                  {row.amountIn ?? "—"} {from}
                </strong>{" "}
                <span className="text-ink-3">→</span>{" "}
                <strong className="font-semibold tabular-nums">
                  {out ?? "—"} {to}
                </strong>
                <span className="text-[12.5px] text-ink-3">{route}</span>
              </p>
              <StatusPill tone={tone}>{label}</StatusPill>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
              {formatWhen(row.createdAt) ? (
                <time>{formatWhen(row.createdAt)}</time>
              ) : null}
              {row.explorerUrls[0] ? (
                <a
                  href={row.explorerUrls[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-ink hover:underline"
                >
                  View on explorer
                </a>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function HistoryView() {
  const router = useRouter();
  const { data: threads = [] } = useThreads();
  const { data: trashed = [] } = useTrashed();
  const { connected, signedIn, status, identity } = useAuth();
  const passkeys = usePasskeysAvailable();

  const scope = identity
    ? accountScope(identity.chain, identity.address)
    : null;
  const history = useHistory(scope, signedIn);
  const rows = history.rows;

  const assetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows ?? []) {
      if (row.originAsset) ids.add(row.originAsset);
      if (row.destinationAsset) ids.add(row.destinationAsset);
    }
    return [...ids];
  }, [rows]);
  const meta = useResolvedAssetMeta(assetIds);
  const symbols = useMemo(() => {
    const out = new Map<string, string>();
    for (const [id, m] of meta) {
      if (m.symbol) out.set(id, m.symbol);
    }
    return out;
  }, [meta]);

  // One prompt serves both ways of arriving unsigned: connected with no
  // session yet, and a request that came back 401 mid-visit.
  const passkeySignIn = !connected && passkeys;
  const signInPrompt = (
    <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
        <IconHistory size={18} stroke={1.7} aria-hidden />
      </span>
      <h2 className="mt-3 text-[15px] font-medium text-ink">History</h2>
      <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
        Please log in to view your history.
      </p>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={passkeySignIn ? openPasskeyDialog : openSignIn}
        className="mt-4"
      >
        Log In
      </Button>
    </div>
  );

  const emptyState = (
    <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
        <IconHistory size={18} stroke={1.7} aria-hidden />
      </span>
      <h2 className="mt-3 text-[15px] font-medium text-ink">
        You have not approved anything yet.
      </h2>
      <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
        Any trade or deposit you approve will land here.
      </p>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={() => router.push("/")}
        className="mt-4"
      >
        Start chat
      </Button>
    </div>
  );

  const skeleton = (
    <Skeleton
      id="history"
      data={null}
      sample={SAMPLE_HISTORY_ROWS}
      label="Reading your history."
    >
      {(sample) => (
        <HistoryList rows={sample} meta={NO_META} symbols={NO_SYMBOLS} />
      )}
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
        onOpenTrash={() => router.push("/trash")}
        onOpenPortfolio={() => router.push("/portfolio")}
        historyActive
        onOpenHistory={() => router.push("/history")}
        trashCount={trashed.length}
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
                  <IconHistory size={17} stroke={1.7} />
                </span>
                <h1 className="truncate text-[14px] font-medium text-ink">
                  History
                </h1>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-4 py-4 sm:px-6">
            <div className="mx-auto w-full max-w-[860px]">
              {!signedIn ? (
                status === "unknown" ? (
                  skeleton
                ) : connected ? (
                  signInPrompt
                ) : (
                  <div className="flex min-h-[46vh] flex-col items-center justify-center px-4 py-12 text-center">
                    <span className="flex size-10 items-center justify-center rounded-[10px] bg-inset text-ink-2 shadow-hairline">
                      <IconHistory size={18} stroke={1.7} aria-hidden />
                    </span>
                    <h2 className="mt-3 text-[15px] font-medium text-ink">
                      History
                    </h2>
                    <p className="mt-1 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
                      {passkeys
                        ? "Log in with a wallet or a passkey to view your history."
                        : "Please log in to view your history."}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        variant="primary"
                        size="md"
                        onClick={openWalletPicker}
                      >
                        Log In
                      </Button>
                    </div>
                  </div>
                )
              ) : history.authExpired ? (
                signInPrompt
              ) : history.error && rows === null ? (
                <p className="text-[13.5px] leading-relaxed text-ink-2">
                  History is unavailable. Please try again.
                </p>
              ) : (
                <Skeleton
                  id="history"
                  data={rows}
                  sample={SAMPLE_HISTORY_ROWS}
                  empty={rows !== null && rows.length === 0}
                  emptyMessage={emptyState}
                  label="Reading your history."
                >
                  {(loaded) => (
                    <HistoryList rows={loaded} meta={meta} symbols={symbols} />
                  )}
                </Skeleton>
              )}
              {rows !== null && rows.length > 0 && history.hasNextPage ? (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={history.isFetchingNextPage}
                    onClick={history.loadMore}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
