"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * THINKING TRACE — the live version of the ThinkingState
 * primitive.
 *
 * The primitive plays its trace on a clock, so it cannot show
 * real reasoning tokens. This one is driven by the stream
 * instead: the header shimmers while the model is thinking,
 * settles into "Thought for N seconds", and the prose stays
 * expandable either way. Nothing renders unless the model
 * actually thought.
 * ───────────────────────────────────────────────────────── */

export default function ThinkingTrace({
  text,
  active,
}: {
  /** The reasoning streamed so far. */
  text: string;
  /** Whether the model is still thinking. */
  active: boolean;
}) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? active;

  /* the thinking duration, counted live and left standing once
   * the trace settles */
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  /* the connector line follows the prose as it streams in, so a
   * plain layout effect misses the growth — measure continuously */
  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    const el = traceRef.current;
    if (!el) return;
    const measure = () => setLineHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* the reasoning arrives as one growing block of prose; blank
   * lines split it into rows the way the primitive lays its
   * traces out */
  const rows = text.split(/\n\s*\n/);

  /* a trace that settles in under a second still reads as a
   * second, never as "0 seconds" */
  const duration = Math.max(seconds, 1);

  return (
    <div className="flex w-full max-w-95 flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? expanded))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1
          transition-colors duration-100 hover:bg-hover-2"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? "var(--ink-2)" : "var(--ink-3)"}>
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span role="status" className="contents">
          {active ? (
            <span
              className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
                backgroundSize: "200% 100%",
                animation: "shimmer-text 1.4s linear infinite",
              }}
            >
              Thinking
            </span>
          ) : (
            <span
              className="text-[13px] font-medium whitespace-nowrap text-ink-2"
              style={{ animation: "fade-in 350ms ease-out both" }}
            >
              Thought for {duration === 1 ? "a second" : `${duration} seconds`}
            </span>
          )}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className="transition-transform duration-300"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* expandable trace */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-line"
              style={{ top: -8, height: lineHeight ? lineHeight - 2 : 0, transition: "height 500ms cubic-bezier(0.23,1,0.32,1)" }}
            />
            <div ref={traceRef} className="flex flex-col gap-1 py-1">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="flex min-h-7 w-full items-center rounded-[6px] px-1.5 py-0.5"
                  style={{ animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${Math.min(i, 6) * 120}ms both` }}
                >
                  <span className="text-[12.5px] whitespace-pre-wrap leading-relaxed text-ink-2">
                    {row}
                    {active && i === rows.length - 1 ? <span className="stream-caret is-streaming" /> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
