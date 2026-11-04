"use client";

import { useAccount, useChainId, useConfig, useConnect, useDisconnect, useSendTransaction, useSignMessage, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { useCallback, useMemo } from "react";
import { erc20Abi } from "viem";
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
  const { address, connector, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const chainId = useChainId();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();

  const account = useMemo<ConnectedWallet | null>(() => {
    if (!address) return null;
    return {
      kind: "evm",
      standard: "erc191",
      address,
      signerId: address,
      publicKey: "",
      walletName: connector?.name,
      walletIcon: connector?.icon,
    };
  }, [address, connector]);

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
    /**
     * Funds the 1Click deposit address from the connected EVM wallet.
     *
     * Native assets travel as value; ERC-20 assets travel as `transfer`.
     * The amount must be the exact `amountIn` from the wet quote.
     */
    sendDeposit: async (input: {
      depositAddress: string;
      amount: string;
      tokenAddress?: string | null;
      chainId?: number | null;
      chainName?: string | null;
    }): Promise<string> => {
      if (!input.depositAddress || !input.amount) throw new Error("Missing deposit details");
      // An EVM token with no known origin chain would send on whatever
      // network the wallet happens to be on. Refuse instead of mis-sending.
      if (input.tokenAddress?.startsWith("0x") && !input.chainId) {
        throw new Error("unsupported-network");
      }
      // Fund the deposit on the quote's origin chain. Without the switch the
      // transfer lands on the wallet's current network — an Arbitrum deposit
      // quoted while the wallet sits on Ethereum sends on Ethereum.
      if (input.chainId && chainId !== input.chainId) {
        try {
          await switchChainAsync({ chainId: input.chainId });
        } catch {
          throw new Error("chain-switch-rejected");
        }
      }
      // Wait for the deposit to confirm onchain before returning the hash,
      // so the card only advances once the funds have actually moved. A
      // slow confirmation still returns the broadcast hash — the status poll,
      // not this wait, is authoritative.
      const confirmed = async (hash: `0x${string}`): Promise<string> => {
        try {
          await waitForTransactionReceipt(config, {
            hash,
            chainId: input.chainId ?? undefined,
            confirmations: 1,
            timeout: 120_000,
          });
        } catch {
          // Continue with the hash; the poll watches the deposit address.
        }
        return hash;
      };
      if (input.tokenAddress) {
        return confirmed(
          await writeContractAsync({
            address: input.tokenAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: "transfer",
            args: [input.depositAddress as `0x${string}`, BigInt(input.amount)],
          }),
        );
      }
      return confirmed(
        await sendTransactionAsync({
          to: input.depositAddress as `0x${string}`,
          value: BigInt(input.amount),
        }),
      );
    },
  };
}
