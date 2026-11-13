"use client";

import { useState, type ReactNode } from "react";
import type { ToolStep } from "@/components/primitives/ToolChips";
import { Markdown } from "@/components/app/Markdown";

/* ─────────────────────────────────────────────────────────
 * ACTIVITY STATUS — the live record of one turn's work.
 *
 * The turn is one line, not a run of pills. While a run is
 * live the line names the phase in progress: reasoning reads
 * "Thinking", a tool reads its own present-tense name, and
 * the glyph is the same one its row would have drawn. When
 * the reply starts, the line is gone, so a revisited chat
 * reads as its answers.
 *
 * Two things must not disappear:
 *   - a failed call keeps its row and its error text;
 *   - a turn that ends on tool work with no reply and no card
 *     keeps the last name as a settled line, so the turn is
 *     never invisible.
 * A card (balances, swap, deposit, withdrawal, unlock) is
 * already the record, so the line does not repeat it.
 * ───────────────────────────────────────────────────────── */

export type ActivityPhase =
  | { kind: "reasoning" }
  | { kind: "tool"; name: string; state: string; step: ToolStep };

export type ActivityBlock =
  | { kind: "activity"; phases: ActivityPhase[] }
  | { kind: "text"; text: string };

type ToolPhase = Extract<ActivityPhase, { kind: "tool" }>;

/* The proposals hand the turn to a card: once one has run, the card — not
 * the line — is the record of what happens next. Without this the line would
 * come back as "Preparing the swap" while the card is already processing. */
const APPROVAL_TOOLS = new Set([
  "prepare_swap",
  "prepare_deposit",
  "prepare_withdrawal",
]);

/* One glyph per kind of work, taken from Tabler's outline set on the 24px
 * grid the row draws at 13px. The label says which tool ran; the glyph says
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
  /* Tabler IconAt: a public name resolved to the account it points at. */
  name: (
    <g {...STROKE}>
      <path d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0v-1.5a9 9 0 1 0 -5.5 8.28" />
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
function ShimmerText({ children }: { children: ReactNode }) {
  return (
    <span
      className="truncate bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
        backgroundSize: "200% 100%",
        animation: "shimmer-text 1.4s linear infinite",
      }}
    >
      {children}
    </span>
  );
}

/** the settled chip label — ink-2, static, reads as a complete phrase */
function SettledLabel({ children }: { children: ReactNode }) {
  return <span className="truncate text-[13px] font-medium text-ink-2">{children}</span>;
}

/** One line for the phase in progress. Not a button: there is no trace to
 * open, and the reply will take its place in a moment. */
function StatusLine({
  icon,
  label,
  active,
}: {
  icon: string;
  label: string;
  active: boolean;
}) {
  return (
    <div
      role="status"
      className="-mx-1.5 flex w-fit max-w-full items-center gap-2 rounded-control px-1.5 py-1"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill={icon === "think" ? "currentColor" : "none"}
        stroke="currentColor"
        aria-hidden
        className={`shrink-0 ${active ? "text-ink-2" : "text-ink-3"}`}
      >
        {ICONS[icon] ?? ICONS.unknown}
      </svg>
      <span
        key={label}
        className="inline-flex min-w-0"
        style={{ animation: active ? "fade-in 200ms ease-out both" : undefined }}
      >
        {active ? <ShimmerText>{label}</ShimmerText> : <SettledLabel>{label}</SettledLabel>}
      </span>
    </div>
  );
}

/** the accordion body wrapper for a failed call's error text */
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

/** A failed call is the one row that survives the reply. It keeps the error
 * text expandable, so a source that did not answer cannot quietly vanish. */
function FailureRow({ phase }: { phase: ToolPhase }) {
  const [open, setOpen] = useState(false);
  const row = phase.step;
  const expandable = row.detail.length > 0;
  const label = row.liveLabel ?? row.label;

  return (
    <div style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}>
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={expandable ? () => setOpen((current) => !current) : undefined}
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
            className={`transition-opacity duration-100 ${expandable ? "group-hover/row:opacity-0" : ""} ${open ? "opacity-0" : ""}`}
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
              className={`absolute transition-[opacity,transform] duration-150 ${open ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}
              style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
            >
              <path d="M6 9l6 6l6 -6" />
            </svg>
          )}
        </span>
        <span className="shrink-0 text-[12.5px] font-medium text-ink">{label}</span>
        <span className="inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5 text-[11.5px] text-ink-2 shadow-hairline">
          failed
        </span>
      </button>

      {expandable && (
        <PillBody open={open}>
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
}

/** The name and glyph for a phase. Approvals are the card's job, so the line
 * steps aside the moment the decision is on screen; a failure is the row's
 * job, so the line does not shimmer over it. The active name is the tool's
 * own present-tense label; the settled fallback uses the row's past-tense
 * label, because it stays on screen after the work is done. */
function statusFor(
  phase: ActivityPhase,
  active: boolean,
): { icon: string; label: string } | null {
  if (phase.kind === "reasoning") {
    return {
      icon: "think",
      label: active ? "Thinking" : "Thought for a moment",
    };
  }
  if (
    phase.state === "approval-requested" ||
    phase.state === "approval-responded" ||
    phase.state === "output-denied" ||
    phase.state === "output-error" ||
    (phase.state === "output-available" && APPROVAL_TOOLS.has(phase.name))
  ) {
    return null;
  }
  return {
    icon: phase.step.icon,
    label: active
      ? (phase.step.liveLabel ?? phase.step.label)
      : (phase.step.doneLabel ?? phase.step.label),
  };
}

type ActivityContent = {
  failures: ToolPhase[];
  current: { icon: string; label: string } | null;
  settled: { icon: string; label: string } | null;
};

function activityContent(
  block: Extract<ActivityBlock, { kind: "activity" }>,
  live: boolean,
  showSettled: boolean,
): ActivityContent {
  const failures = block.phases.filter(
    (phase): phase is ToolPhase =>
      phase.kind === "tool" && phase.state === "output-error",
  );
  const last = block.phases[block.phases.length - 1];
  const current = live && last ? statusFor(last, true) : null;
  // A settled line is only a fallback: text or a card after this run means
  // the reply is already carrying the record.
  const settled =
    !live && showSettled && failures.length === 0 && last
      ? statusFor(last, false)
      : null;
  return { failures, current, settled };
}

function ActivityRun({
  block,
  live,
  showSettled,
}: {
  block: Extract<ActivityBlock, { kind: "activity" }>;
  live: boolean;
  showSettled: boolean;
}) {
  const { failures, current, settled } = activityContent(
    block,
    live,
    showSettled,
  );

  if (failures.length === 0 && !current && !settled) return null;

  return (
    <div className="flex w-full max-w-95 flex-col gap-1">
      {failures.map((phase, index) => (
        <FailureRow key={`${phase.name}-${index}`} phase={phase} />
      ))}
      {current ? <StatusLine icon={current.icon} label={current.label} active /> : null}
      {settled ? <StatusLine icon={settled.icon} label={settled.label} active={false} /> : null}
    </div>
  );
}

export default function ActivityStatus({
  blocks,
  running,
  showSettled = true,
}: {
  blocks: ActivityBlock[];
  running: boolean;
  /** False when text or a card follows this run: its line has done its job. */
  showSettled?: boolean;
}) {
  if (blocks.length === 0) return null;

  // A hidden activity line must not leave an empty flex child behind: the
  // timeline's gap would still open a space where the line used to be.
  const rendered = blocks.some((block, index) => {
    if (block.kind === "text") return true;
    const content = activityContent(
      block,
      running && index === blocks.length - 1,
      showSettled,
    );
    return (
      content.failures.length > 0 ||
      content.current !== null ||
      content.settled !== null
    );
  });
  if (!rendered) return null;

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

        return (
          <ActivityRun
            key={`activity-${index}`}
            block={block}
            live={running && index === blocks.length - 1}
            showSettled={showSettled}
          />
        );
      })}
    </div>
  );
}
