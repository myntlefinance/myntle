"use client";

import { useCallback, useMemo, useState } from "react";
import { useEvmWallet } from "./evm";
import { useNearWalletAdapter } from "./near";
import { useSolanaWallet } from "./solana";
import type { ChainKind, ConnectedWallet } from "./types";

/**
 * One wallet interface over three libraries.
 *
 * The rest of the application never asks which chain a user is on. It asks
 * for an account and for a signature, and gets both.
 */

export type ChainOption = {
  kind: ChainKind;
  label: string;
  /** A short line describing what connecting gives you. */
  detail: string;
};

export const CHAINS: ChainOption[] = [
  {
    kind: "evm",
    label: "Ethereum",
    detail: "MetaMask, Rabby, Rainbow, or any WalletConnect wallet",
  },
  {
    kind: "solana",
    label: "Solana",
    detail: "Phantom, Solflare, or any Wallet Standard wallet",
  },
  {
    kind: "near",
    label: "NEAR",
    detail: "MyNearWallet, Meteor, Sender, or Ledger",
  },
];

export function useWallet() {
  const evm = useEvmWallet();
  const solana = useSolanaWallet();
  const near = useNearWalletAdapter();

  const [pendingChain, setPendingChain] = useState<ChainKind | null>(null);

  const adapters = useMemo(
    () => ({ evm, solana, near }),
    [evm, solana, near],
  );

  const account = useMemo<ConnectedWallet | null>(() => {
    if (evm.account) return evm.account;
    if (solana.connection) {
      return {
        kind: "solana",
        standard: "raw_ed25519",
        address: solana.connection.address,
        // The verifier identifies an Ed25519 account by the hexadecimal form
        // of the public key, and the wallet standard hands that over directly.
        signerId: Array.from(solana.connection.account.publicKey)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
        publicKey: `ed25519:${solana.connection.address}`,
      };
    }
    if (near.account) return near.account;
    return null;
  }, [evm.account, solana.connection, near.account]);

  const connect = useCallback(
    async (kind: ChainKind) => {
      setPendingChain(kind);
      try {
        if (kind === "evm") await evm.connect();
        else if (kind === "solana") {
          const wallet = solana.wallets[0];
          if (!wallet) {
            throw new Error("No Solana wallet was found in this browser");
          }
          solana.connect(wallet);
        } else if (kind === "near") await near.connect();
      } finally {
        setPendingChain(null);
      }
    },
    [evm, near, solana],
  );

  const disconnect = useCallback(async () => {
    if (evm.isConnected) await evm.disconnect();
    else if (solana.connection) solana.disconnect();
    else if (near.isConnected) await near.disconnect();
  }, [evm, near, solana]);

  const signMessage = useCallback(
    async (payload: Uint8Array): Promise<Uint8Array> => {
      if (evm.isConnected) return evm.signMessage(payload);
      if (solana.connection) {
        const { signature } = await solana.signMessage(payload);
        return signature;
      }
      if (near.isConnected) return near.signMessage(payload);
      throw new Error("No wallet is connected");
    },
    [evm, near, solana],
  );

  return {
    account,
    connected: !!account,
    connect,
    disconnect,
    signMessage,
    pendingChain,
    isPending: evm.isPending || near.isPending,
    /** The Solana wallets the browser is advertising, for the picker. */
    solanaWallets: solana.wallets,
    evmConnectors: evm.connectors,
  };
}
