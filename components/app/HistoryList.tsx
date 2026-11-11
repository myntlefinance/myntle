"use client";

import { StatusPill } from "@/components/atoms/StatusPill";
import { networkDisplayName } from "@/lib/wallet/balances";
import { assetName, type AssetMeta } from "@/components/app/toolParts";
import {
  historyStateMeta,
  SAMPLE_HISTORY_ROWS,
  type HistoryRow,
} from "@/components/app/historyCache";

function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Empty maps for the sample: no catalogue has taught us names yet. */
export const NO_HISTORY_META = new Map<string, AssetMeta>();
export const NO_HISTORY_SYMBOLS = new Map<string, string>();

/* ─────────────────────────────────────────────────────────
 * HISTORY LIST
 * Every trade and deposit this account has approved, newest
 * first. Shared by HistoryView and the first-paint shell so
 * the two skeletons can never drift: the shell renders the
 * sample below inside its own outer <Skeleton>, the page
 * renders it inside its data-bound <Skeleton>.
 * ───────────────────────────────────────────────────────── */

export function HistoryList({
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

/** The measured sample both skeletons render. */
export function HistoryListSample() {
  return (
    <HistoryList
      rows={SAMPLE_HISTORY_ROWS}
      meta={NO_HISTORY_META}
      symbols={NO_HISTORY_SYMBOLS}
    />
  );
}

export default HistoryList;
