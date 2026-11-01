"use client";

import { useCallback, useMemo, useState } from "react";
import type { Wallet } from "@wallet-standard/base";
import { useEvmWallet } from "./evm";
import { useNearWalletAdapter } from "./near";
import { useSolanaWallet } from "./solana";
import type { ChainKind, ConnectedWallet } from "./types";
import { toHex } from "./types";
import { clearThreadCache } from "@/components/app/threadCache";

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

function notifySignIn() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("myntle:sign-in"));
  }
}

export function useWallet() {
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
      setPendingChain("evm");
      setAuthStage("approve");
      let address: string;
      try {
        address = await evm.connect(connectorId);
      } catch (cause) {
        setAuthStage(null);
        setPendingChain(null);
        throw cause;
      }
      setAuthStage("verify");
      try {
        await verifyEvmOwnership(address);
        notifySignIn();
      } catch (cause) {
        await evm.disconnect().catch(() => {});
        throw cause;
      } finally {
        setAuthStage(null);
        setPendingChain(null);
      }
    },
    [evm, verifyEvmOwnership],
  );

  const connectSolanaWallet = useCallback(
    async (wallet: Wallet) => {
      setPendingChain("solana");
      setAuthStage("approve");
      let connection: Awaited<ReturnType<typeof solana.connect>>;
      try {
        connection = await solana.connect(wallet);
      } catch (cause) {
        setAuthStage(null);
        setPendingChain(null);
        throw cause;
      }
      setAuthStage("verify");
      try {
        await verifySolanaOwnership(
          connection.address,
          new Uint8Array(connection.account.publicKey),
        );
        notifySignIn();
      } catch (cause) {
        solana.disconnect();
        throw cause;
      } finally {
        setAuthStage(null);
        setPendingChain(null);
      }
    },
    [solana, verifySolanaOwnership],
  );

  const connectNear = useCallback(async () => {
    setPendingChain("near");
    setAuthStage("approve");
    let address: string;
    try {
      address = await near.connect();
    } catch (cause) {
      setAuthStage(null);
      setPendingChain(null);
      throw cause;
    }
    setAuthStage("verify");
    try {
      await verifyNearOwnership(address);
      notifySignIn();
    } catch (cause) {
      await near.disconnect().catch(() => {});
      throw cause;
    } finally {
      setAuthStage(null);
      setPendingChain(null);
    }
  }, [near, verifyNearOwnership]);

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

  const disconnect = useCallback(async () => {
    void postJson("/api/auth/logout", {}).catch(() => {});
    clearThreadCache();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("myntle:sign-out"));
    }
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
    connectEvm,
    connectSolanaWallet,
    connectNear,
    disconnect,
    signMessage,
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
