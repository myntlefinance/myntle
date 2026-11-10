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
import {
  clearLastWallet,
  readLastWallet,
  saveLastWallet,
  type LastWallet,
} from "./last-wallet";

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

/**
 * A confirmed sign-out, remembered per tab.
 *
 * A reload asks the wallet libraries to restore their sessions again; a
 * wallet that never released the site would come back connected, and the
 * next press would resume sign-in instead of opening the selector. The
 * marker keeps the tab in the state the user chose until they connect.
 */
const SEVERED_KEY = "myntle:signed-out";

function readSevered(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SEVERED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSevered(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (next) window.sessionStorage.setItem(SEVERED_KEY, "1");
    else window.sessionStorage.removeItem(SEVERED_KEY);
  } catch {
    // Storage unavailable; the in-memory flag still covers this visit.
  }
}

export function useWalletState() {
  const evm = useEvmWallet();
  const solana = useSolanaWallet();
  const near = useNearWalletAdapter();

  const [pendingChain, setPendingChain] = useState<ChainKind | null>(null);
  const [authStage, setAuthStage] = useState<AuthStage>(null);
  /**
   * The wallet the session was signed in with, for one-click reconnect.
   *
   * A session outlives its connection, so a locked extension or a
   * wallet-side disconnect must not force a full log-in. This record names
   * the exact wallet to ask again, instead of the whole catalogue.
   */
  const [lastWallet, setLastWallet] = useState<LastWallet | null>(() =>
    readLastWallet(),
  );

  const rememberLastWallet = useCallback((entry: LastWallet) => {
    setLastWallet(entry);
    saveLastWallet(entry);
  }, []);
  /**
   * Set by a confirmed sign-out and cleared only by a new connection.
   *
   * A wallet library can keep reporting an account after its disconnect
   * request fails — an expired WalletConnect session, an extension that
   * refuses to revoke the site. The interface still has to land in the
   * disconnected state, or the next press resumes sign-in on the account
   * the user just tried to leave instead of opening the wallet selector.
   */
  const [severed, setSeveredState] = useState(readSevered);

  const setSevered = useCallback((next: boolean) => {
    setSeveredState(next);
    writeSevered(next);
  }, []);

  const adapters = useMemo(
    () => ({ evm, solana, near }),
    [evm, solana, near],
  );

  const account = useMemo<ConnectedWallet | null>(() => {
    if (severed) return null;
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
  }, [evm.account, solana.connection, near.account, severed]);

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
        const address = await evm.connect(connectorId);
        // A new connection is the one the interface must show from now on.
        setSevered(false);
        // Remember the exact wallet for one-click reconnect: a session
        // outlives its connection, so the unlock dialog must ask this
        // wallet again instead of the whole catalogue.
        const needle = connectorId?.toLowerCase();
        const used =
          (needle
            ? (evm.connectors.find((c) => c.id === connectorId) ??
              evm.connectors.find(
                (c) =>
                  c.id.toLowerCase() === needle ||
                  c.name.toLowerCase().includes(needle) ||
                  needle.includes(c.name.toLowerCase()),
              ))
            : undefined) ??
          evm.connectors.find((c) => c.id === "injected") ??
          evm.connectors[0];
        if (used) {
          rememberLastWallet({
            kind: "evm",
            address,
            connectorId: used.id,
            walletName: used.name,
            walletIcon: typeof used.icon === "string" ? used.icon : undefined,
          });
        }
        return address;
      } finally {
        setAuthStage(null);
        setPendingChain(null);
      }
    },
    [evm, rememberLastWallet, setSevered],
  );

  const connectSolanaWallet = useCallback(
    async (wallet: Wallet) => {
      // Connection ends at key access — see connectEvm.
      setPendingChain("solana");
      setAuthStage("approve");
      try {
        const next = await solana.connect(wallet);
        setSevered(false);
        rememberLastWallet({
          kind: "solana",
          address: next.address,
          walletName: wallet.name,
          walletIcon: wallet.icon,
        });
      } finally {
        setAuthStage(null);
        setPendingChain(null);
      }
    },
    [rememberLastWallet, setSevered, solana],
  );

  const connectNear = useCallback(async () => {
    // Connection ends at key access — see connectEvm.
    setPendingChain("near");
    setAuthStage("approve");
    try {
      const address = await near.connect();
      setSevered(false);
      rememberLastWallet({ kind: "near", address });
    } finally {
      setAuthStage(null);
      setPendingChain(null);
    }
  }, [near, rememberLastWallet, setSevered]);

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
        const connectorId =
          evm.connectors.find((c) => c.name === evm.account?.walletName)?.id ??
          evm.connectors[0]?.id;
        rememberLastWallet({
          kind: "evm",
          address: evm.account.address,
          ...(connectorId ? { connectorId } : {}),
          walletName: evm.account.walletName,
          walletIcon: evm.account.walletIcon,
        });
      } else if (solana.connection) {
        await verifySolanaOwnership(
          solana.connection.address,
          new Uint8Array(solana.connection.account.publicKey),
        );
        rememberLastWallet({
          kind: "solana",
          address: solana.connection.address,
          walletName: solana.connection.wallet.name,
          walletIcon: solana.connection.wallet.icon,
        });
      } else if (near.isConnected && near.account) {
        await verifyNearOwnership(near.account.address);
        rememberLastWallet({ kind: "near", address: near.account.address });
      } else {
        throw new Error("No wallet is connected");
      }
      // The provider broadcasts `myntle:sign-in` once it has landed the new
      // status, so every listener reads the state after it changed rather
      // than re-checking the cookie while it is still being written.
    } finally {
      setAuthStage(null);
    }
  }, [evm, near, rememberLastWallet, solana, verifyEvmOwnership, verifyNearOwnership, verifySolanaOwnership]);

  /**
   * Reconnect the wallet the session was signed in with, without a picker.
   *
   * A signed-in session survives a wallet-side disconnect, but unlocking and
   * signing need key access again. This asks the saved wallet only: the EVM
   * connector id targets its own provider, Solana reuses its Wallet Standard
   * entry, NEAR reopens its wallet. Nothing signs here; the caller signs next.
   */
  const reconnectWallet = useCallback(async () => {
    const saved = lastWallet ?? readLastWallet();
    if (!saved) throw new Error("No saved wallet. Log in again.");
    if (saved.kind === "evm") {
      await connectEvm(saved.connectorId);
      return;
    }
    if (saved.kind === "solana") {
      const target = saved.walletName
        ? solana.wallets.find(
            (w) =>
              w.name === saved.walletName ||
              w.name.toLowerCase().includes(saved.walletName!.toLowerCase()) ||
              saved.walletName!.toLowerCase().includes(w.name.toLowerCase()),
          )
        : solana.wallets[0];
      if (!target) throw new Error("Wallet not detected. Please try again.");
      await connectSolanaWallet(target);
      return;
    }
    await connectNear();
  }, [connectEvm, connectNear, connectSolanaWallet, lastWallet, solana.wallets]);

  const disconnect = useCallback(async () => {
    // The interface leaves the account behind before the wallets are asked
    // to let go. A refused or slow request must not leave a connected-looking
    // state that makes the next press resume sign-in instead of the selector.
    setSevered(true);
    setLastWallet(null);
    clearLastWallet();
    const [{ clearAllIntentsSessions }, { releaseFundingConnections }] =
      await Promise.all([
        import("@/lib/intents/user-session"),
        import("@/lib/wallet/funding/release"),
      ]);
    clearAllIntentsSessions();
    clearThreadCache();
    // Balances and history belong to the account that just left, so the
    // next person on this browser never sees a painted snapshot of them.
    clearFinanceCaches();
    // As with sign-in, the `myntle:sign-out` broadcast belongs to the
    // provider so the session state and the event agree.
    //
    // Every adapter is severed, not just the first one that looks connected:
    // a browser can hold more than one wallet at a time, and leaving one
    // behind is what makes the account button land back on "Sign In". Each
    // call is settled independently so a wallet that refuses cannot stop
    // the others from being disconnected. The logout request is part of the
    // same settle: the cookie is what a reload reads, so it must be gone
    // before sign-out is treated as finished. The funding grants are a
    // second, separate wallet authorisation made by the deposit dialog;
    // they are released here too, so a funding wallet cannot survive into
    // the next login.
    await Promise.allSettled([
      postJson("/api/auth/logout", {}).catch(() => {}),
      releaseFundingConnections(),
      evm.account ? evm.disconnect() : Promise.resolve(),
      solana.connection ? solana.disconnect() : Promise.resolve(),
      near.isConnected ? near.disconnect() : Promise.resolve(),
    ]);
  }, [evm, near, setSevered, solana, setLastWallet]);

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
    /** The wallet the session was signed in with, for one-click reconnect. */
    lastWallet,
    /** Reconnect the saved wallet without opening the picker. */
    reconnectWallet,
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
