"use client";

import { useEffect, useRef, useState } from "react";
import { IconFingerprint } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { DialogShell } from "@/components/app/DialogShell";
import {
  PasskeyOptions,
  usePasskeyLogin,
} from "@/components/app/PasskeyOptions";
import { passkeysAvailable } from "@/lib/auth/passkey-client";

export const OPEN_PASSKEY_EVENT = "myntle:open-passkey";

export function openPasskeyDialog() {
  window.dispatchEvent(new CustomEvent(OPEN_PASSKEY_EVENT));
}

/**
 * The passkey entry, beside the wallet entry and never inside it.
 *
 * Both actions end at the same place: the browser's own passkey prompt, then
 * the session route. The dialog reads the account back from the session
 * rather than showing whatever the credential returned, so a reload and a
 * fresh sign-in describe the same account.
 */
export function PasskeyDialog({ onClose }: { onClose: () => void }) {
  const flow = usePasskeyLogin();
  const [leaving, setLeaving] = useState(false);
  const closeRef = useRef(onClose);

  // The success notice reads first, then the dialog fades out and closes.
  useEffect(() => {
    if (!flow.succeeded) return;
    const fade = window.setTimeout(() => setLeaving(true), 850);
    const done = window.setTimeout(() => closeRef.current(), 1100);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [flow.succeeded]);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // The flag and the browser both have to allow a ceremony. An unsupported
  // browser shows nothing rather than a button that cannot work.
  if (!passkeysAvailable()) return null;

  return (
    <DialogShell
      label="Passkey"
      title="Passkey"
      icon={
        <IconFingerprint
          size={14}
          stroke={2}
          className="shrink-0"
          aria-hidden
        />
      }
      subtitle="Log in without your wallet."
      onClose={onClose}
      busy={flow.submitting || flow.succeeded}
      leaving={leaving}
      footer={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={flow.submitting || flow.succeeded}
        >
          Cancel
        </Button>
      }
    >
      <PasskeyOptions flow={flow} />
    </DialogShell>
  );
}
