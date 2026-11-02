"use client";

import {
  AssetMatrix as FinanceAssetMatrix,
  type AssetGroup,
} from "@/components/finance/AssetMatrix";

const SAMPLE_GROUPS: AssetGroup[] = [
  {
    id: "arbitrum",
    name: "Arbitrum",
    icon: "arb",
    items: [
      {
        id: "arb-usdc",
        symbol: "USDC",
        name: "USD Coin",
        amount: "14.45",
        valueUsd: 14.45,
        category: "stables",
      },
      {
        id: "arb-eth",
        symbol: "ETH",
        name: "Ethereum",
        amount: "0.0011",
        valueUsd: 2.87,
        category: "native",
      },
      {
        id: "arb-usds",
        symbol: "USDS",
        name: "USDS",
        amount: "1.976",
        valueUsd: 1.98,
        category: "stables",
      },
      {
        id: "arb-token",
        symbol: "ARB",
        name: "Arbitrum",
        amount: "12.50",
        valueUsd: 7.25,
        category: "token",
      },
    ],
  },
  {
    id: "base",
    name: "Base",
    icon: "base",
    items: [
      {
        id: "base-eth",
        symbol: "ETH",
        name: "Ethereum",
        amount: "0.0035",
        valueUsd: 9.22,
        category: "native",
      },
      {
        id: "base-wbtc",
        symbol: "WBTC",
        name: "Wrapped BTC",
        amount: "0.0001",
        valueUsd: 0.16,
        category: "dust",
      },
      {
        id: "base-usds",
        symbol: "USDS",
        name: "USDS",
        amount: "0.009",
        valueUsd: 0.01,
        category: "dust",
      },
    ],
  },
  {
    id: "ethereum",
    name: "Ethereum",
    icon: "eth",
    items: [
      {
        id: "eth-ausd",
        symbol: "AUSD",
        name: "Agora Dollar",
        amount: "6.85",
        valueUsd: 6.85,
        category: "stables",
      },
      {
        id: "eth-eth",
        symbol: "ETH",
        name: "Ethereum",
        amount: "0.0004",
        valueUsd: 1.11,
        category: "native",
      },
    ],
  },
];

const POSITION_GROUPS: AssetGroup[] = [
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    icon: "hl",
    items: [
      {
        id: "hl-eth",
        symbol: "ETH-PERP",
        name: "Long 3x · $3,120 entry",
        amount: "0.50",
        valueUsd: 142.3,
        category: "token",
      },
      {
        id: "hl-sol",
        symbol: "SOL-PERP",
        name: "Short 2x · $185 entry",
        amount: "10.00",
        valueUsd: -18.5,
        category: "token",
      },
      {
        id: "hl-usdc",
        symbol: "USDC Margin",
        name: "Isolated Collateral",
        amount: "500.00",
        valueUsd: 500.0,
        category: "stables",
      },
    ],
  },
  {
    id: "aave",
    name: "Aave V3",
    icon: "aave",
    items: [
      {
        id: "aave-supply",
        symbol: "aUSDC",
        name: "Supplied · 5.2% APY",
        amount: "1,250.00",
        valueUsd: 1250.0,
        category: "stables",
      },
      {
        id: "aave-borrow",
        symbol: "vWETH",
        name: "Borrowed · 2.8% APY",
        amount: "0.25",
        valueUsd: -650.0,
        category: "native",
      },
    ],
  },
];

const SINGLE_GROUPS: AssetGroup[] = [
  {
    id: "ethereum",
    name: "Ethereum",
    icon: "eth",
    items: [
      {
        id: "eth-eth",
        symbol: "ETH",
        name: "Ethereum",
        amount: "5.777859",
        valueUsd: 13440.74,
        category: "native",
      },
    ],
  },
];

export default function AssetMatrixLabSample({
  variant = "Balances",
}: {
  variant?: string;
}) {
  const isPositions = variant.toLowerCase().includes("position");
  const isSingle = variant.toLowerCase().includes("single");
  const groups = isPositions
    ? POSITION_GROUPS
    : isSingle
      ? SINGLE_GROUPS
      : SAMPLE_GROUPS;
  const title = isPositions
    ? "Positions & Perps"
    : isSingle
      ? "Ethereum balances"
      : "Portfolio balances";

  return (
    <FinanceAssetMatrix
      groups={groups}
      title={title}
      address={
        isSingle ? "0x8d8A6BF26964aF9D7eEd9e03E53415D37aA96045" : undefined
      }
      chain={isSingle ? "evm" : undefined}
      showFilters={!isPositions && !isSingle}
    />
  );
}
