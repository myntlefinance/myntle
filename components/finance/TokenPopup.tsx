"use client";

import { useRef, type ReactNode } from "react";
import type { LivelinePoint } from "liveline";
import { useSymbolAsset } from "@/components/app/useAssetPrice";
import { useVisiblePrice } from "@/components/app/usePrice";
import { useTokenSeries } from "@/components/app/useTokenSeries";
import { formatUsdPrice } from "@/lib/format/price";
import { TokenAvatar } from "@/components/finance/TokenAvatar";
import { TokenPriceChart } from "@/components/finance/TokenPriceChart";
import { networkDisplayName } from "@/lib/wallet/balances";

/** The token hover card: ticker, chain, unit price, and the 24-hour line.
 * `history` is optional so a caller can supply its own series; otherwise the
 * card fetches one when it opens, and an empty list renders Liveline's own
 * “No data to display” state. When `price` is not supplied, the catalogue
 * resolves the ticker and the live store keeps the unit price current while
 * the card is on screen. */
export function TokenPopup({
  symbol,
  chain,
  price,
  history,
  changePct,
}: {
  symbol: string;
  chain?: string;
  price?: string;
  history?: LivelinePoint[];
  changePct?: number | null;
}) {
  const providedPrice = price?.trim() || undefined;
  const rootRef = useRef<HTMLDivElement | null>(null);
  // A card handed both the price and the line has no catalogue row left to
  // resolve; skipping the lookup avoids a request nobody reads.
  const needsAsset = !(providedPrice && history !== undefined);
  const asset = useSymbolAsset(needsAsset ? symbol : null, chain);
  // Price keeps the ordinary fallback; the chart is chain-strict.
  const visible = useVisiblePrice(asset.assetId, rootRef);
  // A caller that passed a series owns it; only a card with no history
  // fetches one, and it does so once the popup is open.
  const series = useTokenSeries(asset.historyAssetId, history === undefined);
  // The header keeps the caller's quote price; the line's right edge is the
  // live store quote only when its source matches the series. A spread
  // between the two is real and is never smoothed away.
  const displayPrice =
    providedPrice ?? formatUsdPrice(visible?.usd ?? asset.priceUsd);
  const chartPoints = history ?? series.points;
  // Each prop is an independent override: a caller may supply the line, the
  // percent, or both, and the chart derives one from the other when absent.
  const chartChangePct = changePct ?? series.changePct;
  // The chart remounts per series identity. The catalogue id is canonical;
  // the requested ticker and chain still distinguish a caller-supplied line
  // from the next card's line before a catalogue row has resolved.
  const chartSeriesId = asset.historyAssetId ?? `${symbol}@${chain ?? ""}`;

  return (
    <div ref={rootRef}>
      <div className="mb-1 flex items-center gap-2">
        <TokenAvatar symbol={symbol} networkBadge={chain} size={24} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium leading-tight text-ink">
              {symbol}
            </p>
            <p
              className={`shrink-0 text-sm font-medium leading-tight tabular-nums ${
                displayPrice ? "text-ink" : "text-ink-3"
              }`}
            >
              {displayPrice ?? "—"}
            </p>
          </div>
          {chain ? (
            <p className="text-xs text-ink-3">{networkDisplayName(chain)}</p>
          ) : null}
        </div>
      </div>
      <TokenPriceChart
        points={chartPoints}
        changePct={chartChangePct}
        seriesId={chartSeriesId}
      />
    </div>
  );
}

/* Popup rows center instead of baselining. Popup values hold image marks,
 * icon glyphs, and truncating addresses — an image bottom edge or an
 * overflow bottom edge hijacks an inline baseline and floats the text
 * above the label. Same-size text centered on itself aligns exactly, so
 * the drawer keeps DetailRow and only popups use this. */
export function PopupRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-ink-3">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 text-right text-xs tabular-nums text-ink">
        {children}
      </span>
    </div>
  );
}
