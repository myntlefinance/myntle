"use client";

import type { ReactNode } from "react";
import { TokenChip } from "@/components/finance/TokenChip";
import { ChipHover } from "@/components/finance/ChipHover";
import { TokenPopup } from "@/components/finance/TokenPopup";
import { prefetchSymbolPrice } from "@/components/app/useAssetPrice";
import { prefetchTokenSeriesForSymbol } from "@/components/app/useTokenSeries";
import {
  resolveTokenFile,
  resolveUploadedToken,
} from "@/components/finance/TokenAvatar";
import { extractChildrenText } from "@/components/app/markdownText";

type AssetPillProps = {
  children?: unknown;
  symbol?: unknown;
  chain?: unknown;
  node?: unknown;
} & Record<string, unknown>;

const TICKER = /^(?=.*[A-Z])[A-Z0-9][A-Z0-9.\-]{0,11}$/;
const CHAIN = /^[A-Z0-9][A-Z0-9-]{1,15}$/i;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Splits the tag's label into a ticker and whatever follows it. The tag is
 * meant to wrap the ticker alone; the rest is the recovery path for an
 * unclosed tag, where the HTML parser hands us the remainder of the sentence
 * as children. */
function splitLabel(text: string): { ticker: string; rest: string } | null {
  const match = /^(\S+)([\s\S]*)$/.exec(text);
  if (!match) return null;
  const token = match[1];
  const trailing = /[.,;:!?]+$/.exec(token)?.[0] ?? "";
  const ticker = token.slice(0, token.length - trailing.length);
  if (!ticker) return null;
  return { ticker, rest: trailing + match[2] };
}

/** A custom Streamdown element: <asset>USDC</asset>.
 *
 * The ticker is the visible child, so the tag reads as the asset itself and
 * the label survives if the element is ever stripped. The component stays
 * inline-only (TokenChip renders spans) because markdown paragraphs are <p>. */
export function AssetPill({ children, symbol, chain }: AssetPillProps) {
  const raw = extractChildrenText(children as ReactNode).trim();
  const attr = asString(symbol).trim().toUpperCase();
  const attrTicker = attr && TICKER.test(attr) ? attr : "";

  let ticker = attrTicker;
  let rest = raw;

  if (ticker) {
    // An attribute-led tag may still carry the ticker as its child, or the
    // rest of the sentence when the closing tag never arrived.
    const upper = rest.toUpperCase();
    if (upper.startsWith(ticker)) {
      const after = rest.slice(ticker.length);
      if (!after || /^\s/.test(after)) rest = after.trimStart();
    }
  } else {
    const split = splitLabel(raw);
    if (!split) return <>{children ?? raw}</>;
    const candidate = split.ticker.toUpperCase();
    const known =
      resolveUploadedToken(split.ticker) != null ||
      resolveTokenFile(split.ticker) != null;
    const looksLikeTicker =
      TICKER.test(candidate) &&
      (split.ticker === split.ticker.toUpperCase() || known);
    if (!looksLikeTicker) return <>{children ?? raw}</>;
    ticker = candidate;
    rest = split.rest;
  }

  const badge =
    typeof chain === "string" && CHAIN.test(chain.trim())
      ? chain.trim().toLowerCase()
      : undefined;
  const needsSpace = rest.length > 0 && !/^[\s.,;:!?)]/.test(rest);

  return (
    <>
      <ChipHover
        label={`${ticker} details`}
        height={220}
        content={<TokenPopup symbol={ticker} chain={badge} />}
        onIntent={() => {
          prefetchSymbolPrice(ticker, badge);
          // The chart is not part of the price path, so it warms in parallel
          // and the popup opens with both a figure and a line.
          void prefetchTokenSeriesForSymbol(ticker, badge);
        }}
      >
        <TokenChip symbol={ticker} badge={badge} />
      </ChipHover>
      {rest ? (
        <span>
          {needsSpace ? " " : ""}
          {rest}
        </span>
      ) : null}
    </>
  );
}

export default AssetPill;
