"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";

/**
 * The shared dialog shell, matching the product's confirmation dialogs
 * (trash delete / empty trash): dimmed animated backdrop, plain title and
 * body in card padding, actions in the card footer. No header bar and no
 * divider; a dialog can opt into the product's close mark beside its
 * title. Escape and the backdrop dismiss either way. Every modal dialog
 * in the app uses this so overlays never drift apart again.
 */
export function DialogShell({
  label,
  title,
  icon,
  subtitle,
  closeButton = false,
  onClose,
  busy = false,
  leaving = false,
  footerStart,
  footer,
  children,
}: {
  label: string;
  title: string;
  icon?: ReactNode;
  subtitle?: string;
  /** Adds the product's close mark beside the title. */
  closeButton?: boolean;
  onClose: () => void;
  busy?: boolean;
  /** fades the whole dialog out instead of unmounting it mid-frame */
  leaving?: boolean;
  /** Secondary action on the footer's leading edge, away from the decision. */
  footerStart?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-200 ${leaving ? "pointer-events-none opacity-0" : "opacity-100"}`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div
        // The blur keeps bright page elements (the allocation pills) from
        // reading as colored notches against the card's edge.
        className="absolute inset-0 bg-black/60 backdrop-blur-sm dark:bg-black/75"
        style={{ animation: "fade-in 180ms ease-out both" }}
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        className="relative flex max-h-[calc(100dvh-2rem)] min-h-[154px] w-full max-w-md flex-col justify-between overflow-y-auto scroll-slim rounded-card bg-surface shadow-overlay"
        style={{ animation: "dialog-in 240ms var(--ease-out-strong) both" }}
      >
        <div className="primitive-card-pad">
          <div className="flex items-center justify-between gap-2">
            <div
              title={title}
              className="flex min-w-0 items-center gap-1.5 truncate text-[14px] font-medium text-ink"
            >
              {icon}
              <span className="truncate">{title}</span>
            </div>
            {closeButton ? (
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                disabled={busy}
                className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3"
              >
                <IconX size={15} aria-hidden />
              </button>
            ) : null}
          </div>
          {subtitle ? (
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              {subtitle}
            </p>
          ) : null}
          {children}
        </div>
        {footer || footerStart ? (
          <div className="primitive-card-footer flex items-center">
            {footerStart ? (
              <div className="-ml-0.5 flex items-center gap-1.5">
                {footerStart}
              </div>
            ) : null}
            {footer ? (
              <div className="-mr-0.5 ml-auto flex items-center gap-1.5">
                {footer}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
