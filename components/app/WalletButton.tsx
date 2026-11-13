"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconChevronRight, IconFingerprint, IconLoader2, IconLockFilled, IconLockOpen, IconLogout, IconUser, IconUserCircle, IconWallet, IconX } from "@tabler/icons-react";
import { CopyAddressButton } from "@/components/app/CopyAddressButton";
import { Button } from "@/components/atoms/Button";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import {
  CHAINS,
  EVM_CATALOG,
  SOL_CATALOG,
  WalletIcon,
  friendlyWalletError,
  getInjectedProviders,
  providerHasFlag,
  scheduleWalletLogoPreload,
  useEip6963Providers,
  type SuggestEntry,
} from "@/components/app/wallet-catalog";
import { OPEN_WALLET_EVENT } from "@/components/app/ConnectGate";
import { OPEN_SIGNIN_EVENT, SignInDialog } from "@/components/app/SignInDialog";
import {
  PasskeyOptions,
  usePasskeyLogin,
} from "@/components/app/PasskeyOptions";
import {
  OPEN_SUPER_EVENT,
  SuperUnlockDialog,
} from "@/components/app/SuperUnlockDialog";
import { NearSetupDialog } from "@/components/app/NearSetupDialog";
import {
  clearNearSetupDismissed,
  dismissNearSetup,
  fetchNearSetup,
  wasNearSetupDismissed,
} from "@/lib/intents/near-setup";
import { usePasskeysAvailable } from "@/lib/auth/passkey-client";
import {
  lockSuperAccount,
  useSuperUnlocked,
} from "@/lib/intents/user-session";
import { useAuth } from "@/lib/auth/auth-provider";
import type { WalletValue } from "@/lib/wallet/registry";

/**
 * The account control.
 *
 * Signed out it is a primary button that opens one login dialog: a passkey
 * card first, then the chain rail and the wallet cards the browser offers.
 * Connected it is a secondary button showing the truncated address, with an
 * inline menu for the account actions.
 */
export function WalletButton({
  onProfile,
  compact = false,
}: {
  onProfile?: () => void;
  /** icon-only rail control for the collapsed sidebar */
  compact?: boolean;
} = {}) {
  const {
    wallet,
    account,
    identity,
    signedIn,
    canSign,
    status: sessionStatus,
    signOut,
    busy,
  } = useAuth();
  const superUnlocked = useSuperUnlocked(account?.kind, account?.address);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [signinOpen, setSigninOpen] = useState(false);
  const [superOpen, setSuperOpen] = useState(false);
  const [superSource, setSuperSource] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupThenUnlock, setSetupThenUnlock] = useState(false);
  const setupChecked = useRef<string | null>(null);
  const getNearKeyRef = useRef(wallet.getNearPublicKey);
  const [menuOpen, setMenuOpen] = useState(false);

  // The gated assistant reply carries its own inline connect action, so the
  // footer control listens for the same open request. Only the full-size
  // control takes the request: the rail copy of it is mounted alongside for
  // the collapse cross-fade and would otherwise open a second picker.
  // The sign-in dialog has its own request for the same reason, as does
  // the super unlock dialog: the chat gate and inline cards open them.
  useEffect(() => {
    if (compact) return;
    const open = () => setPickerOpen(true);
    const openSignin = () => setSigninOpen(true);
    const openSuper = (event: Event) => {
      const detail = (event as CustomEvent<{ callId?: string }>).detail;
      setSuperSource(detail?.callId ?? null);
      setSuperOpen(true);
    };
    window.addEventListener(OPEN_WALLET_EVENT, open);
    window.addEventListener(OPEN_SIGNIN_EVENT, openSignin);
    window.addEventListener(OPEN_SUPER_EVENT, openSuper);
    return () => {
      window.removeEventListener(OPEN_WALLET_EVENT, open);
      window.removeEventListener(OPEN_SIGNIN_EVENT, openSignin);
      window.removeEventListener(OPEN_SUPER_EVENT, openSuper);
    };
  }, [compact]);

  // Warm the logo cache long before the dialog opens. The picker itself
  // mounts only on click, which is too late — the fetch would race the
  // dialog animation and the cards would pop in imageless. Preloading
  // is guarded so it runs once per session, not on every button remount.
  useEffect(() => scheduleWalletLogoPreload(), []);

  useEffect(() => {
    getNearKeyRef.current = wallet.getNearPublicKey;
  }, [wallet.getNearPublicKey]);

  // A named NEAR account cannot authenticate until its wallet key is
  // registered on `intents.near`. Ask once after sign-in, and only when the
  // server says this exact account needs it. A dismissal is remembered for
  // the tab; the unlock dialog still hands off here when the user tries.
  const nearSetupAddress =
    identity?.kind === "wallet" && identity.chain === "near"
      ? identity.address
      : null;

  useEffect(() => {
    if (!signedIn) {
      setupChecked.current = null;
      return;
    }
    if (!canSign || !nearSetupAddress) {
      if (!canSign) setupChecked.current = null;
      return;
    }
    if (signinOpen || superOpen || setupOpen) return;
    if (setupChecked.current === nearSetupAddress) return;
    if (wasNearSetupDismissed(nearSetupAddress)) return;
    setupChecked.current = nearSetupAddress;

    let cancelled = false;
    void (async () => {
      let key: string | null = null;
      try {
        key = await getNearKeyRef.current();
      } catch {
        key = null;
      }
      const state = await fetchNearSetup(key);
      if (cancelled || !state?.needsSetup) return;
      setSetupThenUnlock(false);
      setSetupOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    signedIn,
    canSign,
    nearSetupAddress,
    signinOpen,
    superOpen,
    setupOpen,
  ]);

  // The picker must stay mounted through approval AND signature. The wallet
  // account appears as soon as the connection is approved, which is before
  // the verification signature lands — unmounting here is what closed the
  // popup early. The busy and stage flags are the shared ones now, so this
  // control and the sign-in dialog always agree on what is happening.

  // The rail has room for one 32px glyph, so every state collapses into the
  // same account icon instead of a button that would clip its own label.
  const railTrigger = (onClick: () => void, label: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-[8px] text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]"
    >
      <IconUserCircle size={21} stroke={1.7} />
    </button>
  );

  // The signed-out control names its next step: no wallet yet means
  // connecting ("Log In"), a connected wallet without a session means
  // proving ownership ("Sign In"). The two were once one label, which
  // left the sign-in dialog open over a button still saying "Log In".
  const logInButton = (onClick: () => void, label = "Log In") => (
    <Button
      type="button"
      variant="primary"
      size="md"
      className="w-full active:scale-[0.99]"
      onClick={onClick}
    >
      <IconUser size={15} stroke={1.8} className="shrink-0" />
      {label}
    </Button>
  );

  const resumeLogIn = account
    ? () => setSigninOpen(true)
    : () => setPickerOpen(true);

  const handleSetupClose = () => {
    if (account?.kind === "near") dismissNearSetup(account.address);
    setSetupOpen(false);
    setSetupThenUnlock(false);
  };

  const handleSetupDone = () => {
    if (account?.kind === "near") {
      clearNearSetupDismissed(account.address);
    }
    setSetupOpen(false);
    if (setupThenUnlock) {
      setSetupThenUnlock(false);
      setSuperOpen(true);
    }
  };

  const handleNeedsSetup = () => {
    setSuperOpen(false);
    setSetupThenUnlock(true);
    setSetupOpen(true);
  };

  // Connected, but the session check has not answered yet. The address is
  // already known, so it shows: the alternative is claiming "Sign In" to a
  // user who is signed in, which is the flash that made people click twice.
  const checkingButton = account ? (
    <Button
      type="button"
      variant="secondary"
      size="md"
      disabled
      className="w-full text-[12px]"
    >
      <IconLoader2 size={14} stroke={1.8} className="shrink-0 animate-spin text-ink-3" />
      <span className="min-w-0 flex-1 truncate text-left">
        {truncateAddress(account.address)}
      </span>
    </Button>
  ) : null;

  // What this control is when no dialog is open. Every dialog branch renders
  // it underneath, so the footer never claims a different state than the
  // account it is describing.
  const resting = account ? (
    sessionStatus === "unknown" ? (
      compact ? railTrigger(() => {}, "Checking your account") : checkingButton
    ) : signedIn ? (
      <AccountMenu
        compact={compact}
        address={account.address}
        open={menuOpen}
        onToggle={() => setMenuOpen((v) => !v)}
        onClose={() => setMenuOpen(false)}
        onDisconnect={() => void signOut()}
        onProfile={onProfile}
        onUnlock={() => {
          setSuperSource(null);
          setSuperOpen(true);
        }}
        onLock={() => {
          if (!account) return;
          lockSuperAccount(account.kind, account.address);
          setMenuOpen(false);
        }}
        superUnlocked={superUnlocked}
        suspendDismiss={superOpen}
      />
    ) : compact ? (
      railTrigger(resumeLogIn, "Sign in")
    ) : (
      logInButton(resumeLogIn, "Sign In")
    )
  ) : compact ? (
    railTrigger(() => setPickerOpen(true), "Log in")
  ) : (
    logInButton(() => setPickerOpen(true))
  );

  if (pickerOpen) {
    return (
      <>
        {compact ? railTrigger(() => setPickerOpen(true), "Logging in") : logInButton(() => setPickerOpen(true))}
        <ConnectPicker
          wallet={wallet}
          onClose={() => {
            if (!busy) setPickerOpen(false);
          }}
          onConnected={() => {
            setPickerOpen(false);
            // The picker only opens while disconnected, so a fresh
            // connection is always unsigned: go straight to sign-in
            // instead of leaving the user to find the button.
            setSigninOpen(true);
          }}
        />
      </>
    );
  }

  if (signinOpen) {
    return (
      <>
        {resting}
        <SignInDialog onClose={() => setSigninOpen(false)} />
      </>
    );
  }

  if (setupOpen) {
    return (
      <>
        {resting}
        <NearSetupDialog
          sourceCallId={superSource}
          onClose={handleSetupClose}
          onDone={handleSetupDone}
        />
      </>
    );
  }

  if (superOpen) {
    return (
      <>
        {resting}
        <SuperUnlockDialog
          sourceCallId={superSource}
          onClose={() => {
            setSuperOpen(false);
            setSuperSource(null);
          }}
          onNeedsSetup={handleNeedsSetup}
          onUnlocked={() => setMenuOpen(false)}
        />
      </>
    );
  }

  return resting;
}

export function truncateAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * The account menu shared by the wallet and passkey controls.
 *
 * Both account kinds get the same actions on purpose: a passkey account is
 * not a lesser account, and the private-balance lock belongs to it too.
 */
export function AccountMenu({
  address,
  open,
  onToggle,
  onClose,
  onDisconnect,
  onProfile,
  onUnlock,
  onLock,
  superUnlocked,
  suspendDismiss = false,
  compact = false,
}: {
  address: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onDisconnect: () => void;
  onProfile?: () => void;
  onUnlock?: () => void;
  onLock?: () => void;
  superUnlocked?: boolean | null;
  /** keep the menu open while the super dialog owns the screen */
  suspendDismiss?: boolean;
  /** rail form: an account icon whose menu opens beside the 52px shell */
  compact?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [armedSignOut, setArmedSignOut] = useState(false);
  // The sidebar clips anything drawn outside its shell, so the rail menu is
  // portalled and pinned to the trigger's edge instead of the rail's.
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!open) setArmedSignOut(false);
  }, [open]);

  useEffect(() => {
    if (!open || suspendDismiss) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose, suspendDismiss]);

  useEffect(() => {
    if (!compact || !open) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({
        left: Math.min(rect.right + 8, window.innerWidth - 240),
        bottom: Math.max(8, window.innerHeight - rect.bottom),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [compact, open]);

  const toggle = () => {
    if (compact && !open) {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) {
        setAnchor({
          left: Math.min(rect.right + 8, window.innerWidth - 240),
          bottom: Math.max(8, window.innerHeight - rect.bottom),
        });
      }
    }
    onToggle();
  };

  const itemClass =
    "flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[13.5px] text-ink hover:bg-hover-2 active:scale-[0.97] transition-[background-color,color,transform] duration-150 ease-out";

  // Balance-backed actions need the super account; this entry is their
  // permanent way in when the dialog is dismissed. While unlocked the same
  // row becomes the lock action, which forgets the tokens in this browser.
  const locked = superUnlocked === false;
  const superItem = onUnlock ? (
    superUnlocked === true ? (
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onLock?.();
        }}
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-green">
          <IconLockOpen size={16} stroke={1.8} />
        </span>
        <span className="min-w-0 flex-1 truncate">Lock super account</span>
      </button>
    ) : (
      <button
        type="button"
        role="menuitem"
        className={`${itemClass}${locked ? " super-lock-outline" : ""}`}
        onClick={() => {
          onUnlock();
        }}
      >
        <span
          className={`flex size-5 shrink-0 items-center justify-center ${
            locked ? "text-attention super-lock-glow" : "text-ink-2"
          }`}
        >
          <IconLockFilled size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate">Unlock super account</span>
      </button>
    )
  ) : null;

  const items = (
    <>
      {superItem}
      <CopyAddressButton value={address} />
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              onClose();
              onProfile?.();
            }}
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
              <IconUser size={16} stroke={1.8} />
            </span>
            <span className="min-w-0 flex-1 truncate">Profile</span>
          </button>
          <div role="group" aria-label="Theme" className="flex h-9 w-full items-center gap-1.5 px-2 text-[13.5px] text-ink">
            <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 truncate">Theme</span>
            <ThemeToggle compact />
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            aria-label={armedSignOut ? "Confirm sign out" : "Sign out"}
            onClick={() => {
              if (armedSignOut) {
                onClose();
                onDisconnect();
              } else {
                setArmedSignOut(true);
              }
            }}
            className={`chat-menu-morph flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[13.5px] active:scale-[0.98] ${
              armedSignOut
                ? "is-armed bg-red text-white hover:bg-red"
                : "text-red hover:bg-red-tint"
            }`}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <IconLogout size={16} stroke={1.8} />
            </span>
            <span className="relative min-w-0 flex-1">
              <span
                className={`chat-menu-label truncate ${armedSignOut ? "is-exiting" : ""}`}
              >
                Sign out
              </span>
              <span
                className={`chat-menu-label absolute inset-0 truncate ${armedSignOut ? "" : "is-exiting"}`}
              >
                Confirm
              </span>
            </span>
          </button>
    </>
  );

  const panel = (
    <div
      ref={panelRef}
      role="menu"
      className={
        compact
          ? "fixed z-[90] w-[232px] rounded-[14px] bg-surface p-1.5 shadow-overlay"
          : "absolute bottom-full left-0 z-20 mb-1.5 w-full rounded-[14px] bg-surface p-1.5 shadow-overlay"
      }
      style={
        compact
          ? {
              left: anchor?.left ?? 0,
              bottom: anchor?.bottom ?? 0,
              animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
              transformOrigin: "bottom left",
            }
          : {
              animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
              transformOrigin: "bottom center",
            }
      }
    >
      {items}
    </div>
  );

  if (compact) {
    return (
      <>
        <div ref={rootRef}>
          <button
            type="button"
            aria-label={locked ? "Account, super account locked" : "Account"}
            title={locked ? "Account, super account locked" : "Account"}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
            className="flex size-8 items-center justify-center rounded-[8px] text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]"
          >
            <span className="relative flex items-center justify-center">
              <IconUserCircle size={21} stroke={1.7} />
              {locked ? (
                <span
                  aria-hidden
                  className="super-lock-glow absolute -right-1 -top-1 text-attention"
                >
                  <IconLockFilled size={12} />
                </span>
              ) : null}
            </span>
          </button>
        </div>
        {open && anchor && typeof document !== "undefined"
          ? createPortal(panel, document.body)
          : null}
      </>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="secondary"
        size="md"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="relative w-full text-[12px] active:scale-[0.99]"
      >
        <IconUser size={14} stroke={1.8} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate text-left">
          {truncateAddress(address)}
        </span>
        <IconChevronDown size={14} stroke={1.8} className="shrink-0 text-ink-3" />
        {locked ? (
          <span
            role="img"
            aria-label="Super account locked"
            title="Super account locked"
            className="super-lock-glow absolute right-0 -top-1.5 z-10 text-attention"
          >
            <IconLockFilled size={15} />
          </span>
        ) : null}
      </Button>

      {open ? panel : null}
    </div>
  );
}

function ConnectPicker({
  wallet,
  onClose,
  onConnected,
}: {
  wallet: WalletValue;
  onClose: () => void;
  /** Fires after the picker dismisses on a fresh connection: sign-in next. */
  onConnected: () => void;
}) {
  const {
    connectEvm,
    connectSolanaWallet,
    connectNear,
    pendingChain,
    isPending,
    authStage,
    solanaWallets,
    evmConnectors,
  } = wallet;
  const passkeyAvailable = usePasskeysAvailable();
  const passkeyFlow = usePasskeyLogin();
  const [view, setView] = useState<"options" | "passkey">("options");
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installLink, setInstallLink] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [chain, setChain] = useState<"evm" | "solana">("evm");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const stageRef = useRef<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyHeightRef = useRef<number | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // The two views have different heights. Lock the wrapper to the height it
  // had, then move it to the new content's height on the next frame so the
  // dialog grows or shrinks instead of jumping.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const content = body?.firstElementChild as HTMLElement | null;
    if (!body || !content) return;

    const next = content.getBoundingClientRect().height;
    const previous = bodyHeightRef.current;
    if (previous === null) {
      bodyHeightRef.current = next;
      return;
    }

    body.style.height = `${previous}px`;
    const frame = window.requestAnimationFrame(() => {
      body.style.height = `${next}px`;
    });
    bodyHeightRef.current = next;
    return () => window.cancelAnimationFrame(frame);
  }, [view, mounted]);

  // Track the visible height even mid-transition, so a quick second switch
  // starts from where the dialog actually is rather than where it was going.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(() => {
      const height = body.getBoundingClientRect().height;
      if (height > 0) bodyHeightRef.current = height;
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  // The passkey ceremony ends in the session, not in a wallet connection.
  // Hold the success notice briefly, then let the parent close the dialog.
  useEffect(() => {
    if (!passkeyFlow.succeeded) return;
    const timer = window.setTimeout(() => onCloseRef.current(), 900);
    return () => window.clearTimeout(timer);
  }, [passkeyFlow.succeeded]);

  const busy = isPending || pendingChain !== null || authStage !== null;
  const dialogBusy = busy || passkeyFlow.submitting || passkeyFlow.succeeded;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !dialogBusy) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, dialogBusy]);

  useEffect(() => {
    if (authStage) stageRef.current = authStage;
  }, [authStage]);

  // Direct EIP-6963 announcements supplement wagmi, so a wallet that
  // announced late still counts as detected for ordering. Hooks stay above
  // the mount gate.
  const eip6963Providers = useEip6963Providers();

  if (!mounted) return null;

  // One notice slot serves every state. The picker only connects now —
  // the signature has its own dialog — so there is exactly one asking
  // state: approval in the wallet.
  const pendingNotice =
    pendingKey !== null && !error && !success
      ? "Approve connection in your wallet…"
      : null;

  const choose = (key: string, run: () => Promise<unknown>) => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setError(null);
    setInstallLink(null);
    setSuccess(null);
    setPendingKey(key);
    stageRef.current = null;
    void run()
      .then(() => {
        // The picker stays open on the confirmation, then hands straight to
        // sign-in: a fresh connection without a session is unsigned, and
        // leaving the user to find the Sign In button is a dead end.
        setSuccess("Connected successfully.");
        closeTimer.current = window.setTimeout(() => {
          onClose();
          onConnected();
        }, 1200);
      })
      .catch((cause: unknown) =>
        setError(friendlyWalletError(cause, stageRef.current)),
      )
      .finally(() => setPendingKey(null));
  };

  const cardClass =
    "flex min-w-0 items-center gap-2.5 rounded-[8px] border border-line bg-page px-3.5 py-3 text-left transition-colors duration-100 hover:border-line-strong hover:bg-hover disabled:opacity-60";

  const tabClass = (selected: boolean) =>
    `flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-3 text-left text-[13px] font-medium transition-colors duration-100 disabled:opacity-60 ${
      selected
        ? "bg-hover-2 text-ink"
        : "text-ink-2 hover:bg-hover hover:text-ink"
    }`;

  const spin = (key: string) =>
    pendingKey === key ? (
      <IconLoader2
        size={14}
        stroke={1.8}
        className="shrink-0 animate-spin text-ink-3"
      />
    ) : null;

  const notInstalled = (entry: SuggestEntry) => {
    setError(`${entry.name} not detected.`);
    setInstallLink(entry.installUrl);
  };

  // Wagmi discovers EIP-6963 wallets as one connector per wallet (the id
  // is the rdns, for example `io.rabby`). Match a catalog entry by rdns
  // first, then by wallet name, so a card always targets its own wallet.
  const findConnectorForEntry = (entry: SuggestEntry) =>
    evmConnectors.find((connector) => {
      if (entry.rdns && connector.id.toLowerCase() === entry.rdns.toLowerCase())
        return true;
      return connector.name.toLowerCase().includes(entry.match);
    });
  const injectedProviders =
    typeof window === "undefined" ? [] : getInjectedProviders();
  const hasInjected = injectedProviders.length > 0;
  const hasInjectedFlag = (entry: SuggestEntry) =>
    injectedProviders.some((provider) => providerHasFlag(provider, entry));
  const hasEip6963Entry = (entry: SuggestEntry) =>
    eip6963Providers.some(
      (detail) =>
        (entry.rdns &&
          detail.info.rdns.toLowerCase() === entry.rdns.toLowerCase()) ||
        detail.info.name.toLowerCase().includes(entry.match),
    );
  const isEntryDetected = (entry: SuggestEntry) =>
    !!findConnectorForEntry(entry) ||
    hasEip6963Entry(entry) ||
    hasInjectedFlag(entry);
  // Installed wallets first in catalog order, then at most three
  // undetected suggestions, each with an install link.
  const detectedCatalog = EVM_CATALOG.filter(isEntryDetected);
  const suggestedCatalog = EVM_CATALOG.filter((e) => !isEntryDetected(e)).slice(
    0,
    3,
  );
  const visibleCatalog = [...detectedCatalog, ...suggestedCatalog];
  // Rare or unlisted wallets still surface through their own EIP-6963
  // connector instead of hiding behind the generic Injected button.
  const extraConnectors = evmConnectors.filter(
    (connector) =>
      connector.icon &&
      connector.id !== "injected" &&
      connector.id !== "walletConnect" &&
      !EVM_CATALOG.some(
        (entry) =>
          (entry.rdns &&
            connector.id.toLowerCase() === entry.rdns.toLowerCase()) ||
          connector.name.toLowerCase().includes(entry.match),
      ),
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose an option to log in"
    >
      <div
        className="absolute inset-0 bg-black/60 dark:bg-black/75"
        style={{ animation: "fade-in 180ms ease-out both" }}
        onClick={() => {
          if (!dialogBusy) onClose();
        }}
      />
      <div
        className="relative flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-window border border-line bg-surface shadow-overlay"
        style={{ animation: "dialog-in 240ms var(--ease-out-strong) both" }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-4 pr-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {view === "passkey" ? (
              <IconFingerprint
                size={14}
                stroke={2}
                className="shrink-0 text-ink-2"
                aria-hidden
              />
            ) : (
              <IconUser
                size={14}
                stroke={2}
                className="shrink-0 text-ink-2"
                aria-hidden
              />
            )}
            <span className="truncate text-[13px] font-semibold text-ink">
              {view === "passkey"
                ? "Passkey Login"
                : "Choose an option to log in."}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={dialogBusy}
            className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3"
          >
            <IconX size={15} />
          </button>
        </div>

        <div
          ref={bodyRef}
          className="overflow-hidden"
          style={{ transition: "height 320ms var(--ease-out-strong)" }}
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.propertyName !== "height") return;
            const el = event.currentTarget;
            bodyHeightRef.current = el.getBoundingClientRect().height;
            el.style.height = "auto";
          }}
        >
          <div key={view} style={{ animation: "fade-in 180ms ease-out both" }}>
            {view === "options" ? (
              <>
                {passkeyAvailable ? (
                  <div className="border-b border-line p-2.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        passkeyFlow.reset();
                        setView("passkey");
                      }}
                      className="flex w-full items-center gap-3 rounded-[10px] border border-line bg-page px-3.5 py-3 text-left transition-colors duration-100 hover:border-line-strong hover:bg-hover disabled:opacity-60"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center text-accent">
                        <IconFingerprint size={28} stroke={1.8} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-ink">
                          Passkey
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-2">
                          Sign in securely with your device passkey.
                        </span>
                      </span>
                      <IconChevronRight
                        size={15}
                        stroke={1.8}
                        className="shrink-0 text-ink-3"
                        aria-hidden
                      />
                    </button>
                  </div>
                ) : null}

                <div className="flex min-h-[264px]">
          <div className="w-[124px] shrink-0 border-r border-line p-1.5 sm:w-[148px]">
            {CHAINS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  // NEAR brings its own wallet modal, so it connects directly
                  // instead of listing cards.
                  if (item.id === "near") choose("near", () => connectNear());
                  else setChain(item.id);
                }}
                className={tabClass(item.id !== "near" && chain === item.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.icon}
                  alt=""
                  aria-hidden
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  draggable={false}
                  className="size-6 shrink-0 object-contain"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.id === "near" ? spin("near") : null}
              </button>
            ))}
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1.5">
            {chain === "evm" ? (
              <>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {visibleCatalog.map((entry) => {
                    const key = `evm:${entry.id}`;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const target = findConnectorForEntry(entry);
                          if (target) choose(key, () => connectEvm(target.id));
                          else if (hasInjectedFlag(entry))
                            choose(key, () => connectEvm());
                          else notInstalled(entry);
                        }}
                        className={cardClass}
                      >
                        <WalletIcon src={entry.icon} name={entry.name} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                          {entry.name}
                        </span>
                        {spin(key)}
                      </button>
                    );
                  })}
                  {extraConnectors.map((connector) => {
                    const key = `evm:${connector.id}`;
                    return (
                      <button
                        key={connector.id}
                        type="button"
                        disabled={busy}
                        onClick={() => choose(key, () => connectEvm(connector.id))}
                        className={cardClass}
                      >
                        {connector.icon ? (
                          // The icon arrives from the connector itself.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={connector.icon}
                            alt=""
                            aria-hidden
                            loading="eager"
                            fetchPriority="high"
                            decoding="async"
                            draggable={false}
                            className="size-7 shrink-0"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                          {connector.name}
                        </span>
                        {spin(key)}
                      </button>
                    );
                  })}
                </div>
                {hasInjected ? (
                  <>
                    <div
                      aria-hidden
                      className="mx-auto my-2 h-px w-2/3 bg-gradient-to-r from-transparent via-line to-transparent"
                    />
                    <div className="flex justify-center pb-0.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => choose("evm:injected", () => connectEvm())}
                        className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-page px-4 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors duration-100 hover:border-line-strong hover:text-ink disabled:opacity-60"
                      >
                        <IconWallet size={14} stroke={1.8} className="shrink-0" />
                        Injected
                        {spin("evm:injected")}
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {solanaWallets.map((wallet) => {
                  const key = `sol:${wallet.name}`;
                  return (
                    <button
                      key={wallet.name}
                      type="button"
                      disabled={busy}
                      onClick={() => choose(key, () => connectSolanaWallet(wallet))}
                      className={cardClass}
                    >
                      {wallet.icon ? (
                        // The icon arrives as a data URI from the wallet itself.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={wallet.icon}
                          alt=""
                          aria-hidden
                          loading="eager"
                          fetchPriority="high"
                          decoding="async"
                          draggable={false}
                          className="size-7 shrink-0"
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                        {wallet.name}
                      </span>
                      {spin(key)}
                    </button>
                  );
                })}
                {SOL_CATALOG.filter(
                  (entry) =>
                    !solanaWallets.some((wallet) =>
                      wallet.name.toLowerCase().includes(entry.match),
                    ),
                )
                  // Detected wallets render above; three suggestions at most.
                  .slice(0, 3)
                  .map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={busy}
                    onClick={() => notInstalled(entry)}
                    className={cardClass}
                  >
                    <WalletIcon src={entry.icon} name={entry.name} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                      {entry.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
              </>
            ) : (
              <div className="p-2.5">
                <PasskeyOptions
                  flow={passkeyFlow}
                  onBack={() => {
                    passkeyFlow.reset();
                    setView("options");
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div
          className="grid shrink-0"
          aria-hidden={view !== "options"}
          inert={view !== "options"}
          style={{
            gridTemplateRows:
              view === "options" && (error ?? success ?? pendingNotice)
                ? "1fr"
                : "0fr",
            transition: "grid-template-rows 240ms var(--ease-out-strong)",
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="border-t border-line px-4 py-3">
              <p
                key={error ?? success ?? pendingNotice}
                className={`text-center text-[12.5px] leading-relaxed ${error ? "text-red" : "text-ink"}`}
                style={{ animation: "fade-in 180ms ease-out both" }}
              >
                {error && installLink ? (
                  <>
                    {error}{" "}
                    <a
                      href={installLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline underline-offset-2 hover:opacity-80"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Install
                    </a>{" "}
                    and try again.
                  </>
                ) : (
                  (error ?? success ?? pendingNotice)
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
