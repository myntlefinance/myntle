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
  const { connect, connectors, isPending } = useConnect();
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
    connect: async (connectorId?: string) => {
      const connector =
        connectors.find((c) => c.id === connectorId) ?? connectors[0];
      if (!connector) throw new Error("No EVM wallet is available");
      await connect({ connector });
    },
    disconnect: async () => disconnect(),
    signMessage: sign,
  };
}
