"use client";

import { useState } from "react";
import { IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { CHAINS, useWallet } from "@/lib/wallet/registry";
import type { ChainKind } from "@/lib/wallet/types";

/**
 * The wallet control.
 *
 * It opens a chain picker rather than a wallet picker, because the chain
 * decides which wallets make sense, and then the wallet list for that chain.
 */
export function WalletButton() {
  const { account, connected, connect, disconnect, pendingChain, isPending } =
    useWallet();
  const [open, setOpen] = useState(false);

  if (connected && account) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 rounded-[8px] bg-inset px-2.5 py-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-accent-tint text-[10px] font-semibold uppercase text-accent-ink">
            {account.kind === "evm"
              ? "evm"
              : account.kind === "solana"
                ? "sol"
                : "near"}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
            {account.address}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void disconnect()}
          className="rounded-[8px] px-2.5 py-1.5 text-[12.5px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink-2"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="flex w-full items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink shadow-btn transition-colors duration-100 hover:bg-hover disabled:opacity-60"
      >
        {isPending ? (
          <IconLoader2 size={14} stroke={1.8} className="animate-spin" />
        ) : null}
        <span className="flex-1 text-left">
          {isPending ? "Connecting" : "Connect a wallet"}
        </span>
        <IconChevronDown size={14} stroke={1.8} className="text-ink-3" />
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-1.5 w-full overflow-hidden rounded-[10px] border border-line bg-surface shadow-overlay">
          {CHAINS.map((chain) => (
            <button
              key={chain.kind}
              type="button"
              disabled={pendingChain !== null}
              onClick={() => {
                setOpen(false);
                void connect(chain.kind as ChainKind);
              }}
              className="block w-full px-2.5 py-2 text-left transition-colors duration-100 hover:bg-hover disabled:opacity-60"
            >
              <span className="block text-[13px] font-medium text-ink">
                {chain.label}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">
                {chain.detail}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
