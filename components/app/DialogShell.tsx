"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * The shared dialog shell, matching the product's confirmation dialogs
 * (trash delete / empty trash): dimmed animated backdrop, plain title and
 * body in card padding, actions in the card footer. No header bar, no
 * divider, no X — Escape and the backdrop dismiss. Every modal dialog in
 * the app uses this so overlays never drift apart again.
 */
export function DialogShell({
  label,
  title,
  icon,
  subtitle,
  onClose,
  busy = false,
  leaving = false,
  footer,
  children,
}: {
  label: string;
  title: string;
  icon?: ReactNode;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  /** fades the whole dialog out instead of unmounting it mid-frame */
  leaving?: boolean;
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
        className="absolute inset-0 bg-black/60 dark:bg-black/75"
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
          <div
            title={title}
            className="flex items-center gap-1.5 truncate text-[14px] font-medium text-ink"
          >
            {icon}
            <span className="truncate">{title}</span>
          </div>
          {subtitle ? (
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              {subtitle}
            </p>
          ) : null}
          {children}
        </div>
        {footer ? (
          <div className="primitive-card-footer flex items-center justify-end">
            <div className="-mr-0.5 flex items-center gap-1.5">{footer}</div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
