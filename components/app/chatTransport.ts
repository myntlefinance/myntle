import type { SessionIdentity } from "@/lib/auth/session-identity";
import {
  getValidAccessToken,
  isSuperUnlocked,
} from "@/lib/intents/user-session";

/**
 * The chat transport reads the User-Session for whoever is signed in.
 *
 * A passkey session is keyed by its own account id, because there is no
 * connected wallet to derive a key from. The wallet path keeps its existing
 * key: the connected wallet's chain and address, so switching to a passkey
 * account cannot reuse a wallet's private session and vice versa.
 */

export type ChatTransportAccount = {
  kind: string;
  address: string;
} | null;

export async function chatRequestHeaders(input: {
  identity: SessionIdentity | null;
  account: ChatTransportAccount;
}): Promise<Record<string, string>> {
  if (input.identity?.kind === "passkey") {
    const token = await getValidAccessToken(
      "passkey",
      input.identity.accountId,
    );
    return token ? { "x-intents-access-token": token } : {};
  }

  const acc = input.account;
  if (!acc) return {};
  const token = await getValidAccessToken(acc.kind, acc.address);
  return token ? { "x-intents-access-token": token } : {};
}

/** Whether the private balance is unlocked for the signed-in account. */
export function chatSuperUnlocked(input: {
  identity: SessionIdentity | null;
  account: ChatTransportAccount;
}): boolean {
  if (input.identity?.kind === "passkey") {
    return isSuperUnlocked("passkey", input.identity.accountId);
  }
  return isSuperUnlocked(input.account?.kind, input.account?.address);
}
