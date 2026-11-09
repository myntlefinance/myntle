"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ToolStep } from "@/components/primitives/ToolChips";
import { Markdown } from "@/components/app/Markdown";
import { stripAssetMarkup } from "@/components/app/assetMarkup";

/* ─────────────────────────────────────────────────────────
 * ACTIVITY PILLS — the live record of what the assistant did
 * inside one turn.
 *
 * A pill is one phase of the turn:
 *   thinking pill — one reasoning segment. It streams
 *     expanded and settles into "Thought for n seconds"
 *     with the segment's own duration, frozen at the moment
 *     its phase ended.
 *   tools pill — one run of consecutive tool calls. It streams
 *     expanded and settles into "Ran n tools".
 *   text — the reply itself, streamed as markdown through
 *     `components/app/Markdown`, which settles unterminated
 *     syntax while the reply is still arriving.
 *
 * The global rule: only the last phase of an in-flight turn
 * is active. A settled pill stays collapsed so a revisited
 * chat reads as its answers, not its old runs.
 * Opening a pill by hand wins over the automatic rules.
 * ───────────────────────────────────────────────────────── */

export type ActivityBlock =
  | { kind: "reasoning"; text: string }
  | { kind: "tools"; steps: ToolStep[] }
  | { kind: "text"; text: string };

/* One glyph per kind of work, taken from Tabler's outline set on the 24px
 * grid the row draws at 13px. The label says what happened; the glyph says
 * which kind of thing happened, so a balance read and a settled trade are
 * distinguishable without reading the chip. */
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ICONS: Record<string, ReactNode> = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  /* the run header's glyph — the rows below it each carry their own */
  run: (
    <g {...STROKE}>
      <path d="M4 17l6 -5l-6 -5" />
      <path d="M12 19h8" />
    </g>
  ),
  assets: (
    <g {...STROKE}>
      <path d="M9 6l11 0" />
      <path d="M9 12l11 0" />
      <path d="M9 18l11 0" />
      <path d="M5 6l0 .01" />
      <path d="M5 12l0 .01" />
      <path d="M5 18l0 .01" />
    </g>
  ),
  wallet: (
    <g {...STROKE}>
      <path d="M17 8v-3a1 1 0 0 0 -1 -1h-10a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1 -1 1h-12a2 2 0 0 1 -2 -2v-12" />
      <path d="M20 12v4h-4a2 2 0 0 1 0 -4h4" />
    </g>
  ),
  chart: (
    <g {...STROKE}>
      <path d="M4 19l16 0" />
      <path d="M4 15l4 -6l4 2l4 -5l4 4" />
    </g>
  ),
  swap: (
    <g {...STROKE}>
      <path d="M7 10h14l-4 -4" />
      <path d="M17 14h-14l4 4" />
    </g>
  ),
  deposit: (
    <g {...STROKE}>
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
      <path d="M7 11l5 5l5 -5" />
      <path d="M12 4l0 12" />
    </g>
  ),
  price: (
    <g {...STROKE}>
      <path d="M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3" />
    </g>
  ),
  withdraw: (
    <g {...STROKE}>
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
      <path d="M7 9l5 -5l5 5" />
      <path d="M12 4l0 12" />
    </g>
  ),
  activity: (
    <g {...STROKE}>
      <path d="M3 12h4l3 8l4 -16l3 8h4" />
    </g>
  ),
  history: (
    <g {...STROKE}>
      <path d="M12 8l0 4l2 2" />
      <path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" />
    </g>
  ),
  lock: (
    <g {...STROKE}>
      <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6" />
      <path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
      <path d="M8 11v-4a4 4 0 1 1 8 0v4" />
    </g>
  ),
  unlock: (
    <g {...STROKE}>
      <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -6" />
      <path d="M11 16a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M8 11v-5a4 4 0 0 1 8 0" />
    </g>
  ),
  web: (
    <g {...STROKE}>
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
      <path d="M3.6 9h16.8" />
      <path d="M3.6 15h16.8" />
      <path d="M11.5 3a17 17 0 0 0 0 18" />
      <path d="M12.5 3a17 17 0 0 1 0 18" />
    </g>
  ),
  social: (
    <g {...STROKE}>
      <path d="M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1" />
    </g>
  ),
  article: (
    <g {...STROKE}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" />
      <path d="M9 9l1 0" />
      <path d="M9 13l6 0" />
      <path d="M9 17l6 0" />
    </g>
  ),
  unknown: (
    <g {...STROKE}>
      <path d="M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    </g>
  ),
};

/** the shimmering in-flight label, same text treatment as the loader */
function ShimmerLabel({ children }: { children: ReactNode }) {
  return (
    <span role="status" className="contents">
      <span
        className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {children}
      </span>
    </span>
  );
}

/** the settled chip label — ink-2, static, reads as a complete phrase */
function SettledLabel({ children }: { children: ReactNode }) {
  return <span className="text-[13px] font-medium text-ink-2">{children}</span>;
}

function PillButton({
  icon,
  active,
  open,
  onToggle,
  children,
}: {
  icon: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill={icon === "think" ? "currentColor" : "none"}
        stroke="currentColor"
        className={active ? "text-ink-2" : "text-ink-3"}
      >
        {ICONS[icon]}
      </svg>
      {children}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--ink-3)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-transform duration-300"
        style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

/** the accordion body wrapper shared by both pills */
function PillBody({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-400"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)",
      }}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} seconds`;
  return `${Math.round(s)} seconds`;
}

function ThinkingPill({
  text,
  settled,
  durationMs,
}: {
  text: string;
  settled: boolean;
  durationMs: number | null;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const [ruleHeight, setRuleHeight] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  /* the vertical rule beside the prose, redrawn as it grows */
  useEffect(() => {
    if (bodyRef.current) setRuleHeight(Math.max(0, bodyRef.current.offsetHeight - 2));
  }, [text, manual, settled]);

  /* Hold it open while the phase streams: flipping shut mid-stream
   * while stuck to the bottom bounces the thread. Once settled the
   * run is done, so the pill stays collapsed and the answer leads. */
  const open = manual ?? !settled;

  return (
    <div className="w-full max-w-95">
      <PillButton
        icon="think"
        active={!settled}
        open={open}
        onToggle={() => setManual(!open)}
      >
        {!settled ? (
          <ShimmerLabel>Thinking</ShimmerLabel>
        ) : (
          <SettledLabel>
            Thought for {durationMs !== null ? formatDuration(durationMs) : "a moment"}
          </SettledLabel>
        )}
      </PillButton>
      <PillBody open={open}>
        <div className="relative mt-1 ml-[5px] pl-4">
          <span
            aria-hidden
            className="absolute left-[3px] w-px bg-line"
            style={{ top: -8, height: ruleHeight, transition: "height 500ms cubic-bezier(0.23,1,0.32,1)" }}
          />
          <div
            ref={bodyRef}
            className="py-1 text-[12.5px] leading-[1.625] whitespace-pre-line text-ink-2"
          >
            {stripAssetMarkup(text.trim())}
          </div>
        </div>
      </PillBody>
    </div>
  );
}

function ToolsPill({
  steps,
  settled,
}: {
  steps: ToolStep[];
  settled: boolean;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());
  /* Hold it open while the run streams: flipping shut the moment a new
   * step lands collapses the pill mid-turn, and stuck to the bottom that
   * reads as the thread bouncing up then down. Once settled the run is
   * done, so the pill stays collapsed and the answer leads. */
  const open = manual ?? !settled;
  const count = steps.length;

  const toggleRow = (index: number) =>
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className="w-full max-w-95">
      <PillButton
        icon="run"
        active={!settled}
        open={open}
        onToggle={() => setManual(!open)}
      >
        {!settled ? (
          <ShimmerLabel>
            {count <= 1 ? "Running tools" : `Running ${count} tools`}
          </ShimmerLabel>
        ) : (
          <SettledLabel>
            Ran {count} {count === 1 ? "tool" : "tools"}
          </SettledLabel>
        )}
      </PillButton>
      <PillBody open={open}>
        <div className="mt-1 flex flex-col gap-1 py-0.5">
          {steps.map((row, index) => {
            const expandable = row.detail.length > 0;
            const rowOpen = openRows.has(index);
            return (
              <div
                key={index}
                style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}
              >
                <button
                  type="button"
                  aria-expanded={expandable ? rowOpen : undefined}
                  disabled={!expandable}
                  onClick={expandable ? () => toggleRow(index) : undefined}
                  className={`group/row flex h-7 min-w-0 items-center gap-2 rounded-control px-1.5 text-left ${
                    expandable
                      ? "transition-colors duration-100 hover:bg-hover-2"
                      : "cursor-default"
                  }`}
                >
                  <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill={row.icon === "think" ? "currentColor" : "none"}
                      stroke="currentColor"
                      className={`transition-opacity duration-100 ${expandable ? "group-hover/row:opacity-0" : ""} ${rowOpen ? "opacity-0" : ""}`}
                    >
                      {ICONS[row.icon] ?? ICONS.unknown}
                    </svg>
                    {expandable && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                        className={`absolute transition-[opacity,transform] duration-150 ${rowOpen ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}
                        style={{ transform: rowOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    )}
                  </span>
                  <span className="shrink-0 text-[12.5px] font-medium text-ink">{row.label}</span>
                  <span
                    className={`inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5
                      text-[11.5px] text-ink-2 shadow-hairline ${row.mono ? "font-mono" : ""}`}
                  >
                    {row.chip}
                  </span>
                </button>

                {expandable && (
                  <PillBody open={rowOpen}>
                    <div className="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
                      {row.detail.map((line, i) => (
                        <span
                          key={`${i}-${line.text}`}
                          className={`truncate text-[11.5px] leading-[1.6] ${row.detailMono ? "font-mono" : ""} ${line.tone === "add" ? "text-green" : "text-ink-2"}`}
                        >
                          {line.text}
                        </span>
                      ))}
                    </div>
                  </PillBody>
                )}
              </div>
            );
          })}
        </div>
      </PillBody>
    </div>
  );
}

export default function ActivityPills({
  blocks,
  running,
}: {
  blocks: ActivityBlock[];
  running: boolean;
}) {
  const activity = blocks
    .map((block, index) => (block.kind === "text" ? null : index))
    .filter((index): index is number => index !== null);
  const current = running && activity.length > 0 ? activity[activity.length - 1] : -1;

  /* phase timings. The start is stamped the first render a phase exists;
   * the end, the first render it is no longer the current phase. Frozen
   * in refs so a settled pill keeps its duration for the rest of the turn. */
  const now = Date.now();
  const startsRef = useRef(new Map<number, number>());
  const endsRef = useRef(new Map<number, number>());
  blocks.forEach((block, index) => {
    if (block.kind === "text") return;
    if (!startsRef.current.has(index)) startsRef.current.set(index, now);
    if (index !== current && !endsRef.current.has(index)) {
      endsRef.current.set(index, now);
    }
  });

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => {
        if (block.kind === "text") {
          /* only the last block of an in-flight turn is still streaming;
           * everything else is settled text and renders without the caret */
          const streaming = running && index === blocks.length - 1;
          return (
            <Markdown key={index} isAnimating={streaming} caret={streaming}>
              {block.text}
            </Markdown>
          );
        }

        const settled = index !== current;
        const durationMs = endsRef.current.has(index)
          ? (endsRef.current.get(index)! - startsRef.current.get(index)!)
          : null;

        if (block.kind === "reasoning") {
          return (
            <ThinkingPill
              key={`thinking-${index}`}
              text={block.text}
              settled={settled}
              durationMs={durationMs}
            />
          );
        }

        return (
          <ToolsPill
            key={`tools-${index}`}
            steps={block.steps}
            settled={settled}
          />
        );
      })}
    </div>
  );
}
