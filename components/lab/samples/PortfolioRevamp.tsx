"use client";

import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/atoms/SegmentedControl";
import {
  PortfolioHero,
  type AllocationGroup,
} from "@/components/finance/PortfolioHero";
import {
  HoldingsTable,
  flattenGroups,
} from "@/components/finance/HoldingsTable";
import type { AssetGroup } from "@/lib/wallet/balances";

/* ─────────────────────────────────────────────────────────
 * PORTFOLIO REVAMP (lab prototype)
 * The tabbed holdings composition: segmented wallet/super
 * switch, the allocation hero that filters the table, and the
 * holdings table itself. The pieces live in components/finance;
 * this file only wires them together with sample data.
 * ───────────────────────────────────────────────────────── */

type Tab = "Your wallet" | "Super account";

const TABS: readonly Tab[] = ["Your wallet", "Super account"] as const;

const SAMPLE_WALLET: AssetGroup[] = [
  {
    id: "base",
    name: "Base",
    icon: "base",
    items: [
      { id: "w-eth", symbol: "ETH", name: "Ether", amount: "0.8420", valueUsd: 2734.18, priceUsd: 3247.24, category: "native", chain: "base", network: "base" },
      { id: "w-usdc", symbol: "USDC", name: "USD Coin", amount: "1,250.00", valueUsd: 1250, priceUsd: 1, category: "stables", chain: "base", network: "base" },
      { id: "w-degen", symbol: "DEGEN", name: "Degen", amount: "12,400", valueUsd: 86.4, category: "token", chain: "base", network: "base" },
      { id: "w-dust", symbol: "FOO", name: "Foo", amount: "9.10", valueUsd: 0.42, category: "dust", chain: "base", network: "base" },
    ],
  },
];

const SAMPLE_SUPER: AssetGroup[] = [
  {
    id: "settlement",
    name: "Near Intents",
    icon: "near",
    items: [
      { id: "s-usdc", symbol: "USDC", name: "USD Coin", amount: "320.50", valueUsd: 320.5, priceUsd: 1, category: "stables", chain: "near", network: "intents" },
      { id: "s-usdt", symbol: "USDT", name: "Tether USD", amount: "150.00", valueUsd: 150, priceUsd: 1, category: "stables", chain: "near", network: "intents" },
    ],
  },
];

export default function PortfolioRevamp({ variant }: { variant?: string }) {
  const initial: Tab = variant === "Super account" ? "Super account" : "Your wallet";
  const [tab, setTab] = useState<Tab>(initial);
  const [group, setGroup] = useState<AllocationGroup | null>(null);
  const empty = variant === "Empty";
  const groups = useMemo(
    () => (empty ? [] : tab === "Your wallet" ? SAMPLE_WALLET : SAMPLE_SUPER),
    [empty, tab],
  );
  const items = useMemo(() => flattenGroups(groups), [groups]);
  const total = items.reduce((sum, item) => sum + item.valueUsd, 0);

  return (
    <div
      key={`${tab}${empty ? "-empty" : ""}`}
      className="w-full max-w-[560px] animate-[fade-up_250ms_cubic-bezier(0.23,1,0.32,1)]"
    >
      <SegmentedControl options={TABS} value={tab} onChange={setTab} className="mb-3" />
      <PortfolioHero
        total={total}
        count={items.length}
        scope={tab === "Your wallet" ? "wallet" : "super"}
        items={items}
        selected={group}
        onSelect={(next) => setGroup((prev) => (prev === next ? null : next))}
      />
      <div className="mt-3">
        <HoldingsTable groups={groups} group={group} />
      </div>
    </div>
  );
}
