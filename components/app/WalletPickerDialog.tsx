"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { IconX } from "@tabler/icons-react";

/**
 * The wallet picker frame.
 *
 * This is the login dialog's shell, kept here so the funding dialog can use
 * the same top bar, flush body, chain rail and footer strip without copying
 * the auth flow. The body keeps the original height transition, so switching
 * between a wallet list and a selected wallet grows the panel rather than
 * jumping.
 */
export function WalletPickerDialog({
  label,
  title,
  icon,
  subtitle,
  onClose,
  busy = false,
  contentKey,
  footer,
  children,
  origin,
}: {
  label: string;
  title: string;
  icon: ReactNode;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  /** Changing this key replays the body entrance and measures a new height. */
  contentKey: string;
  footer?: ReactNode;
  children: ReactNode;
  /** Viewport point the dialog grows from; clamped to its own edge. */
  origin?: { x: number; y: number } | null;
}) {
  const [mounted, setMounted] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyHeightRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelOrigin, setPanelOrigin] = useState<string | undefined>(undefined);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, busy]);

  // Lock the wrapper to its previous height, then move it to the new
  // content's height on the next frame. This is the login picker's height
  // behavior, reused so the two dialogs feel identical.
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
  }, [contentKey, mounted]);

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

  // Origin-aware entrance: the click point clamped to the panel's own
  // edge becomes the scale origin, so the dialog grows from the general
  // direction of the trigger instead of always the center. Keyboard
  // opens carry no point and keep the centered default.
  useLayoutEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    if (!panel || !origin) {
      setPanelOrigin(undefined);
      return;
    }
    const rect = panel.getBoundingClientRect();
    const cx = Math.min(Math.max(origin.x, rect.left), rect.right);
    const cy = Math.min(Math.max(origin.y, rect.top), rect.bottom);
    setPanelOrigin(`${cx - rect.left}px ${cy - rect.top}px`);
  }, [mounted, origin, contentKey]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
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
        ref={panelRef}
        className="relative flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-window border border-line bg-surface shadow-overlay"
        style={{
          animation: "dialog-in 240ms var(--ease-out-strong) both",
          transformOrigin: panelOrigin,
        }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-4 pr-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-ink-2">{icon}</span>
            <span className="truncate text-[13px] font-semibold text-ink">
              {title}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
            className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3"
          >
            <IconX size={15} />
          </button>
        </div>

        {subtitle ? (
          <p className="shrink-0 border-b border-line px-4 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
            {subtitle}
          </p>
        ) : null}

        <div
          ref={bodyRef}
          className="min-h-0 overflow-hidden"
          style={{ transition: "height 320ms var(--ease-out-strong)" }}
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.propertyName !== "height") return;
            const el = event.currentTarget;
            bodyHeightRef.current = el.getBoundingClientRect().height;
            el.style.height = "auto";
          }}
        >
          <div
            key={contentKey}
            style={{ animation: "fade-in 180ms ease-out both" }}
          >
            {children}
          </div>
        </div>

        <div
          className="grid shrink-0"
          style={{
            gridTemplateRows: footer ? "1fr" : "0fr",
            transition: "grid-template-rows 240ms var(--ease-out-strong)",
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="border-t border-line px-4 py-3">{footer}</div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
