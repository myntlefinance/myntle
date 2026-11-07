"use client";

import type { ReactNode } from "react";
import type { LivelinePoint } from "liveline";
import { useSymbolPrice } from "@/components/app/useAssetPrice";
import { formatUsdPrice } from "@/lib/format/price";
import { TokenAvatar } from "@/components/finance/TokenAvatar";
import { TokenPriceChart } from "@/components/finance/TokenPriceChart";
import { networkDisplayName } from "@/lib/wallet/balances";

/** The token hover card: ticker, chain, unit price, and the 24-hour line.
 * `history` is optional so the card is usable before a price-history feed
 * exists; an empty list renders Liveline's own “No data to display” state.
 * When `price` is not supplied, the catalogue resolves the ticker so an
 * inline `<asset>` chip still carries a real unit price. */
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
  const fetchedPrice = useSymbolPrice(providedPrice ? null : symbol, chain);
  const displayPrice = providedPrice ?? formatUsdPrice(fetchedPrice);

  return (
    <div>
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
      <TokenPriceChart points={history} changePct={changePct} />
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
