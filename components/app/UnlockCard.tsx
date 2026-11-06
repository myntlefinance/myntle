"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  IconArrowForward,
  IconLock,
  IconLockFilled,
  IconLockOpen,
} from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { openSuperUnlock } from "@/components/app/SuperUnlockDialog";
import { useAuth } from "@/lib/auth/auth-provider";
import {
  getValidAccessToken,
  SUPER_CANCEL_EVENT,
  SUPER_CONTINUE_EVENT,
  useSuperUnlocked,
} from "@/lib/intents/user-session";
import { useWallet } from "@/lib/wallet/registry";

const FIVE_MINUTES_MS = 5 * 60_000;

/**
 * The unlock request card, in four states.
 *
 * locked   — the live tail, waiting on the user.
 * canceled — the dialog was closed without a signature; the action demotes,
 *            so the card stops pushing but keeps the way back.
 * unlocked — the account has a session; no action is needed.
 * expired  — five minutes old, or no longer the tail because the user moved
 *            on. The request is dead; asking again is the way forward.
 *
 * Only the live tail can act. Everything else is a record.
 */
type CardState = "locked" | "canceled" | "unlocked" | "expired";

function LockMark({
  tone,
}: {
  tone: "attention" | "green" | "muted";
}) {
  const color =
    tone === "green"
      ? "text-green"
      : tone === "muted"
        ? "text-ink-3"
        : "text-attention";
  const className = `shrink-0 ${color}`;

  if (tone === "green") {
    return <IconLockOpen size={14} stroke={2} className={className} aria-hidden />;
  }
  if (tone === "muted") {
    return <IconLock size={14} stroke={2} className={className} aria-hidden />;
  }
  return <IconLockFilled size={14} className={className} aria-hidden />;
}

function CardShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mt-2.5 w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div
        className="primitive-card-pad"
        style={{ paddingBottom: footer ? 6 : undefined }}
      >
        {children}
      </div>
      {footer ? (
        <div
          className="primitive-card-footer flex items-center justify-end gap-2 bg-surface"
          style={{ paddingTop: 6, paddingBottom: 6 }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function CardBody({
  tone,
  title,
  children,
}: {
  tone: "attention" | "green" | "muted";
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <LockMark tone={tone} />
        <p className="text-sm font-medium text-ink">{title}</p>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{children}</p>
    </>
  );
}

/** The resolved card, also used at the top of the continuation message. */
export function UnlockedCard() {
  const { identity } = useAuth();
  const passkey = identity?.kind === "passkey";
  return (
    <CardShell>
      <CardBody
        tone="green"
        title={passkey ? "Private balance unlocked" : "Super account unlocked"}
      >
        {passkey
          ? "Myntle can read your private balance."
          : "Myntle has access to your super account."}
      </CardBody>
    </CardShell>
  );
}

export function UnlockRequestCard({
  callId,
  createdAt,
  interactive,
  superseded,
  onRetry,
}: {
  callId?: string;
  createdAt: number | null;
  /** True only in the live chat, where the card may still act. */
  interactive: boolean;
  /** A later user message exists, so this request is a record. */
  superseded: boolean;
  /** Present only in the live chat; trash and previews have no composer. */
  onRetry?: () => void;
}) {
  const { account } = useWallet();
  const { identity } = useAuth();
  const passkey = identity?.kind === "passkey" ? identity : null;
  const unlocked = useSuperUnlocked(
    passkey ? "passkey" : account?.kind,
    passkey ? passkey.accountId : account?.address,
  );
  const [canceled, setCanceled] = useState(false);
  const [checking, setChecking] = useState(false);
  const [timedOut, setTimedOut] = useState(
    () => createdAt !== null && Date.now() - createdAt >= FIVE_MINUTES_MS,
  );

  useEffect(() => {
    if (timedOut || createdAt === null) return;
    const remaining = Math.max(
      0,
      createdAt + FIVE_MINUTES_MS - Date.now(),
    );
    const timer = window.setTimeout(() => setTimedOut(true), remaining);
    return () => window.clearTimeout(timer);
  }, [createdAt, timedOut]);

  useEffect(() => {
    if (!callId) return;
    const onCancel = (event: Event) => {
      const id = (event as CustomEvent<{ callId?: string }>).detail?.callId;
      if (id === callId) setCanceled(true);
    };
    window.addEventListener(SUPER_CANCEL_EVENT, onCancel);
    return () => window.removeEventListener(SUPER_CANCEL_EVENT, onCancel);
  }, [callId]);

  const handleUnlock = async () => {
    if (checking) return;
    if (!passkey && !account) {
      openSuperUnlock(callId);
      return;
    }
    setChecking(true);
    try {
      // Already unlocked somewhere else (another tab, the wallet menu, a
      // previous dialog): recheck before asking for another signature.
      const token = passkey
        ? await getValidAccessToken("passkey", passkey.accountId)
        : await getValidAccessToken(account!.kind, account!.address);
      if (token) {
        window.dispatchEvent(new CustomEvent(SUPER_CONTINUE_EVENT));
        return;
      }
      openSuperUnlock(callId);
    } finally {
      setChecking(false);
    }
  };

  const state: CardState =
    !interactive || superseded || timedOut
      ? "expired"
      : unlocked
        ? "unlocked"
        : canceled
          ? "canceled"
          : "locked";

  const lockedTitle = passkey
    ? "Private balance locked"
    : "Super account locked";

  if (state === "unlocked") return <UnlockedCard />;

  if (state === "expired") {
    // Any expired card in the live chat can start a new request, even after
    // the user has moved on. Only the Unlock action is disabled there.
    const canPrompt = interactive && Boolean(onRetry);
    return (
      <CardShell>
        <CardBody tone="muted" title={lockedTitle}>
          {canPrompt ? (
            <>
              Request expired.{" "}
              <button
                type="button"
                onClick={onRetry}
                className="group inline text-left font-medium text-ink transition-colors duration-100"
              >
                <span className="inline border-b border-dashed border-line-strong pb-0.5 transition-colors duration-100 group-hover:border-ink-3">
                  <IconArrowForward
                    size={13}
                    stroke={2}
                    className="mr-1 inline-block shrink-0 align-middle -translate-y-px"
                    aria-hidden
                  />
                  Prompt the agent for a new request.
                </span>
              </button>
            </>
          ) : (
            "Request expired."
          )}
        </CardBody>
      </CardShell>
    );
  }

  if (state === "canceled") {
    return (
      <CardShell
        footer={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void handleUnlock()}
            disabled={checking}
          >
            Unlock
          </Button>
        }
      >
        <CardBody tone="attention" title={lockedTitle}>
          Unlock cancelled. Please try again.
        </CardBody>
      </CardShell>
    );
  }

  return (
    <CardShell
      footer={
        <Button
          type="button"
          variant="accent"
          size="sm"
          onClick={() => void handleUnlock()}
          disabled={checking}
        >
          Unlock
        </Button>
      }
    >
      <CardBody tone="attention" title={lockedTitle}>
        {passkey
          ? "Please unlock your private balance to continue."
          : "Please unlock your super account to continue."}
      </CardBody>
    </CardShell>
  );
}
