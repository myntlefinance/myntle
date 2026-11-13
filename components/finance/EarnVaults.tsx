"use client";

import { useEffect, useState } from "react";
import { TokenAvatar } from "@/components/finance/TokenAvatar";

/**
 * The public yield catalogue, shown below the portfolio.
 *
 * It is a read, not an order form: the assistant quotes and proposes the
 * deposit, and the same card approves it for a wallet or a passkey. Every
 * number here is either a protocol fact or an APY the aggregator reported;
 * a missing APY is named as missing, never filled with zero.
 */

type EarnVaultView = {
  id: string;
  name: string;
  protocol: string;
  chain: string;
  receiptSymbol: string;
  paymentSymbol: string;
  apy: number | null;
};

type EarnResponse = { vaults?: EarnVaultView[]; note?: string };

const CHAIN_NAME: Record<string, string> = {
  base: "Base",
  eth: "Ethereum",
  sol: "Solana",
  near: "NEAR",
};

async function fetchVaults(): Promise<EarnResponse> {
  const res = await fetch("/api/earn", { cache: "no-store" });
  if (!res.ok) throw new Error("earn-unavailable");
  return (await res.json()) as EarnResponse;
}

export default function EarnVaults() {
  const [data, setData] = useState<EarnResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchVaults()
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;
  const vaults = data?.vaults ?? [];
  if (vaults.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium text-ink">Earn</h2>
        <span className="text-xs text-ink-3">Ask the assistant to deposit</span>
      </div>
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {vaults.map((vault, index) => (
          <div
            key={vault.id}
            className={`flex items-center gap-3 px-3.5 py-3 ${
              index > 0 ? "border-t border-line" : ""
            }`}
          >
            <TokenAvatar
              symbol={vault.paymentSymbol}
              networkBadge={vault.chain}
              size={28}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">
                {vault.name}
              </p>
              <p className="mt-0.5 truncate text-xs text-ink-3">
                {vault.protocol} on {CHAIN_NAME[vault.chain] ?? vault.chain} ·{" "}
                {vault.paymentSymbol} in, {vault.receiptSymbol} out
              </p>
            </div>
            <div className="shrink-0 text-right">
              {vault.apy !== null ? (
                <>
                  <p className="text-[13px] font-medium tabular-nums text-ink">
                    {vault.apy.toFixed(2)}%
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">APY</p>
                </>
              ) : (
                <p className="text-[11px] text-ink-3">APY not reported</p>
              )}
            </div>
          </div>
        ))}
        <p className="border-t border-line px-3.5 py-2 text-[11px] leading-relaxed text-ink-3">
          APY is variable and set by the protocol. It is read from DefiLlama
          and may be stale.
        </p>
      </div>
    </section>
  );
}
