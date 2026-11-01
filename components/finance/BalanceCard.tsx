"use client";

import type { ReactNode } from "react";
import type { TokenBalance } from "@/lib/wallet/balances";
import { truncateTechData, type SupportedChain } from "@/components/atoms/TechDataChip";

export type BalanceCardProps = {
  address?: string;
  chain?: string;
  wallet: {
    balances: TokenBalance[];
    totalValueUsd?: number;
    error?: string;
  };
  settlementLedger?: {
    balances: TokenBalance[];
    totalValueUsd?: number;
    status?: string;
    message?: string;
  } | null;
};

/**
 * Clean SVG icons for supported blockchain networks.
 */
export function NetworkIcon({
  network,
  size = 16,
}: {
  network: string;
  size?: number;
}) {
  const norm = network.toLowerCase();

  if (norm.includes("arb")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="shrink-0"
        aria-label="Arbitrum"
      >
        <rect width="24" height="24" rx="12" fill="#28A0F0" />
        <path
          d="M16.5 16.5L12 8L8.2 14.8H10.5L12 12.1L14.2 16.5H16.5Z"
          fill="white"
        />
        <path
          d="M12 5.5L6.5 15.5H8.8L12 9.8L14.8 15H17.2L12 5.5Z"
          fill="white"
          opacity="0.85"
        />
      </svg>
    );
  }

  if (norm.includes("base")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="shrink-0"
        aria-label="Base"
      >
        <rect width="24" height="24" rx="12" fill="#0052FF" />
        <circle cx="12" cy="12" r="5.5" fill="white" />
      </svg>
    );
  }

  if (norm.includes("eth")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="shrink-0"
        aria-label="Ethereum"
      >
        <rect width="24" height="24" rx="12" fill="#627EEA" />
        <path
          d="M12 4.5L11.85 5.01V14.65L12 14.8L16.2 12.32L12 4.5Z"
          fill="white"
          opacity="0.8"
        />
        <path
          d="M12 4.5L7.8 12.32L12 14.8V4.5Z"
          fill="white"
        />
        <path
          d="M12 15.86L11.91 15.97V19.34L12 19.59L16.2 13.72L12 15.86Z"
          fill="white"
          opacity="0.8"
        />
        <path
          d="M12 19.59V15.86L7.8 13.72L12 19.59Z"
          fill="white"
        />
      </svg>
    );
  }

  if (norm.includes("sol")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="shrink-0"
        aria-label="Solana"
      >
        <rect width="24" height="24" rx="12" fill="#18181B" />
        <path
          d="M7 8.2h8.5l1.5-1.7H8.5L7 8.2zm1.5 3.8H17l-1.5 1.7H7l1.5-1.7zm-1.5 5.5h8.5l1.5-1.7H8.5L7 17.5z"
          fill="url(#sol-grad)"
        />
        <defs>
          <linearGradient id="sol-grad" x1="7" y1="6.5" x2="17" y2="17.5">
            <stop stopColor="#00FFA3" />
            <stop offset="1" stopColor="#DC1FFF" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  if (norm.includes("near")) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="shrink-0"
        aria-label="NEAR"
      >
        <rect width="24" height="24" rx="12" fill="#000000" />
        <path
          d="M8.5 7.5h2.2l4.8 6.8V7.5h2v9h-2.1l-4.9-6.9v6.9h-2v-9z"
          fill="white"
        />
      </svg>
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-field font-semibold text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.55 }}
    >
      {network.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Token glyphs for common assets with a fallback monogram.
 */
export function TokenIcon({
  symbol,
  size = 18,
}: {
  symbol: string;
  size?: number;
}) {
  const sym = symbol.toUpperCase();

  if (sym === "USDC" || sym === "USDC.E") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="shrink-0"
        aria-label="USDC"
      >
        <circle cx="12" cy="12" r="11" fill="#2775CA" />
        <path
          d="M12.75 6.5v1.2c2.1.3 3.25 1.5 3.25 3.1h-1.9c0-1.1-.7-1.8-1.75-1.8-1.1 0-1.7.6-1.7 1.4 0 .9.8 1.2 2.1 1.6 2.15.6 3.4 1.4 3.4 3.2 0 1.7-1.3 2.9-3.4 3.2v1.1h-1.5v-1.1c-2.3-.3-3.5-1.6-3.5-3.3h2c0 1.2.9 1.9 2 1.9 1.2 0 1.8-.6 1.8-1.5 0-.9-.7-1.3-2.1-1.7-2.1-.6-3.4-1.3-3.4-3.1 0-1.7 1.3-2.8 3.2-3.1V6.5h1.5z"
          fill="white"
        />
      </svg>
    );
  }

  if (sym === "USDT") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="shrink-0"
        aria-label="USDT"
      >
        <circle cx="12" cy="12" r="11" fill="#26A17B" />
        <path
          d="M12 6.5h6v3h-2.1v2.1c0 2.2-1.7 4-3.9 4s-3.9-1.8-3.9-4V9.5H6v-3h6zm0 4.1c1.2 0 2.1.8 2.1 1.9s-.9 1.9-2.1 1.9-2.1-.8-2.1-1.9.9-1.9 2.1-1.9z"
          fill="white"
        />
      </svg>
    );
  }

  if (sym === "ETH" || sym === "WETH") {
    return <NetworkIcon network="eth" size={size} />;
  }

  if (sym === "SOL") {
    return <NetworkIcon network="solana" size={size} />;
  }

  if (sym === "NEAR" || sym === "WNEAR") {
    return <NetworkIcon network="near" size={size} />;
  }

  const colors = ["#e08a3c", "#4f8ff7", "#2ba878", "#9c57d8", "#e0586e"];
  const colorIndex =
    sym.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) %
    colors.length;

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: colors[colorIndex],
        fontSize: size * 0.55,
      }}
    >
      {sym.charAt(0)}
    </span>
  );
}

function getNetworkMeta(chainOrNetwork: string): { id: string; name: string } {
  const norm = chainOrNetwork.toLowerCase();
  if (norm.includes("arb")) return { id: "arbitrum", name: "Arbitrum" };
  if (norm.includes("base")) return { id: "base", name: "Base" };
  if (norm.includes("eth")) return { id: "ethereum", name: "Ethereum" };
  if (norm.includes("sol")) return { id: "solana", name: "Solana" };
  if (norm.includes("near")) return { id: "near", name: "NEAR" };
  return { id: norm, name: norm.charAt(0).toUpperCase() + norm.slice(1) };
}

/**
 * Stripped-down, row-wise portfolio balance card grouped by network.
 */
export default function BalanceCard({
  address,
  chain,
  wallet,
  settlementLedger,
}: BalanceCardProps) {
  const balances = wallet.balances ?? [];

  // Group balances by network
  const groupMap = new Map<
    string,
    { id: string; name: string; tokens: TokenBalance[]; totalUsd: number }
  >();

  for (const token of balances) {
    const meta = getNetworkMeta(token.network || token.chain);
    const existing = groupMap.get(meta.id);
    const usd = token.valueUsd ?? 0;
    if (existing) {
      existing.tokens.push(token);
      existing.totalUsd += usd;
    } else {
      groupMap.set(meta.id, {
        id: meta.id,
        name: meta.name,
        tokens: [token],
        totalUsd: usd,
      });
    }
  }

  const groups = Array.from(groupMap.values());
  const singleNetwork = groups.length === 1 ? groups[0].name : null;
  const cardTitle = singleNetwork ? `${singleNetwork} Balances` : "Asset Balances";

  const totalValueUsd = wallet.totalValueUsd;
  const ledgerBalances = settlementLedger?.balances ?? [];
  const hasLedgerFunds = ledgerBalances.length > 0;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-hairline">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line/60 bg-hover-1/30 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">
            {cardTitle}
          </span>
          {address && (
            <span className="font-mono text-[11px] text-ink-3">
              {truncateTechData(address, (chain as SupportedChain) || "evm")}
            </span>
          )}
        </div>
        {totalValueUsd !== undefined && (
          <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">
            ${totalValueUsd.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        )}
      </div>

      {/* Network Sections */}
      {groups.length === 0 ? (
        <div className="px-3.5 py-3 text-[13px] text-ink-3">
          {wallet.error ? (
            <span className="text-red-500">{wallet.error}</span>
          ) : (
            "No token balances found for the queried network."
          )}
        </div>
      ) : (
        <div className="divide-y divide-line/40">
          {groups.map((group) => (
            <div key={group.id} className="px-3.5 py-2.5">
              {/* Network Header Row */}
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <NetworkIcon network={group.id} size={15} />
                  <span className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-2">
                    {group.name}
                  </span>
                </div>
                {group.totalUsd > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-ink-3">
                    ~${group.totalUsd.toFixed(2)}
                  </span>
                )}
              </div>

              {/* Tokens */}
              <div className="space-y-1.5">
                {group.tokens.map((token, idx) => (
                  <div
                    key={`${token.symbol}-${idx}`}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <div className="flex items-center gap-2">
                      <TokenIcon symbol={token.symbol} size={16} />
                      <span className="font-mono font-medium tabular-nums text-ink">
                        {token.balance}
                      </span>
                      <span className="font-medium text-ink-2">
                        {token.symbol}
                      </span>
                    </div>
                    <div className="font-mono text-[12px] tabular-nums text-ink-3">
                      {token.valueUsd !== undefined
                        ? `~$${token.valueUsd.toFixed(2)}`
                        : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* NEAR Intents Settlement Ledger Section */}
      {settlementLedger && (
        <div className="border-t border-line/60 bg-hover-1/20 px-3.5 py-2">
          <div className="flex items-center justify-between text-[11.5px]">
            <div className="flex items-center gap-1.5">
              <NetworkIcon network="near" size={13} />
              <span className="font-semibold text-ink-2">
                Settlement Ledger
              </span>
            </div>
            {hasLedgerFunds ? (
              <span className="font-mono text-ink-3">
                ${settlementLedger.totalValueUsd?.toFixed(2) ?? "0.00"}
              </span>
            ) : (
              <span className="text-[11px] text-ink-3">
                Empty · Ready for zero-gas swaps
              </span>
            )}
          </div>

          {hasLedgerFunds && (
            <div className="mt-1.5 space-y-1">
              {ledgerBalances.map((token, idx) => (
                <div
                  key={`ledger-${token.symbol}-${idx}`}
                  className="flex items-center justify-between text-[12px]"
                >
                  <div className="flex items-center gap-1.5">
                    <TokenIcon symbol={token.symbol} size={14} />
                    <span className="font-mono tabular-nums text-ink">
                      {token.balance}
                    </span>
                    <span className="text-ink-2">{token.symbol}</span>
                  </div>
                  <div className="font-mono text-[11px] tabular-nums text-ink-3">
                    {token.valueUsd !== undefined
                      ? `~$${token.valueUsd.toFixed(2)}`
                      : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
