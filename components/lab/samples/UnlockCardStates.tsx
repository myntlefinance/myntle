"use client";

import {
  IconArrowForward,
  IconLock,
  IconLockFilled,
  IconLockOpen,
} from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";

/**
 * The four moments of the unlock card.
 *
 * locked    — the live tail, waiting on the user. Primary action.
 * cancelled — the dialog closed without a signature. The action demotes.
 * unlocked  — the account has a session. No action; the agent continues.
 * expired   — five minutes old, or superseded by a newer message. Dead.
 */

function Shell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
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

function Body({
  tone,
  title,
  children,
}: {
  tone: "attention" | "green" | "muted";
  title: string;
  children: React.ReactNode;
}) {
  const color =
    tone === "green"
      ? "text-green"
      : tone === "muted"
        ? "text-ink-3"
        : "text-attention";
  return (
    <>
      <div className="flex items-center gap-1.5">
        {tone === "green" ? (
          <IconLockOpen
            size={14}
            stroke={2}
            className={`shrink-0 ${color}`}
            aria-hidden
          />
        ) : tone === "muted" ? (
          <IconLock
            size={14}
            stroke={2}
            className={`shrink-0 ${color}`}
            aria-hidden
          />
        ) : (
          <IconLockFilled
            size={14}
            className={`shrink-0 ${color}`}
            aria-hidden
          />
        )}
        <p className="text-sm font-medium text-ink">{title}</p>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{children}</p>
    </>
  );
}

export default function UnlockCardStates({
  variant = "Live, locked",
}: {
  variant?: string;
}) {
  if (variant === "Live, cancelled") {
    return (
      <Shell
        footer={
          <Button type="button" variant="secondary" size="sm">
            Unlock
          </Button>
        }
      >
        <Body tone="attention" title="Super account locked">
          Unlock cancelled. Please try again.
        </Body>
      </Shell>
    );
  }

  if (variant === "Live, unlocked") {
    return (
      <Shell>
        <Body tone="green" title="Super account unlocked">
          Myntle has access to your super account.
        </Body>
      </Shell>
    );
  }

  if (variant === "Live, expired") {
    return (
      <Shell>
        <Body tone="muted" title="Super account locked">
          Request expired.{" "}
          <button
            type="button"
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
        </Body>
      </Shell>
    );
  }

  return (
    <Shell
      footer={
        <Button type="button" variant="accent" size="sm">
          Unlock
        </Button>
      }
    >
      <Body tone="attention" title="Super account locked">
        Please unlock your super account to continue.
      </Body>
    </Shell>
  );
}
