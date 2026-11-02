"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import LoadingState from "@/components/primitives/LoadingState";
import type { ToolStep } from "@/components/primitives/ToolChips";
import { Markdown } from "@/components/app/Markdown";

/* ─────────────────────────────────────────────────────────
 * ACTIVITY PILLS — the live record of what the assistant did
 * inside one turn.
 *
 * A pill is one phase of the turn:
 *   thinking pill — one reasoning segment. It streams
 *     expanded, collapses by itself once the prose passes
 *     three visual lines, and settles into
 *     "Thought for n seconds" with the segment's own
 *     duration, frozen at the moment its phase ended.
 *   tools pill — one run of consecutive tool calls. It stays
 *     expanded for up to two steps and collapses beyond that.
 *   text — the reply itself, streamed as markdown through
 *     `components/app/Markdown`, which settles unterminated
 *     syntax while the reply is still arriving.
 *
 * The global rule: only the last phase of an in-flight turn
 * is active. The moment a newer pill arrives — a tool call
 * interrupting the thinking, new thinking after the tool
 * result, or the turn simply ending — every earlier pill
 * collapses to its settled chip and keeps what it reached.
 * Opening a pill by hand wins over the automatic rules.
 * ───────────────────────────────────────────────────────── */

export type ActivityBlock =
  | { kind: "reasoning"; text: string }
  | { kind: "tools"; steps: ToolStep[] }
  | { kind: "text"; text: string };

/* 12.5px text at leading 1.625 — the reasoning pill's line height */
const REASONING_LINE = 12.5 * 1.625;

const ICONS: Record<string, ReactNode> = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></g>,
  run: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l6-5-6-5M12 19h8" /></g>,
  read: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></g>,
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
  const [long, setLong] = useState(false);
  const [ruleHeight, setRuleHeight] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  /* collapse the pill once the prose passes three visual lines;
   * measured while it is expanded, so the skip guard matters */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || long) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || REASONING_LINE;
    if (Math.ceil(el.clientHeight / lineHeight) > 3) setLong(true);
  }, [text, long]);

  /* the vertical rule beside the prose, redrawn as it grows */
  useEffect(() => {
    if (bodyRef.current) setRuleHeight(Math.max(0, bodyRef.current.offsetHeight - 2));
  }, [text, manual, settled, long]);

  const open = manual ?? (!settled && !long);

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
            {text.trim()}
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
  /* two tool calls read at a glance; more than that collapses the run */
  const open = manual ?? (!settled && steps.length <= 2);
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
                      {ICONS[row.icon]}
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
                      {row.detail.map((line) => (
                        <span
                          key={line.text}
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
