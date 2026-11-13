"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  WalletContext,
  useWalletState,
  type WalletValue,
} from "@/lib/wallet/registry";
import {
  canSign as canSignFor,
  sessionAccountFor,
  type SessionIdentity,
} from "@/lib/auth/session-identity";
import { SIGN_IN_EVENT, SIGN_OUT_EVENT } from "@/lib/auth/events";
import {
  authenticatePasskey,
  createPasskey,
  PasskeyError,
} from "@/lib/auth/passkey-client";
import type { ConnectedWallet } from "@/lib/wallet/types";
import { readLastWallet } from "@/lib/wallet/last-wallet";

/**
 * The single source of truth for who is using the app.
 *
 * Three questions used to be answered independently in every component:
 * is a wallet connected, does this browser hold a Myntle session, and is
 * that session for the connected wallet. Each component kept its own copy
 * of the answer and converged through a window event plus a re-fetch that
 * nothing waited for, so a signed-in user could keep seeing "Sign In"
 * until a full page reload.
 *
 * This provider answers all three once. Sign-in and sign-out are actions
 * here rather than events: they land the new state before they return, so
 * every surface reads the same answer in the same render.
 */

export type SessionStatus = "unknown" | "signed-out" | "signed-in";

/** The account the verifier knows, as the session route reports it. */
export type { SessionIdentity } from "@/lib/auth/session-identity";

export { SIGN_IN_EVENT, SIGN_OUT_EVENT } from "@/lib/auth/events";

type AuthValue = {
  /** The shared wallet instance: connection, signature stage, adapters. */
  wallet: WalletValue;
  /** The account the interface shows: the session account, or the connected wallet when signed out. */
  account: ConnectedWallet | null;
  /** Whether this browser holds a session, and whose it is. */
  status: SessionStatus;
  identity: SessionIdentity | null;
  /**
   * A signed-in session exists. The browser wallet may be a separate funding
   * source; `canSign` says whether the session wallet is currently connected.
   */
  signedIn: boolean;
  connected: boolean;
  /** How this session signs: a wallet, a passkey, or nothing yet. */
  authMethod: "wallet" | "passkey" | null;
  /** The current session can authorise an action right now. */
  canSign: boolean;
  /** A signature or connection is in flight anywhere in the app. */
  busy: boolean;
  signIn: () => Promise<void>;
  /** Create a passkey-owned account and land its session. */
  createPasskeyAccount: () => Promise<void>;
  /** Sign in with an existing passkey, with no wallet involved. */
  signInWithPasskey: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-read the session from the server. */
  refresh: () => Promise<SessionStatus>;
};

const AuthContext = createContext<AuthValue | null>(null);

type SessionReply =
  | { status: "signed-in"; identity: SessionIdentity }
  | { status: "signed-out" };

async function readSession(): Promise<SessionReply> {
  try {
    const res = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return { status: "signed-out" };
    const body = (await res.json()) as {
      authenticated?: boolean;
      accountKind?: string;
      accountId?: string;
      intentsAccountId?: string;
      credentialId?: string;
      publicKey?: string;
      rpId?: string;
      chain?: "evm" | "solana" | "near";
      address?: string;
    };
    if (!body.authenticated) return { status: "signed-out" };

    if (body.accountKind === "passkey") {
      const accountId = body.accountId ?? body.address;
      // The credential, public key, and relying party are what let the
      // browser sign after a reload. A passkey session that cannot describe
      // its signer is not a usable session, so it is reported as signed out
      // rather than half-on.
      if (!accountId || !body.credentialId || !body.publicKey || !body.rpId) {
        return { status: "signed-out" };
      }
      return {
        status: "signed-in",
        identity: {
          kind: "passkey",
          chain: "near",
          address: body.address ?? accountId,
          accountId,
          intentsAccountId: body.intentsAccountId ?? accountId,
          credentialId: body.credentialId,
          publicKey: body.publicKey,
          rpId: body.rpId,
        },
      };
    }

    if (!body.chain || !body.address) return { status: "signed-out" };
    return {
      status: "signed-in",
      identity: {
        kind: "wallet",
        chain: body.chain,
        address: body.address,
        // Older deployments omit the field; the session address is what the
        // wallet path used before it existed.
        intentsAccountId: body.intentsAccountId ?? body.address,
      },
    };
  } catch {
    // A failed check is not evidence that the session ended, but guessing
    // "signed in" would send requests that 401. Ask the user to sign in
    // again, which is recoverable either way.
    return { status: "signed-out" };
  }
}

/** The Intents account a connected wallet signs as, without a server read. */
function walletIntentsAccountId(account: ConnectedWallet): string {
  if (account.kind === "evm") return account.address.toLowerCase();
  if (account.kind === "solana") return account.signerId;
  return account.address;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWalletState();
  const [state, setState] = useState<{
    status: SessionStatus;
    identity: SessionIdentity | null;
  }>({ status: "unknown", identity: null });

  const statusRef = useRef<SessionStatus>("unknown");
  // Every transition bumps the sequence. A check that was already in flight
  // when the user signed in is discarded instead of overwriting the answer.
  const sequence = useRef(0);

  const apply = useCallback(
    (status: SessionStatus, identity: SessionIdentity | null) => {
      sequence.current += 1;
      statusRef.current = status;
      setState({ status, identity });
    },
    [],
  );

  const refresh = useCallback(async (): Promise<SessionStatus> => {
    const mine = sequence.current + 1;
    sequence.current = mine;
    const reply = await readSession();
    if (mine !== sequence.current) return statusRef.current;
    apply(
      reply.status,
      reply.status === "signed-in" ? reply.identity : null,
    );
    return reply.status;
  }, [apply]);

  // One check for the whole application, on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Anything outside React that ends the session still lands here, and the
  // events stay for the UI cleanup they drive (thread lists, redirects).
  useEffect(() => {
    const onSignOut = () => apply("signed-out", null);
    const onSignIn = () => {
      void refresh();
    };
    window.addEventListener(SIGN_OUT_EVENT, onSignOut);
    window.addEventListener(SIGN_IN_EVENT, onSignIn);
    return () => {
      window.removeEventListener(SIGN_OUT_EVENT, onSignOut);
      window.removeEventListener(SIGN_IN_EVENT, onSignIn);
    };
  }, [apply, refresh]);

  const signIn = useCallback(async () => {
    // Connection is not identity. Once a session exists, changing who is
    // signed in is a deliberate logout, not a side effect of connecting a
    // funding wallet.
    if (state.status === "signed-in") {
      throw new Error("Log out before signing in with another wallet.");
    }
    const account = wallet.account;
    await wallet.signIn();
    // The verify response has already set the cookie when this resolves, so
    // the session exists now. Land it before returning; the reconcile below
    // is a correction, never the thing the UI waits on.
    apply(
      "signed-in",
      account
        ? {
            kind: "wallet",
            chain: account.kind,
            address: account.address,
            intentsAccountId: walletIntentsAccountId(account),
          }
        : null,
    );
    window.dispatchEvent(new CustomEvent(SIGN_IN_EVENT));
    void refresh();
  }, [apply, refresh, state.status, wallet]);

  // The passkey routes set the cookie themselves, so the identity is read
  // back from the session route rather than guessed from the credential.
  const landPasskeySession = useCallback(
    async (failure: string) => {
      const status = await refresh();
      if (status !== "signed-in") throw new PasskeyError(failure);
      window.dispatchEvent(new CustomEvent(SIGN_IN_EVENT));
    },
    [refresh],
  );

  const createPasskeyAccount = useCallback(async () => {
    await createPasskey();
    await landPasskeySession(
      "Your passkey was created, but the session did not start. Try signing in.",
    );
  }, [landPasskeySession]);

  const signInWithPasskey = useCallback(async () => {
    await authenticatePasskey();
    await landPasskeySession(
      "That passkey did not start a session. Please try again.",
    );
  }, [landPasskeySession]);

  const signOut = useCallback(async () => {
    // Start the wallet teardown first: it masks the account synchronously,
    // so the session and the account control leave in the same render and
    // no frame exists where the control reads "Sign In" — connected, with
    // no session — while the wallet lets go. The request itself is awaited
    // after the interface has already changed.
    const teardown = wallet.disconnect();
    apply("signed-out", null);
    window.dispatchEvent(new CustomEvent(SIGN_OUT_EVENT));
    await teardown;
  }, [apply, wallet]);

  const actualAccount = wallet.account;
  // Brand falls back to the wallet the session was signed in with when
  // the connection is gone (reload without auto-reconnect): the record
  // only ever stands in for its own account, checked inside.
  const account = useMemo(
    () =>
      sessionAccountFor(state.identity, actualAccount, readLastWallet()),
    [state.identity, actualAccount],
  );
  // A session stays signed in while the browser wallet is used for something
  // else, such as funding. Signing authority remains the actual account.
  const signedIn = state.status === "signed-in" && state.identity !== null;
  const authMethod =
    state.status === "signed-in" ? (state.identity?.kind ?? null) : null;
  const canSign = canSignFor({
    status: state.status,
    identity: state.identity,
    account: actualAccount,
  });

  const value = useMemo<AuthValue>(
    () => ({
      wallet,
      account,
      status: state.status,
      identity: state.identity,
      signedIn,
      connected: !!account,
      authMethod,
      canSign,
      busy:
        wallet.isPending ||
        wallet.pendingChain !== null ||
        wallet.authStage !== null,
      signIn,
      createPasskeyAccount,
      signInWithPasskey,
      signOut,
      refresh,
    }),
    [
      wallet,
      state.status,
      state.identity,
      signedIn,
      account,
      authMethod,
      canSign,
      signIn,
      createPasskeyAccount,
      signInWithPasskey,
      signOut,
      refresh,
    ],
  );

  return (
    <WalletContext.Provider value={wallet}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </WalletContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside the AuthProvider.");
  }
  return value;
}
