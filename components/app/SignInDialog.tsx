"use client";

import { useEffect, useRef, useState } from "react";
import { IconLoader2, IconLock } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { truncateTechData } from "@/components/atoms/TechDataChip";
import { DialogShell } from "@/components/app/DialogShell";
import { WalletMark } from "@/components/finance/AddressPill";
import { useAuth } from "@/lib/auth/auth-provider";
import { prefetchIntentsSalt } from "@/lib/intents/salt";

export const OPEN_SIGNIN_EVENT = "myntle:open-signin";

export function openSignIn() {
  window.dispatchEvent(new CustomEvent(OPEN_SIGNIN_EVENT));
}

function friendlySignInError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : "";
  if (/reject|cancel|denied|dismiss/i.test(raw)) {
    return "Signature was rejected. Please try again.";
  }
  if (/verif|signatur|challenge|expired|nonce/i.test(raw)) {
    return raw || "That signature did not check out. Please try again.";
  }
  if (/disconnect/i.test(raw)) {
    return "Wallet disconnected. Please reconnect.";
  }
  if (/log out/i.test(raw)) {
    return raw;
  }
  if (/no wallet is connected/i.test(raw)) {
    return "No wallet is connected.";
  }
  return "Sign In failed. Please try again.";
}

/**
 * The sign-in dialog: identity, separate from connection.
 *
 * Opens after the wallet connects, or from the wallet button and the chat
 * gate when a connected wallet still has no Myntle session. The connected
 * wallet shows inside it as its mark and short address, because the
 * signature is asked of that wallet and nowhere else. Cancelling leaves the
 * wallet connected and the account unsigned — chats stay gated and the
 * button offers another try. Disconnecting is offered here too: a
 * connected-but-unsigned account has no account menu, so without this the
 * only way out would be a reload. A signature starts the session; on success
 * the Intents salt is prefetched so unlocking later costs one prompt, not
 * two. The success notice reads first, then the dialog fades instead of
 * snapping shut.
 */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const { account, signedIn, signIn, signOut, busy } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const busyNow = submitting || busy;
  const locked = busyNow || succeeded;
  const notice = succeeded || error;
  // The account menu is the signed-in surface; a connected-but-unsigned
  // wallet has none, so the dialog carries its one way to let go.
  const canDisconnect = account !== null && !signedIn;

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // The success notice reads first, then the dialog fades out and closes.
  useEffect(() => {
    if (!succeeded) return;
    const fade = window.setTimeout(() => setLeaving(true), 850);
    const done = window.setTimeout(() => closeRef.current(), 1100);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [succeeded]);

  const handleSign = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await signIn();
      // Background only: the unlock dialog needs a fresh salt, and fetching
      // it now means Unlock signs immediately instead of waiting on RPC.
      prefetchIntentsSalt();
      setSucceeded(true);
    } catch (cause) {
      setError(friendlySignInError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogShell
      label="Sign In"
      title="Sign In"
      icon={<IconLock size={14} stroke={2} className="shrink-0" aria-hidden />}
      subtitle="Confirm it's really you."
      onClose={onClose}
      busy={locked}
      leaving={leaving}
      footerStart={
        canDisconnect ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-red hover:bg-red-tint"
            onClick={() => {
              // Close first, then let the provider sever every adapter and
              // the session. This is the account menu's sign-out order, so
              // the control leaves the connected state in the same render.
              onClose();
              void signOut();
            }}
            disabled={locked}
          >
            Disconnect
          </Button>
        ) : undefined
      }
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={locked}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={() => void handleSign()}
            disabled={locked}
          >
            {busyNow ? (
              <span className="inline-flex items-center gap-1.5">
                <IconLoader2 size={14} stroke={2} className="animate-spin" />
                Sign In
              </span>
            ) : (
              "Sign In"
            )}
          </Button>
        </>
      }
    >
      {account ? (
        <div className="mt-3 flex justify-center">
          <span className="inline-flex h-8 items-center gap-2 rounded-full border border-line-strong px-3">
            <WalletMark
              address={account.address}
              chain={account.kind}
              walletIcon={account.walletIcon}
              size={16}
            />
            <span
              className="text-[13px] leading-none text-ink"
              title={account.address}
            >
              {truncateTechData(account.address, account.kind)}
            </span>
          </span>
        </div>
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
          {succeeded ? (
            <p
              key="ok"
              className="mt-3 rounded-[8px] bg-green-tint px-3 py-2 text-[13px] text-ink"
              style={{ animation: "fade-in 180ms ease-out both" }}
            >
              Sign In successful.
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
