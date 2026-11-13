"use client";

import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconLockFilled, IconLockOpen } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { DialogShell } from "@/components/app/DialogShell";
import { useWallet } from "@/lib/wallet/registry";
import { useAuth } from "@/lib/auth/auth-provider";
import { PasskeyError } from "@/lib/auth/passkey-client";
import { signIntentWithPasskey } from "@/lib/auth/passkey-signer";
import type { PasskeySessionIdentity } from "@/lib/auth/session-identity";
import {
  buildEmptyIntent,
  buildPasskeyEmptyIntent,
  encodeSignedData,
} from "@/lib/intents/empty-intent";
import { fetchNearSetup } from "@/lib/intents/near-setup";
import {
  notifySuperClosed,
  notifySuperUnlock,
  saveIntentsSession,
  SUPER_CANCEL_EVENT,
  SUPER_CONTINUE_EVENT,
  SUPER_UNLOCK_EVENT,
} from "@/lib/intents/user-session";

export const OPEN_SUPER_EVENT = "myntle:open-super";

/** Set true to open this dialog on its own after sign-in. */
export const SUPER_AUTO_SHOW = false;

const ONE_CLICK =
  process.env.NEXT_PUBLIC_ONE_CLICK_BASE_URL ?? "https://1click.chaindefuser.com";

/**
 * A maintenance window returns a 521 without CORS headers, so the browser
 * reports a CORS/network failure before the app can read the status. Say the
 * service is unavailable rather than telling the user their signature failed.
 */
const SERVICE_UNAVAILABLE =
  "The private balance service is unavailable. Try again later.";

export function openSuperUnlock(callId?: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_SUPER_EVENT, { detail: { callId } }),
  );
}

function friendlyUnlockError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : "";
  if (raw === SERVICE_UNAVAILABLE) return raw;
  if (/failed to fetch|networkerror|load failed|cors|err_failed/i.test(raw)) {
    return SERVICE_UNAVAILABLE;
  }
  if (/reject|cancel|denied|dismiss/i.test(raw)) {
    return "Signature was rejected. Nothing changed.";
  }
  if (/locked/i.test(raw)) {
    return raw;
  }
  if (
    /No wallet is connected|super account yet|not detected|No saved wallet|Log in to unlock|disconnected/i.test(
      raw,
    )
  ) {
    return raw;
  }
  return "Unlock failed. Please try again.";
}

type Phase = "idle" | "signing" | "authenticating" | "unlocked" | "error";

const PASSKEY_UNLOCK_FAILED =
  "The private balance could not be unlocked. Please try again.";

function friendlyPasskeyUnlockError(cause: unknown): string {
  if (cause instanceof PasskeyError) {
    // The shared signer is written for a trade; an unlock is not one.
    return cause.message.replace("this trade", "this unlock");
  }
  if (cause instanceof Error && cause.message === SERVICE_UNAVAILABLE) {
    return SERVICE_UNAVAILABLE;
  }
  if (cause instanceof Error && cause.message === PASSKEY_UNLOCK_FAILED) {
    return PASSKEY_UNLOCK_FAILED;
  }
  return "Unlock failed. Please try again.";
}

/**
 * The passkey half of the unlock, without the dialog.
 *
 * One empty intent addressed to `intents.near`, one WebAuthn assertion, one
 * User-Session stored under the `passkey` key. Nothing is submitted and no
 * funds move. The caller drives the phases and the success screen.
 */
export async function unlockPrivateBalanceWithPasskey(
  identity: PasskeySessionIdentity,
  onPhase?: (phase: "signing" | "authenticating") => void,
): Promise<void> {
  onPhase?.("signing");
  const built = await buildPasskeyEmptyIntent(identity.accountId);
  const signedData = await signIntentWithPasskey(built.payload, identity);

  onPhase?.("authenticating");
  let res: Response;
  try {
    res = await fetch(`${ONE_CLICK}/v0/auth/authenticate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedData }),
    });
  } catch {
    throw new Error(SERVICE_UNAVAILABLE);
  }

  if (res.status >= 500) {
    throw new Error(SERVICE_UNAVAILABLE);
  }

  const data = (await res.json().catch(() => null)) as {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    refreshExpiresIn?: number;
  } | null;

  if (!res.ok || !data?.accessToken || !data?.refreshToken) {
    throw new Error(PASSKEY_UNLOCK_FAILED);
  }

  saveIntentsSession({
    chain: "passkey",
    address: identity.accountId,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : 900,
    refreshExpiresIn:
      typeof data.refreshExpiresIn === "number" ? data.refreshExpiresIn : 0,
  });
  notifySuperUnlock();
}

/**
 * The private-balance dialog, in plain words.
 *
 * A wallet signs its chain-specific ownership proof; a passkey signs the
 * empty intent addressed to `intents.near`. Either way one proof mints the
 * User-Session, the tokens stay in this browser only, and the server never
 * sees them. Cancel leaves the user fully logged in; everything except
 * balance-backed actions keeps working.
 */
export function SuperUnlockDialog({
  onClose,
  onUnlocked,
  onNeedsSetup,
  sourceCallId,
}: {
  onClose: () => void;
  /** Fires once the tokens are stored, before the success screen lands. */
  onUnlocked?: () => void;
  /** The signed-in NEAR account has not registered this wallet key yet. */
  onNeedsSetup?: () => void;
  /** The card that opened this dialog, so a cancel can be reported back. */
  sourceCallId?: string | null;
}) {
  const {
    account: rawAccount,
    signMessage,
    signNEP413,
    getNearPublicKey,
    lastWallet,
    reconnectWallet,
    isPending: walletPending,
  } = useWallet();
  const { identity, account: sessionAccount, signedIn } = useAuth();
  const passkey = identity?.kind === "passkey" ? identity : null;
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const busy = phase === "signing" || phase === "authenticating" || reconnecting;
  const notice = phase === "unlocked" || Boolean(error);

  // The session names the account to unlock. The raw connection is only key
  // access: it can be gone while the session lives, and unlocking then needs
  // a reconnect to the same wallet, not a new log-in.
  const sessionAddress = passkey
    ? passkey.accountId
    : (sessionAccount?.address ?? null);
  const matchesSession =
    !passkey &&
    rawAccount &&
    sessionAccount &&
    rawAccount.kind === sessionAccount.kind &&
    (rawAccount.kind === "evm"
      ? rawAccount.address.toLowerCase() === sessionAccount.address.toLowerCase()
      : rawAccount.address === sessionAccount.address);
  // Signed in but the signing key is gone (extension locked, site
  // disconnected from the wallet side). Reading still works; signing needs
  // the same wallet again.
  const needsReconnect =
    !passkey && signedIn && sessionAddress !== null && !matchesSession;
  const reconnectName =
    lastWallet?.walletName ?? sessionAccount?.walletName ?? null;

  // Same rhythm as the sign-in dialog: the success notice reads first, then
  // the dialog fades out. The paused turn resumes as the fade starts, so the
  // reply is already arriving by the time the overlay is gone.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (phase !== "unlocked") return;
    const fade = window.setTimeout(() => {
      setLeaving(true);
      window.dispatchEvent(new CustomEvent(SUPER_CONTINUE_EVENT));
    }, 850);
    // The portfolio behind the dialog has usually finished its private read
    // by now. Tell it the overlay is gone so it reveals the fetched rows,
    // instead of swapping the locked background mid-dialog.
    const done = window.setTimeout(() => {
      notifySuperClosed();
      closeRef.current();
    }, 1100);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [phase]);

  const handleReconnect = async () => {
    if (reconnecting) return;
    setError(null);
    setReconnecting(true);
    try {
      await reconnectWallet();
    } catch (cause) {
      setError(friendlyUnlockError(cause));
      setPhase("error");
    } finally {
      setReconnecting(false);
    }
  };

  const handleUnlock = async () => {
    setError(null);
    // A passkey account has no wallet. The proof is one empty intent signed
    // by the credential, so this branch runs before the wallet check.
    if (passkey) {
      setPhase("signing");
      try {
        await unlockPrivateBalanceWithPasskey(passkey, setPhase);
        onUnlocked?.();
        setPhase("unlocked");
      } catch (cause) {
        setError(friendlyPasskeyUnlockError(cause));
        setPhase("error");
      }
      return;
    }
    // The session survives a wallet-side disconnect. Ask for the same wallet
    // again instead of failing; the button above drives this state.
    if (!matchesSession || !sessionAccount) {
      setError(
        signedIn
          ? reconnectName
            ? `Your ${reconnectName} disconnected. Reconnect it to continue.`
            : "Your wallet disconnected. Reconnect it to continue."
          : "Log in to unlock.",
      );
      setPhase("error");
      return;
    }
    const account = sessionAccount;
    if (account.kind !== "evm" && account.kind !== "solana" && account.kind !== "near") {
      setError("This wallet cannot unlock the super account yet.");
      setPhase("error");
      return;
    }
    // A named NEAR account must register its wallet key once. Hand off before
    // asking for the empty-intent signature, because 1Click would reject it
    // with the same generic `signature verification failed` either way.
    if (account.kind === "near" && onNeedsSetup) {
      setPhase("signing");
      try {
        let publicKey: string | null = null;
        try {
          publicKey = getNearPublicKey
            ? (await getNearPublicKey())?.trim() || null
            : null;
        } catch {
          publicKey = null;
        }
        const setup = await fetchNearSetup(publicKey);
        if (setup?.needsSetup) {
          onNeedsSetup();
          return;
        }
      } catch {
        // A failed setup check must not block the unlock; the signature
        // attempt below will surface the real error.
      }
    }
    try {
      setPhase("signing");
      const built = await buildEmptyIntent(account.kind, account.address);
      let signedData: Record<string, unknown>;
      if (built.standard === "nep413" && built.nep413) {
        const signed = await signNEP413({
          message: built.nep413.message,
          recipient: built.nep413.recipient,
          nonce: built.nonceBytes,
        });
        signedData = encodeSignedData(built, signed.signature, signed.publicKey);
      } else {
        if (!built.payload) throw new Error("The proof could not be built.");
        const signatureBytes = await signMessage(
          new TextEncoder().encode(built.payload),
        );
        signedData = encodeSignedData(
          built,
          signatureBytes,
          account.kind === "solana" ? `ed25519:${account.address}` : undefined,
        );
      }

      setPhase("authenticating");
      const res = await fetch(`${ONE_CLICK}/v0/auth/authenticate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedData }),
      });
      if (res.status >= 500) {
        throw new Error(SERVICE_UNAVAILABLE);
      }
      const data = (await res.json().catch(() => null)) as {
        accessToken?: string;
        refreshToken?: string;
        expiresIn?: number;
        refreshExpiresIn?: number;
        message?: string;
      } | null;
      if (!res.ok || !data?.accessToken || !data?.refreshToken) {
        throw new Error(data?.message ?? "Unlock failed. Please try again.");
      }
      saveIntentsSession({
        chain: account.kind,
        address: account.address,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : 900,
        refreshExpiresIn:
          typeof data.refreshExpiresIn === "number" ? data.refreshExpiresIn : 0,
      });
      window.dispatchEvent(new CustomEvent(SUPER_UNLOCK_EVENT));
      onUnlocked?.();
      setPhase("unlocked");
    } catch (cause) {
      setError(friendlyUnlockError(cause));
      setPhase("error");
    }
  };

  // A dismissal is an answer too: tell the card that asked, so it can stop
  // pushing instead of looking like it is still waiting. The success path
  // closes through closeRef and never reports a cancel.
  const closeWithoutUnlock = () => {
    if (phase !== "unlocked" && sourceCallId) {
      window.dispatchEvent(
        new CustomEvent(SUPER_CANCEL_EVENT, {
          detail: { callId: sourceCallId },
        }),
      );
    }
    // A cancel leaves the account locked, but the overlay is still gone.
    notifySuperClosed();
    onClose();
  };

  return (
    <DialogShell
      label={
        passkey ? "Unlock your private balance" : "Unlock your super account"
      }
      title={
        phase === "unlocked"
          ? "Unlocked"
          : passkey
            ? "Unlock your private balance"
            : "Unlock your super account"
      }
      icon={
        phase === "unlocked" ? (
          <IconLockOpen
            size={14}
            stroke={2}
            className="shrink-0 text-green"
            aria-hidden
          />
        ) : (
          <IconLockFilled
            size={14}
            className="shrink-0 text-attention"
            aria-hidden
          />
        )
      }
      subtitle={
        phase === "unlocked"
          ? "Your private balance is ready. Ask for it whenever you like."
          : passkey
            ? "Your private balance is read with your passkey. Nothing moves."
            : "Your private balance inside Myntle. Fund it once, then trade in one signature."
      }
      onClose={closeWithoutUnlock}
      busy={busy || phase === "unlocked"}
      leaving={leaving}
      footer={
        phase === "unlocked" ? undefined : needsReconnect ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeWithoutUnlock}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={() => void handleReconnect()}
              disabled={busy || walletPending}
            >
              {reconnecting ? (
                <span className="inline-flex items-center gap-1.5">
                  <IconLoader2 size={14} stroke={2} className="animate-spin" />
                  Reconnect
                </span>
              ) : (
                "Reconnect"
              )}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeWithoutUnlock}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={() => void handleUnlock()}
              disabled={busy}
            >
              {busy ? (
                <span className="inline-flex items-center gap-1.5">
                  <IconLoader2 size={14} stroke={2} className="animate-spin" />
                  Unlock
                </span>
              ) : (
                "Unlock"
              )}
            </Button>
          </>
        )
      }
    >
      {phase !== "unlocked" && !passkey ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
          {needsReconnect
            ? reconnectName
              ? `Your ${reconnectName} disconnected. Reconnect it and unlock with one signature.`
              : "Your wallet disconnected. Reconnect it and unlock with one signature."
            : "Private swaps. Orders that wait for your price."}
        </p>
      ) : null}

      {/* the notice grows the dialog instead of jumping it */}
      <div
        className="grid"
        style={{
          gridTemplateRows: notice ? "1fr" : "0fr",
          transition: "grid-template-rows 240ms var(--ease-out-strong)",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          {phase === "unlocked" ? (
            <p
              key="ok"
              className="mt-3 rounded-[8px] bg-green-tint px-3 py-2 text-[13px] text-ink"
              style={{ animation: "fade-in 180ms ease-out both" }}
            >
              {passkey
                ? "Private balance unlocked. Nothing left the browser."
                : "Super account unlocked. Nothing left the browser."}
            </p>
          ) : error ? (
            <p
              key={error}
              className="mt-3 rounded-[8px] bg-red-tint px-3 py-2 text-[13px] text-ink"
              style={{ animation: "fade-in 180ms ease-out both" }}
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </DialogShell>
  );
}
