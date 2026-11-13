"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * MORPH ADDRESS
 * The address swaps as one line, not as characters: the old
 * string slides up and fades out while the new one slides up
 * from below and fades in. This is the same sliding-text
 * pattern the copy controls use, scaled to the address row.
 * Torph's word-level text morph is the wrong tool here: an
 * address is one long word, so it fades/scales in from the
 * left with a gap, while a number's digits slide vertically by
 * place. Keeping the whole string in one slot makes a NEAR name
 * and a 42-character EVM address change the same way.
 * ───────────────────────────────────────────────────────── */

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Matches fade-up's travel, so the row enters from below like the table. */
const SLIDE_PX = 8;
/** The copy control's sliding-text timing. */
const SWAP_MS = 200;

type SwapState = {
  current: string;
  previous: string | null;
  phase: "idle" | "start" | "run";
};

export function MorphAddress({
  value,
  animate = true,
}: {
  value: string;
  /** Skeleton and reduced states: paint the address plainly. */
  animate?: boolean;
}) {
  const [state, setState] = useState<SwapState>(() => ({
    current: value,
    previous: null,
    phase: "idle",
  }));
  const timer = useRef<number | null>(null);
  const nextFrame = useRef(0);

  // Swap before paint so the first frame is already the start state:
  // old address fully visible, new one waiting below.
  useIsomorphicLayoutEffect(() => {
    setState((prev) => {
      if (prev.current === value) return prev;
      return { current: value, previous: prev.current, phase: "start" };
    });
  }, [value]);

  useIsomorphicLayoutEffect(() => {
    if (state.phase !== "start") return;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const frame = window.requestAnimationFrame(() => {
      // Two frames: the start state must be painted before the
      // transition can run, or the browser coalesces it into the end.
      const next = window.requestAnimationFrame(() => {
        setState((prev) =>
          prev.phase === "start" ? { ...prev, phase: "run" } : prev,
        );
        timer.current = window.setTimeout(() => {
          setState((prev) => ({
            ...prev,
            previous: null,
            phase: "idle",
          }));
          timer.current = null;
        }, SWAP_MS);
      });
      nextFrame.current = next;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nextFrame.current);
    };
  }, [state.phase]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!animate) {
    return (
      <p className="min-w-0 max-w-full text-[14px] font-normal break-all text-ink tabular-nums">
        {value}
      </p>
    );
  }

  const start = state.phase === "start";
  const transition =
    "transition-[opacity,transform] duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-none";

  return (
    <p className="min-w-0 max-w-full text-[14px] font-normal break-all text-ink tabular-nums">
      <span className="relative grid overflow-hidden">
        <span
          aria-hidden="true"
          className={
            start
              ? "col-start-1 row-start-1 block"
              : `col-start-1 row-start-1 block ${transition}`
          }
          style={{
            opacity: start ? 0 : 1,
            transform: start
              ? `translateY(${SLIDE_PX}px)`
              : "translateY(0)",
          }}
        >
          {state.current}
        </span>
        {state.previous ? (
          <span
            aria-hidden="true"
            className={
              start
                ? "col-start-1 row-start-1 block"
                : `col-start-1 row-start-1 block ${transition}`
            }
            style={{
              opacity: start ? 1 : 0,
              transform: start
                ? "translateY(0)"
                : `translateY(-${SLIDE_PX}px)`,
            }}
          >
            {state.previous}
          </span>
        ) : null}
        <span className="sr-only">{value}</span>
      </span>
    </p>
  );
}

export default MorphAddress;
