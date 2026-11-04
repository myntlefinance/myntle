"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Wallet } from "@wallet-standard/base";
import { useEvmWallet } from "./evm";
import { useNearWalletAdapter } from "./near";
import { useSolanaWallet } from "./solana";
import type { ChainKind, ConnectedWallet } from "./types";
import { toHex } from "./types";
import { clearThreadCache } from "@/components/app/threadCache";
import { clearFinanceCaches } from "@/components/app/portfolioCache";

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

/** Where a connection is: asking the wallet, or proving ownership. */
export type AuthStage = "approve" | "verify" | null;

type ChallengeResponse = {
  message: string;
  nonce: string;
  expiresAt: number;
  recipient?: string;
};

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function hexNonceToBytes(nonceHex: string): Uint8Array {
  const out = new Uint8Array(nonceHex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(nonceHex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * The one wallet instance the application shares.
 *
 * The adapters below are stateless readers of their libraries, but
 * `pendingChain` and `authStage` are this hook's own state. Calling the hook
 * from each component gave every one of them a private copy, so the sign-in
 * dialog could be mid-signature while the button beside it reported idle.
 * The provider owns the single copy; `useWallet` reads it.
 */
export type WalletValue = ReturnType<typeof useWalletState>;

export const WalletContext = createContext<WalletValue | null>(null);

export function useWalletState() {
  const evm = useEvmWallet();
  const solana = useSolanaWallet();
  const near = useNearWalletAdapter();

  const [pendingChain, setPendingChain] = useState<ChainKind | null>(null);
  const [authStage, setAuthStage] = useState<AuthStage>(null);

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
        walletName: solana.connection.wallet.name,
        walletIcon: solana.connection.wallet.icon,
      };
    }
    if (near.account) return near.account;
    return null;
  }, [evm.account, solana.connection, near.account]);

  const verifyEvmOwnership = useCallback(
    async (address: string) => {
      const challengeRes = await postJson("/api/auth/challenge", {
        chain: "evm",
        address,
      });
      if (!challengeRes.ok) {
        throw new Error("Could not start verification. Please try again.");
      }
      const challenge = (await challengeRes.json()) as ChallengeResponse;
      const signatureBytes = await evm.signMessage(
        new TextEncoder().encode(challenge.message),
      );
      const verifyRes = await postJson("/api/auth/verify", {
        chain: "evm",
        address,
        message: challenge.message,
        signature: `0x${toHex(signatureBytes)}`,
        nonce: challenge.nonce,
      });
      if (!verifyRes.ok) {
        const body = (await verifyRes
          .json()
          .catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Verification failed. Please try again.");
      }
    },
    [evm],
  );

  const verifySolanaOwnership = useCallback(
    async (address: string, publicKeyBytes: Uint8Array) => {
      const challengeRes = await postJson("/api/auth/challenge", {
        chain: "solana",
        address,
      });
      if (!challengeRes.ok) {
        throw new Error("Could not start verification. Please try again.");
      }
      const challenge = (await challengeRes.json()) as ChallengeResponse;
      const { signature } = await solana.signMessage(
        new TextEncoder().encode(challenge.message),
      );
      const verifyRes = await postJson("/api/auth/verify", {
        chain: "solana",
        address,
        message: challenge.message,
        signature: toHex(signature),
        publicKey: toHex(publicKeyBytes),
        nonce: challenge.nonce,
      });
      if (!verifyRes.ok) {
        const body = (await verifyRes
          .json()
          .catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Verification failed. Please try again.");
      }
    },
    [solana],
  );

  const verifyNearOwnership = useCallback(
    async (address: string) => {
      // The recipient is this app's origin, which is what the wallet shows
      // as who is asking for the signature. It must be recognisable, never
      // a hardcoded account.
      const recipient =
        typeof window !== "undefined" ? window.location.origin : "";
      const challengeRes = await postJson("/api/auth/challenge", {
        chain: "near",
        address,
        ...(recipient ? { recipient } : {}),
      });
      if (!challengeRes.ok) {
        throw new Error("Could not start verification. Please try again.");
      }
      const challenge = (await challengeRes.json()) as ChallengeResponse;
      if (!challenge.recipient) {
        throw new Error("Verification failed. Please try again.");
      }
      const signed = await near.signNEP413({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: hexNonceToBytes(challenge.nonce),
      });
      const verifyRes = await postJson("/api/auth/verify", {
        chain: "near",
        address,
        message: challenge.message,
        signature: signed.signature,
        publicKey: signed.publicKey,
        recipient: challenge.recipient,
        nonce: challenge.nonce,
      });
      if (!verifyRes.ok) {
        const body = (await verifyRes
          .json()
          .catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Verification failed. Please try again.");
      }
    },
    [near],
  );

  const connectEvm = useCallback(
    async (connectorId?: string) => {
      // Connection ends at key access. Identity is a separate, explicit
      // step (signIn) with its own dialog — connecting never signs.
      setPendingChain("evm");
      setAuthStage("approve");
      try {
        return await evm.connect(connectorId);
      } finally {
        setAuthStage(null);
        setPendingChain(null);
      }
    },
    [evm],
  );

  const connectSolanaWallet = useCallback(
    async (wallet: Wallet) => {
      // Connection ends at key access — see connectEvm.
      setPendingChain("solana");
      setAuthStage("approve");
      try {
        await solana.connect(wallet);
      } finally {
        setAuthStage(null);
        setPendingChain(null);
      }
    },
    [solana],
  );

  const connectNear = useCallback(async () => {
    // Connection ends at key access — see connectEvm.
    setPendingChain("near");
    setAuthStage("approve");
    try {
      await near.connect();
    } finally {
      setAuthStage(null);
      setPendingChain(null);
    }
  }, [near]);

  const connect = useCallback(
    async (kind: ChainKind) => {
      if (kind === "evm") await connectEvm();
      else if (kind === "solana") {
        const wallet = solana.wallets[0];
        if (!wallet) {
          throw new Error("No Solana wallet was found in this browser");
        }
        await connectSolanaWallet(wallet);
      } else if (kind === "near") await connectNear();
    },
    [connectEvm, connectSolanaWallet, connectNear, solana.wallets],
  );

  /**
   * The explicit sign-in step, with its own dialog.
   *
   * Connection proves nothing; this signature binds the connected address
   * to the Myntle account. Cancelling leaves the wallet connected but the
   * account unsigned — chats stay gated and the wallet button offers
   * another try instead of a dead end.
   */
  const signIn = useCallback(async () => {
    setAuthStage("verify");
    try {
      if (evm.isConnected && evm.account) {
        await verifyEvmOwnership(evm.account.address);
      } else if (solana.connection) {
        await verifySolanaOwnership(
          solana.connection.address,
          new Uint8Array(solana.connection.account.publicKey),
        );
      } else if (near.isConnected && near.account) {
        await verifyNearOwnership(near.account.address);
      } else {
        throw new Error("No wallet is connected");
      }
      // The provider broadcasts `myntle:sign-in` once it has landed the new
      // status, so every listener reads the state after it changed rather
      // than re-checking the cookie while it is still being written.
    } finally {
      setAuthStage(null);
    }
  }, [evm, near, solana, verifyEvmOwnership, verifyNearOwnership, verifySolanaOwnership]);

  const disconnect = useCallback(async () => {
    const { clearAllIntentsSessions } = await import("@/lib/intents/user-session");
    clearAllIntentsSessions();
    void postJson("/api/auth/logout", {}).catch(() => {});
    clearThreadCache();
    // Balances and history belong to the account that just left, so the
    // next person on this browser never sees a painted snapshot of them.
    clearFinanceCaches();
    // As with sign-in, the `myntle:sign-out` broadcast belongs to the
    // provider so the session state and the event agree.
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

  /**
   * Funds the 1Click deposit address from whichever wallet is connected.
   * The caller passes the exact `amountIn` and token contract from the wet
   * quote; routing by connected chain keeps the transfer on the origin chain.
   */
  const sendDeposit = useCallback(
    async (input: {
      depositAddress: string;
      amount: string;
      tokenAddress?: string | null;
      tokenMint?: string | null;
      tokenContract?: string | null;
      chainId?: number | null;
      chainName?: string | null;
    }): Promise<{ txHash: string; senderAccount?: string }> => {
      if (evm.isConnected) {
        const txHash = await evm.sendDeposit({
          depositAddress: input.depositAddress,
          amount: input.amount,
          tokenAddress: input.tokenAddress ?? input.tokenContract,
          chainId: input.chainId,
          chainName: input.chainName,
        });
        return { txHash };
      }
      if (solana.connection) {
        const txHash = await solana.sendDeposit({
          depositAddress: input.depositAddress,
          amount: input.amount,
          tokenMint: input.tokenMint ?? input.tokenAddress ?? input.tokenContract,
        });
        return { txHash };
      }
      if (near.isConnected) {
        const txHash = await near.sendDeposit({
          depositAddress: input.depositAddress,
          amount: input.amount,
          tokenContract: input.tokenContract ?? input.tokenAddress,
        });
        return { txHash, senderAccount: near.account?.address };
      }
      throw new Error("No wallet is connected");
    },
    [evm, near, solana],
  );

  return {
    account,
    connected: !!account,
    connect,
    connectEvm,
    connectSolanaWallet,
    connectNear,
    signIn,
    disconnect,
    signMessage,
    sendDeposit,
    /** NEP-413 signing for NEAR approvals, with caller-chosen recipient. */
    signNEP413: near.signNEP413,
    pendingChain,
    authStage,
    isPending:
      evm.isPending || near.isPending || authStage !== null,
    /** The Solana wallets the browser is advertising, for the picker. */
    solanaWallets: solana.wallets,
    evmConnectors: evm.connectors,
  };
}

/**
 * The shared wallet instance. Every component sees the same connection,
 * the same pending chain, and the same signature stage.
 */
export function useWallet(): WalletValue {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside the AuthProvider.");
  }
  return value;
}
