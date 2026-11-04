"use client";

import { useEffect, useState } from "react";
import { WalletButton } from "@/components/app/WalletButton";
import { PasskeyAccountButton } from "@/components/app/PasskeyAccountButton";
import {
  OPEN_PASSKEY_EVENT,
  PasskeyDialog,
} from "@/components/app/PasskeyDialog";
import {
  OPEN_SUPER_EVENT,
  SuperUnlockDialog,
} from "@/components/app/SuperUnlockDialog";
import { useAuth } from "@/lib/auth/auth-provider";

/**
 * The one account control in the footer.
 *
 * A passkey account gets its own button; every wallet state keeps the exact
 * `WalletButton` it had before. The passkey dialogs mount here so the
 * account entry and the gate share one listener.
 */
export function AccountControl({
  onProfile,
  onUsage,
  compact = false,
}: {
  onProfile?: () => void;
  onUsage?: () => void;
  /** icon-only rail control for the collapsed sidebar */
  compact?: boolean;
} = {}) {
  const { identity } = useAuth();
  const passkey = identity?.kind === "passkey";
  const [passkeyOpen, setPasskeyOpen] = useState(false);
  const [superOpen, setSuperOpen] = useState(false);
  const [superSource, setSuperSource] = useState<string | null>(null);

  // The full control owns the dialog. The rail copy is mounted alongside for
  // the collapse cross-fade and would otherwise open a second one.
  useEffect(() => {
    if (compact) return;
    const open = () => setPasskeyOpen(true);
    window.addEventListener(OPEN_PASSKEY_EVENT, open);
    return () => window.removeEventListener(OPEN_PASSKEY_EVENT, open);
  }, [compact]);

  // The wallet control mounts its own unlock dialog. A passkey account renders
  // `PasskeyAccountButton` instead, so the footer owns the dialog for it.
  useEffect(() => {
    if (compact || !passkey) return;
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ callId?: string }>).detail;
      setSuperSource(detail?.callId ?? null);
      setSuperOpen(true);
    };
    window.addEventListener(OPEN_SUPER_EVENT, open);
    return () => window.removeEventListener(OPEN_SUPER_EVENT, open);
  }, [compact, passkey]);

  return (
    <>
      {identity?.kind === "passkey" ? (
        <PasskeyAccountButton
          compact={compact}
          onProfile={onProfile}
          onUsage={onUsage}
        />
      ) : (
        <WalletButton
          compact={compact}
          onProfile={onProfile}
          onUsage={onUsage}
        />
      )}
      {!compact && passkeyOpen ? (
        <PasskeyDialog onClose={() => setPasskeyOpen(false)} />
      ) : null}
      {!compact && passkey && superOpen ? (
        <SuperUnlockDialog
          sourceCallId={superSource}
          onClose={() => {
            setSuperOpen(false);
            setSuperSource(null);
          }}
        />
      ) : null}
    </>
  );
}
