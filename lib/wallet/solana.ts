"use client";

import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { SolanaSignMessage } from "@solana/wallet-standard";
import { useCallback, useEffect, useState } from "react";

/**
 * The message signing feature, spelled out locally.
 *
 * The published type describes the feature under a computed key, which loses
 * the property when it is imported through the re-export chain, so the shape
 * is written out here instead.
 */
type SignMessageFeature = {
  signMessage: (
    ...inputs: readonly { account: WalletAccount; message: Uint8Array }[]
  ) => Promise<readonly { signature: Uint8Array; signedMessage?: Uint8Array }[]>;
};
/**
 * The Solana wallet adapter.
 *
 * The wallet adapter packages were the old way and their 0.x line has been
 * withdrawn from npm, so this uses the Wallet Standard directly. Every Solana
 * wallet that matters implements it, so the list of wallets and the way of
 * signing are the same for all of them.
 */

export type SolanaConnection = {
  wallet: Wallet;
  account: WalletAccount;
  address: string;
};

export function useSolanaWallets() {
  const [wallets, setWallets] = useState<Wallet[]>([]);

  useEffect(() => {
    // The registry is imported inside the effect rather than at the top of
    // the file, because the package reaches for `indexedDB` when it is
    // evaluated and that does not exist on the server.
    const cleanups: (() => void)[] = [];
    let cancelled = false;

    void import("@wallet-standard/app").then(({ getWallets }) => {
      if (cancelled) return;

      const api = getWallets();
      const sync = () => setWallets([...api.get()]);

      sync();
      cleanups.push(api.on("register", sync));
      cleanups.push(api.on("unregister", sync));
    });

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return wallets;
}

export function useSolanaWallet() {
  const wallets = useSolanaWallets();
  const [connection, setConnection] = useState<SolanaConnection | null>(null);

  const connect = useCallback(async (wallet: Wallet) => {
    // A wallet the browser advertises has not necessarily authorised the
    // application yet, so the connect feature is required. A rejection must
    // propagate to the picker; falling back to already-exposed accounts is
    // what let any watch-only address in without approval.
    const feature = wallet.features["standard:connect"] as
      | {
          connect: (input?: unknown) => Promise<{
            accounts: readonly WalletAccount[];
          }>;
        }
      | undefined;
    if (feature) {
      const result = await feature.connect();
      const authorised = result.accounts[0] ?? wallet.accounts[0];
      if (!authorised) {
        throw new Error("This wallet did not share an account");
      }
      const next = {
        wallet,
        account: authorised,
        address: authorised.address,
      };
      setConnection(next);
      return next;
    }
    const account = wallet.accounts[0];
    if (!account) {
      throw new Error("This wallet did not share an account");
    }
    const next = { wallet, account, address: account.address };
    setConnection(next);
    return next;
  }, []);

  const disconnect = useCallback(() => setConnection(null), []);

  const signMessage = useCallback(
    async (payload: Uint8Array): Promise<{ signature: Uint8Array }> => {
      if (!connection) throw new Error("No Solana wallet is connected");

      const feature = connection.wallet.features[
        SolanaSignMessage
      ] as SignMessageFeature | undefined;
      if (!feature) {
        throw new Error("This wallet cannot sign messages");
      }

      const [output] = await feature.signMessage({
        account: connection.account,
        message: payload,
      });

      return { signature: output.signature };
    },
    [connection],
  );

  return { wallets, connection, connect, disconnect, signMessage };
}
