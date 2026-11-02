"use client";

import AssetMatrix, {
  type AssetGroup,
} from "@/components/finance/AssetMatrix";
import {
  CHAIN_ICONS,
  truncateTechData,
  type SupportedChain,
} from "@/components/atoms/TechDataChip";

type AddressCase = {
  chain: SupportedChain;
  address: string;
  groups: AssetGroup[];
};

const CASES: Record<string, AddressCase> = {
  EVM: {
    chain: "evm",
    address: "0x8d8A6BF26964aF9D7eEd9e03E53415D37aA96045",
    groups: [
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
    ],
  },
  Solana: {
    chain: "solana",
    address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    groups: [
      {
        id: "solana",
        name: "Solana",
        icon: "sol",
        items: [
          {
            id: "sol-sol",
            symbol: "SOL",
            name: "Solana",
            amount: "42.50",
            valueUsd: 6375,
            category: "native",
          },
        ],
      },
    ],
  },
  NEAR: {
    chain: "near",
    address: "alice.near",
    groups: [
      {
        id: "near",
        name: "NEAR",
        icon: "near",
        items: [
          {
            id: "near-near",
            symbol: "NEAR",
            name: "NEAR",
            amount: "1,250.00",
            valueUsd: 5250,
            category: "native",
          },
        ],
      },
    ],
  },
};

/**
 * The source pill from ContextCards, carrying a wallet address instead of a
 * file. It sits above the card with a gap, aligned to the card's left edge,
 * so it labels the table without becoming part of it.
 */
export default function AddressPill({
  variant = "EVM",
}: {
  variant?: string;
} = {}) {
  const sample = CASES[variant] ?? CASES.EVM;

  return (
    <div className="w-fit max-w-full rounded-[12px] bg-page p-4">
      <div className="flex w-[392px] max-w-full flex-col items-start gap-2">
        <span
          className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-inset px-2 text-[12px] font-medium text-ink-2 shadow-btn"
          title={sample.address}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={CHAIN_ICONS[sample.chain]}
            alt=""
            aria-hidden="true"
            className="size-3.5 shrink-0 object-contain"
          />
          <span className="min-w-0 truncate">
            <span className="sm:hidden">
              {truncateTechData(sample.address, sample.chain)}
            </span>
            <span className="hidden sm:inline">{sample.address}</span>
          </span>
        </span>

        <AssetMatrix
          groups={sample.groups}
          title={`${sample.groups[0]?.name ?? ""} balances`}
          showFilters={false}
        />
      </div>
    </div>
  );
}
