import type { ChainKind } from "@/lib/wallet/types";

/**
 * Who the browser is signed in as, decided in one place.
 *
 * "Connected" is key access and "signed in" is a session for a specific
 * account. They are different questions, and every surface that answered
 * them separately drifted: a wallet switch or a slow session check left one
 * panel showing an account and another offering to sign in.
 *
 * A session now names its signer. A wallet session belongs to the connected
 * wallet; a passkey session belongs to an Intents account the browser proved
 * with a credential, and it needs no wallet at all.
 */

export type WalletSessionIdentity = {
  kind: "wallet";
  chain: ChainKind;
  address: string;
  intentsAccountId: string;
};

export type PasskeySessionIdentity = {
  kind: "passkey";
  chain: "near";
  address: string;
  accountId: string;
  intentsAccountId: string;
  credentialId: string;
  publicKey: string;
  /** The WebAuthn relying party the credential was created under. */
  rpId: string;
};

export type SessionIdentity = WalletSessionIdentity | PasskeySessionIdentity;

/**
 * A stable key for anything cached per account.
 *
 * EVM addresses are lowercased because the session stores them that way
 * while a wallet returns them checksummed; without this the same account
 * would be two cache entries either side of a session refresh.
 */
export function accountScope(chain: string, address: string): string {
  return `${chain}:${chain === "evm" ? address.toLowerCase() : address}`;
}

/**
 * The server stores EVM addresses lowercase and takes the other chains as
 * given, so a comparison has to match that. A session for one account is
 * never a session for another, and a passkey account is never a wallet.
 */
export function sameAccount(
  chain: ChainKind,
  address: string,
  identity: SessionIdentity,
): boolean {
  if (identity.kind !== "wallet") return false;
  if (chain !== identity.chain) return false;
  return chain === "evm"
    ? address.toLowerCase() === identity.address.toLowerCase()
    : address === identity.address;
}

export function resolveSignedIn(input: {
  status: "unknown" | "signed-out" | "signed-in";
  identity: SessionIdentity | null;
  account: { kind: ChainKind; address: string } | null;
}): boolean {
  const { status, identity, account } = input;
  if (status !== "signed-in" || !identity) return false;
  // A passkey session is signed in by itself: the credential is the signer,
  // so there is no connected wallet to compare it against.
  if (identity.kind === "passkey") return true;
  if (!account) return false;
  return sameAccount(account.kind, account.address, identity);
}

/**
 * Whether this browser can authorise an action for the current session.
 *
 * A passkey session can sign with its credential. A wallet session can sign
 * only while the wallet that owns it is still connected; switching accounts
 * takes that ability away until the new wallet signs in.
 */
export function canSign(input: {
  status: "unknown" | "signed-out" | "signed-in";
  identity: SessionIdentity | null;
  account: { kind: ChainKind; address: string } | null;
}): boolean {
  const { status, identity } = input;
  if (status !== "signed-in" || !identity) return false;
  if (identity.kind === "passkey") return true;
  return resolveSignedIn(input);
}
