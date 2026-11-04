"use client";

import { useState } from "react";
import { AccountMenu } from "@/components/app/WalletButton";
import { openSuperUnlock } from "@/components/app/SuperUnlockDialog";
import { useAuth } from "@/lib/auth/auth-provider";
import {
  lockSuperAccount,
  useSuperUnlocked,
} from "@/lib/intents/user-session";

/**
 * The account control for a passkey-owned account.
 *
 * It renders the same menu as a wallet: copy the account id, unlock or lock
 * the private balance, profile, usage, theme, and sign out. A passkey
 * account is a full account, not a reduced one.
 */
export function PasskeyAccountButton({
  compact = false,
  onProfile,
  onUsage,
}: {
  /** icon-only rail control for the collapsed sidebar */
  compact?: boolean;
  onProfile?: () => void;
  onUsage?: () => void;
} = {}) {
  const { identity, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const address = identity?.kind === "passkey" ? identity.accountId : null;
  const superUnlocked = useSuperUnlocked("passkey", address);

  if (identity?.kind !== "passkey" || !address) return null;

  return (
    <AccountMenu
      address={address}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      onClose={() => setOpen(false)}
      onDisconnect={() => void signOut()}
      onProfile={onProfile}
      onUsage={onUsage}
      onUnlock={() => {
        setOpen(false);
        openSuperUnlock();
      }}
      onLock={() => {
        lockSuperAccount("passkey", address);
        setOpen(false);
      }}
      superUnlocked={superUnlocked}
      compact={compact}
    />
  );
}
