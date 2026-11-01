"use client";

import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { useCallback, useMemo } from "react";
import { fromHex, type ConnectedWallet } from "./types";

/**
 * The EVM adapter.
 *
 * The signing standard is ERC-191, which is what every EVM wallet produces
 * for a personal signature. The account the verifier knows is the address
 * itself, and the public key is recovered from the signature, so nothing
 * about the key has to travel.
 */
export function useEvmWallet() {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const account = useMemo<ConnectedWallet | null>(() => {
    if (!address) return null;
    return {
      kind: "evm",
      standard: "erc191",
      address,
      signerId: address,
      publicKey: "",
    };
  }, [address]);

  const sign = useCallback(
    async (payload: Uint8Array): Promise<Uint8Array> => {
      const signature = await signMessageAsync({ message: { raw: payload } });
      return fromHex(signature);
    },
    [signMessageAsync],
  );

  return {
    account,
    isConnected: isConnected && !!account,
    isPending,
    connectors,
    connect: async (connectorId?: string): Promise<string> => {
      // Connector ids for EIP-6963 wallets are rdns values (for example
      // `io.rabby`), while the picker works with short catalog ids (for
      // example `rabby`). Match exactly first, then by name or rdns, so a
      // card always targets the wallet it names instead of falling back to
      // whichever provider won the `window.ethereum` race.
      const needle = connectorId?.toLowerCase();
      const connector =
        (needle
          ? (connectors.find((c) => c.id === connectorId) ??
            connectors.find(
              (c) =>
                c.id.toLowerCase() === needle ||
                c.name.toLowerCase().includes(needle) ||
                needle.includes(c.name.toLowerCase()),
            ))
          : undefined) ??
        connectors.find((c) => c.id === "injected") ??
        connectors[0];
      if (!connector) throw new Error("No EVM wallet is available");
      // connectAsync waits for the wallet's approval. The plain `connect`
      // returns void immediately, which is what made the picker report
      // success before the user had approved anything.
      const result = await connectAsync({ connector });
      const next = result.accounts?.[0] ?? address;
      if (!next) throw new Error("This wallet did not share an account");
      return next;
    },
    disconnect: async () => disconnect(),
    signMessage: sign,
  };
}
