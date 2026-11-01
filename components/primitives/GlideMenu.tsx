"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type GlideMenuProps = {
  children: ReactNode;
  className?: string;
  highlightClassName?: string;
  rowSelector?: string;
};

/** A single hover layer that glides between interactive menu rows. */
export default function GlideMenu({
  children,
  className = "",
  highlightClassName = "inset-x-0 rounded-[8px] bg-hover",
  rowSelector = "[data-menu-row]",
}: GlideMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const boxRef = useRef<{ top: number; height: number } | null>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [visible, setVisible] = useState(false);

  const syncBox = (row: HTMLElement) => {
    const container = ref.current;
    if (!container || !container.contains(row)) return;
    // Never sync to a pressed rect. Rows shrink slightly while :active and
    // focus lands mid-press, so measuring then would leave the highlight
    // a pixel short after the press springs back.
    if (row.matches(":active")) {
      rowRef.current = row;
      setVisible(true);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const next = { top: rowRect.top - containerRect.top, height: rowRect.height };
    const prev = boxRef.current;
    rowRef.current = row;
    if (!prev || Math.abs(prev.top - next.top) > 0.5 || Math.abs(prev.height - next.height) > 0.5) {
      boxRef.current = next;
      setBox(next);
    }
    setVisible(true);
  };

  const moveTo = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const row = target.closest(rowSelector);
    if (!(row instanceof HTMLElement)) return;
    syncBox(row);
  };

  const hide = () => {
    rowRef.current = null;
    setVisible(false);
  };

  // The highlight is positioned from cached pixels, so re-sync (or hide)
  // whenever the row list changes — a new chat added above the hovered row
  // shifts every offset, and a search filter can remove the row entirely.
  // The epsilon guard in syncBox keeps this from re-rendering when the
  // parent updates for unrelated reasons.
  useEffect(() => {
    const row = rowRef.current;
    if (row && row.isConnected) syncBox(row);
    else if (rowRef.current || visible) hide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  return (
    <div
      ref={ref}
      onMouseOver={(event) => moveTo(event.target)}
      onMouseLeave={hide}
      onFocusCapture={(event) => moveTo(event.target)}
      onBlurCapture={(event) => {
        if (!ref.current?.contains(event.relatedTarget as Node | null)) hide();
      }}
      className={`group/glide-menu relative ${className}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute ${highlightClassName}`}
        style={{
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: box && visible ? 1 : 0,
          transition:
            "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
        }}
      />
      {children}
    </div>
  );
}
