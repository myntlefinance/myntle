"use client";

import type { ChainKind } from "./types";

/**
 * The wallet the session was signed in with, remembered per browser.
 *
 * A session outlives its connection: the cookie stays while the extension
 * locks, the site is disconnected from the wallet side, or the tab reloads
 * without auto-reconnect. Signing again (unlock, funding, swap) needs the
 * same wallet, and the picker cannot know which one that was. This record
 * lets the app offer one reconnect to that exact wallet instead of the
 * whole catalogue.
 */

export type LastWallet = {
  kind: ChainKind;
  address: string;
  /** EVM only: the wagmi connector id (rdns for EIP-6963 wallets). */
  connectorId?: string;
  /** Solana only: the Wallet Standard wallet name. */
  walletName?: string;
  /** Display brand, when the adapter knew it. */
  walletIcon?: string;
};

const KEY = "myntle:last-wallet";

export function readLastWallet(): LastWallet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastWallet>;
    if (
      !parsed ||
      (parsed.kind !== "evm" &&
        parsed.kind !== "solana" &&
        parsed.kind !== "near") ||
      typeof parsed.address !== "string" ||
      !parsed.address
    ) {
      return null;
    }
    return {
      kind: parsed.kind,
      address: parsed.address,
      ...(typeof parsed.connectorId === "string"
        ? { connectorId: parsed.connectorId }
        : {}),
      ...(typeof parsed.walletName === "string"
        ? { walletName: parsed.walletName }
        : {}),
      ...(typeof parsed.walletIcon === "string"
        ? { walletIcon: parsed.walletIcon }
        : {}),
    };
  } catch {
    return null;
  }
}

export function saveLastWallet(entry: LastWallet): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // Private mode: the session still works, reconnect just falls back
    // to the picker.
  }
}

export function clearLastWallet(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Already gone.
  }
}
