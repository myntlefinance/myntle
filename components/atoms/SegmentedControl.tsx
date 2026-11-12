"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Segmented control — content-sized segments with a measured sliding
 * thumb. The track hugs its content and each segment wraps its own
 * label, so every pill carries the same side padding no matter how
 * long its label is. The thumb is measured from the active button. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  icons,
  className = "",
  showSelection = true,
  skeleton = false,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  /** Leading mark per segment, drawn before the label. */
  icons?: Partial<Record<T, ReactNode>>;
  className?: string;
  /** Fades the selected pill and ink in once the tab's data is ready. */
  showSelection?: boolean;
  /** The skeleton shell: no pill at all, so skullet has no bone to draw. */
  skeleton?: boolean;
}) {
  const index = options.indexOf(value);
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(
    null,
  );

  /* The track hugs its content and every segment wraps its own label,
   * so each pill carries the same side padding by construction. Equal
   * fractional columns would leave the short labels swimming in space,
   * so the thumb is measured from the active button instead of being
   * derived from the track width. */
  const syncThumb = useCallback(() => {
    const btn = btnRefs.current[index];
    if (!btn) return;
    const left = btn.offsetLeft;
    const width = btn.offsetWidth;
    setThumb((prev) =>
      prev &&
      Math.abs(prev.left - left) < 0.5 &&
      Math.abs(prev.width - width) < 0.5
        ? prev
        : { left, width },
    );
  }, [index]);

  /* Measure on mount and on tab change only. The dep stays the stable
   * syncThumb identity: callers rebuild `options`/`icons` objects on
   * every render, so depending on their identity re-ran this effect —
   * and its setState — after every render, which React kills with
   * "Maximum update depth exceeded" on any sub-pixel shift. Genuine
   * reflows (fonts, marks, track growth) are caught by observing the
   * track and the buttons below instead. */
  useIsomorphicLayoutEffect(() => {
    syncThumb();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncThumb());
    const track = trackRef.current;
    if (track) ro.observe(track);
    for (const btn of btnRefs.current) {
      if (btn) ro.observe(btn);
    }
    return () => ro.disconnect();
  }, [syncThumb]);

  return (
    // Measured per tab: the switch is the page's identity, so the
    // skeleton keeps both tabs and their marks, not one blank pill.
    <div
      ref={trackRef}
      className={`relative inline-grid h-9 select-none rounded-full bg-line/60 p-0.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, auto)` }}
      role="tablist"
    >
      {skeleton ? null : (
        <span
          aria-hidden
          className="absolute inset-y-0.5 rounded-full bg-surface shadow-hairline transition-[left,width,opacity] duration-200"
          style={{
            left: thumb?.left ?? 2,
            width: thumb?.width ?? 0,
            opacity: thumb && showSelection ? 1 : 0,
            transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
          }}
        />
      )}
      {options.map((opt, i) => {
        const active = opt === value && showSelection;
        return (
          <button
            key={opt}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            role="tab"
            aria-selected={opt === value}
            onClick={() => onChange(opt)}
            className={`relative z-10 inline-flex items-center justify-center gap-2 rounded-full px-3.5 text-sm font-medium
            transition-colors duration-150
            ${active ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
          >
            {icons?.[opt] ? (
              <span
                aria-hidden
                className={`inline-flex shrink-0 items-center justify-center transition-[opacity,filter] duration-150 ${
                  active ? "opacity-100" : "opacity-60 saturate-75"
                }`}
              >
                {icons[opt]}
              </span>
            ) : null}
            {opt}
          </button>
        );
      })}
    </div>
  );
}
