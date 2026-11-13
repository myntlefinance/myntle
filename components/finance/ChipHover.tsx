"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";
import {
  activateWarmState,
  globalIsWarm,
  onTooltipEnter,
  onTooltipLeave,
} from "@/components/app/tooltip";
import {
  claimHoverCard,
  dismissHoverCard,
  releaseHoverCard,
} from "@/components/app/hoverCard";
import { useViewportIntent } from "@/components/app/usePrice";

/** Fixed-position detail card for an inline chip. Portalled to the body so
 * an inline wrapper, a card with overflow hidden, or a stacking context
 * cannot trap or reflow it. */
function Popup({
  anchorRef,
  label,
  height,
  instant,
  dialogRef,
  onClose,
  onHoverChange,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  /** Estimated card height, used only to pick which side it opens on. */
  height: number;
  /** True when a card is already warm: skip the entrance animation. */
  instant: boolean;
  dialogRef: (el: HTMLDivElement | null) => void;
  onClose: () => void;
  onHoverChange: (hovering: boolean) => void;
  children: ReactNode;
}) {
  const [box, setBox] = useState<
    { x: number; top?: number; bottom?: number; origin: string } | null
  >(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = 248;
    const x = Math.min(
      Math.max(8, r.left + r.width / 2 - w / 2),
      window.innerWidth - w - 8,
    );
    // Prefer the side above the chip whenever the card fits there. Only
    // fall below when it does not, and when neither side fits, take the
    // side with more room.
    const fitsAbove = r.top - 8 - height > 8;
    const fitsBelow = r.bottom + 8 + height < window.innerHeight;
    const above = fitsAbove
      ? true
      : fitsBelow
        ? false
        : r.top > window.innerHeight - r.bottom;
    const chipCenter = r.left + r.width / 2;
    const originX = Math.min(Math.max(((chipCenter - x) / w) * 100, 0), 100);
    const origin = `${originX.toFixed(1)}% ${above ? "100%" : "0%"}`;
    setBox(
      above
        ? { x, bottom: window.innerHeight - r.top + 8, origin }
        : { x, top: r.bottom + 8, origin },
    );

    const startX = r.left;
    const startY = r.top;
    const onScroll = () => {
      const current = anchorRef.current?.getBoundingClientRect();
      if (!current) {
        onClose();
        return;
      }
      if (
        Math.abs(current.left - startX) > 2 ||
        Math.abs(current.top - startY) > 2
      ) {
        onClose();
      }
    };
    const onResize = () => onClose();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [anchorRef, height, onClose]);

  if (!box) return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={label}
      data-instant={instant ? "" : undefined}
      className="token-hover-card rounded-card bg-surface p-3 shadow-card"
      style={{
        position: "fixed",
        left: box.x,
        width: 248,
        zIndex: 50,
        ...(box.bottom != null ? { bottom: box.bottom } : { top: box.top }),
        transformOrigin: box.origin,
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * A hover, focus, and tap wrapper for an inline chip. The card is rendered
 * only while open, so an `AssetPill` in a markdown paragraph adds no popup
 * DOM until someone asks for it.
 */
export function ChipHover({
  label,
  height = 220,
  content,
  children,
  className,
  onIntent,
}: {
  label: string;
  /** Estimated card height, used only to choose the opening side. */
  height?: number;
  content: ReactNode;
  children: ReactNode;
  className?: string;
  /** Warm anything the card needs as soon as the pointer arrives. */
  onIntent?: () => void;
}) {
  const cardId = useId();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  // Portal target only exists in the browser; the first render (and the
  // server) shows no popup so hydration always matches.
  const mounted = useMounted();
  const [popupEl, setPopupEl] = useState<HTMLDivElement | null>(null);
  // A click that follows its own focus-open must not toggle straight shut:
  // mousedown focuses (opens), mouseup clicks. The flag eats exactly that
  // click; later clicks toggle normally.
  const focusOpened = useRef(false);

  // Warm the card as soon as the chip is within 200px of the viewport, not
  // only when the pointer arrives. Hover then opens from a warm cache.
  useViewportIntent(anchorRef, () => onIntent?.(), Boolean(onIntent));

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      releaseHoverCard(cardId);
    };
  }, [cardId]);

  const cancelTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const close = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setOpen(false);
    releaseHoverCard(cardId);
    onTooltipLeave();
  }, [cardId]);

  const openNow = () => {
    claimHoverCard(cardId, close);
    setOpen(true);
  };

  const show = () => {
    cancelTimer();
    onIntent?.();
    // Close any card owned by another chip before this hover begins its
    // own (possibly delayed) open, so two cards never overlap.
    dismissHoverCard(cardId);
    onTooltipEnter();
    // Already showing: keep the current card and its entrance state. Re-running
    // the open path here can restart the pop-in and make the card blink.
    if (open) return;
    // Warm: adjacent cards open immediately and skip the entrance, exactly
    // like the product tooltips. Cold: keep the short guard delay and let
    // the first card animate in.
    if (globalIsWarm) {
      setInstant(true);
      openNow();
      return;
    }
    setInstant(false);
    timer.current = setTimeout(() => {
      openNow();
      activateWarmState();
    }, 120);
  };

  const hide = () => {
    // A re-render or a portal appearing can produce a synthetic mouseleave
    // while the pointer is still on the chip. Trust the live hover state.
    if (anchorRef.current?.matches(":hover")) return;
    cancelTimer();
    onTooltipLeave();
    timer.current = setTimeout(close, 150);
  };

  // Keyboard focus can move from the chip into the portalled card; close
  // only when focus leaves both.
  const blur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (event.currentTarget.contains(next)) return;
    if (popupEl?.contains(next)) return;
    close();
  };

  return (
    <span
      ref={anchorRef}
      tabIndex={0}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={cn(
        "rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => {
        // Keyboard is repeated work; open instantly rather than animating.
        focusOpened.current = true;
        onIntent?.();
        if (open) return;
        activateWarmState();
        setInstant(true);
        openNow();
      }}
      onBlur={blur}
      onClick={(event) => {
        if (event.detail !== 0 && focusOpened.current) {
          focusOpened.current = false;
          return;
        }
        focusOpened.current = false;
        if (open) {
          close();
          return;
        }
        activateWarmState();
        setInstant(true);
        onIntent?.();
        openNow();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      {children}
      {open && mounted
        ? createPortal(
            <Popup
              anchorRef={anchorRef}
              label={label}
              height={height}
              instant={instant}
              dialogRef={setPopupEl}
              onClose={close}
              onHoverChange={(hovering) => {
                cancelTimer();
                if (hovering) {
                  onTooltipEnter();
                  return;
                }
                hide();
              }}
            >
              {content}
            </Popup>,
            document.body,
          )
        : null}
    </span>
  );
}

export default ChipHover;
