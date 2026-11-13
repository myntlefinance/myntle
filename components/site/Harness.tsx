"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { UIMessage } from "ai";
import {
  IconChartBar,
  IconChecklist,
  IconCode,
  IconCoins,
  IconDatabase,
  IconGavel,
  IconPencil,
  IconRefresh,
  IconRepeat,
  IconRoute,
  IconSettings,
  IconTicket,
  IconWallet,
} from "@tabler/icons-react";
import { LiveResponse } from "@/components/app/LiveResponse";
import { unlockResolvedAfter } from "@/lib/ai/messages/continuation";
import type {
  ApprovalDecisionContext,
  ApprovalDecisions,
  SettlementSnapshot,
} from "@/components/app/approvals";
import { ConnectGate } from "@/components/app/ConnectGate";
import { UserBubble, AgentMessageActions } from "@/components/app/MessageActions";
import { ThreadSkeleton } from "@/components/app/ThreadSkeleton";
import {
  TimestampPill,
  computeMessageClusters,
  getMessageTimestamp,
  shouldShowTimestampPill,
} from "@/components/app/TimestampPill";
import dynamic from "next/dynamic";
import ApprovalCard from "@/components/primitives/ApprovalCard";
// Demo-only primitives load in a separate chunk so the live chat bundle
// never downloads them. They render only when `live == null`.
const AgentScreen = dynamic(
  () => import("@/components/primitives/AgentScreen"),
  { ssr: false, loading: () => null },
);
const ContextCards = dynamic(
  () => import("@/components/primitives/ContextCards"),
  { ssr: false, loading: () => null },
);
const DiffTable = dynamic(
  () => import("@/components/primitives/DiffTable"),
  { ssr: false, loading: () => null },
);
const InsightCards = dynamic(
  () => import("@/components/primitives/InsightCards"),
  { ssr: false, loading: () => null },
);
const RecordsTable = dynamic(
  () => import("@/components/primitives/RecordsTable"),
  { ssr: false, loading: () => null },
);
const SelectionActions = dynamic(
  () => import("@/components/primitives/SelectionActions"),
  { ssr: false, loading: () => null },
);
import LoadingState from "@/components/primitives/LoadingState";
import PromptBar from "@/components/primitives/PromptBar";
import RecommendationCard from "@/components/primitives/RecommendationCard";
import SidebarNav from "@/components/primitives/SidebarNav";
import StreamingText from "@/components/primitives/StreamingText";
import TaskRows, { SpinnerRing } from "@/components/primitives/TaskRows";
import ThinkingState from "@/components/primitives/ThinkingState";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";
import ToolChips from "@/components/primitives/ToolChips";
import { focusComposer, FOCUS_COMPOSER_EVENT } from "@/lib/composer";
// UseThisHarness (the "fork this" modal pointing at the upstream repo) has been
// removed. The footer button now opens the wallet picker instead.

/* ─────────────────────────────────────────────────────────
 * MYNTLE HARNESS
 * An interactive chat window that shows every Myntle
 * primitive in its natural habitat. Ask a question (or tap a
 * suggestion) and the agent replies — thinking, then building
 * the answer out of live components. Everything is fake data.
 * ───────────────────────────────────────────────────────── */

const NAME = "Shane";

/* ── shared bits ──────────────────────────────────────────── */

/* the charts land only after the streamed text has finished */
function WorkloadAnswer() {
  const [showCards, setShowCards] = useState(false);

  return (
    <>
      <div className="max-w-[630px]">
        <StreamingText fill loop={false} onDone={() => setShowCards(true)} />
      </div>
      {showCards && (
        <div className="mt-5" style={{ animation: "fade-up 450ms cubic-bezier(0.23,1,0.32,1) both" }}>
          <InsightCards />
        </div>
      )}
    </>
  );
}

/* a lightweight word-by-word reveal, reusing the streaming keyframe */
function StreamLine({
  text,
  tone = "ink",
  onDone,
}: {
  text: string;
  tone?: "ink" | "ink-2";
  onDone?: () => void;
}) {
  const words = text.split(" ");
  const [n, setN] = useState(0);
  const streaming = n < words.length;
  useEffect(() => {
    if (!streaming) return;
    const t = setTimeout(() => setN((c) => c + 1), 34);
    return () => clearTimeout(t);
  }, [n, streaming]);
  useEffect(() => {
    if (!streaming) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);
  return (
    <p className={`max-w-[620px] text-[13.5px] leading-[1.65] ${tone === "ink" ? "text-ink" : "text-ink-2"}`}>
      {words.slice(0, n).map((word, i) => (
        <span key={i} className="inline">
          {word}{" "}
        </span>
      ))}
      {streaming && <span className="stream-caret is-streaming" />}
    </p>
  );
}

/* a consistent reply: the intro streams in, then the artifact reveals below it
 * once the text settles — so nothing pops in before the sentence lands. */
function Reply({ intro, children }: { intro: string; children?: ReactNode }) {
  const [ready, setReady] = useState(false);
  return (
    <>
      <StreamLine text={intro} tone="ink-2" onDone={() => setReady(true)} />
      {ready && children != null && (
        <div className="mt-5" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
          {children}
        </div>
      )}
    </>
  );
}

/* the offboarding flow: answer the questions, the card collapses to a small
 * badge, then the agent thinks again and streams a short confirmation. */
function OffboardingAnswer() {
  const [stage, setStage] = useState<"form" | "thinking" | "done">("form");

  useEffect(() => {
    if (stage !== "thinking") return;
    const t = setTimeout(() => setStage("done"), 1100);
    return () => clearTimeout(t);
  }, [stage]);

  return (
    <>
      <Reply intro="Before I archive the vendor, confirm a few details. Single questions advance on their own; multi-selects wait for the arrow.">
        <ApprovalCard resettable={false} onSubmitted={() => setStage("thinking")} />
      </Reply>
      {stage === "thinking" && (
        <div className="mt-4 flex min-h-6 items-center" style={{ animation: "fade-in 200ms ease-out both" }}>
          <LoadingState label="Archiving vendor" variant="Dots" />
        </div>
      )}
      {stage === "done" && (
        <div className="mt-4" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
          <StreamLine text="Done — I archived Fjord Bank, moved its 3 open orders to Northwind Finance, and flagged the cold-chain certificate for renewal. Nothing else in the workflow references the vendor." />
        </div>
      )}
    </>
  );
}

/* the answer streams only after the search trace settles */
function FindTicketAnswer() {
  const [settled, setSettled] = useState(false);
  return (
    <>
      <ThinkingState variant="Search" onSettled={() => setSettled(true)} />
      {settled && (
        <div className="mt-1" style={{ animation: "fade-in 200ms ease-out both" }}>
          <StreamLine tone="ink-2" text="Found it — the flavor page redesign ticket, plus the two docs it references. The retrieved chunks are in the side panel." />
        </div>
      )}
    </>
  );
}

/* the side-panel agent viewer: connects, then goes live once the browser opens */
function BrowserPane() {
  const [variant, setVariant] = useState<"Loading" | "Working">("Loading");
  useEffect(() => {
    const t = setTimeout(() => setVariant("Working"), 2400);
    return () => clearTimeout(t);
  }, []);
  return <AgentScreen agentName="Browser agent" variant={variant} />;
}

/* the browser flow: spin up a browser, show the plan as a thinking trace, then
 * stream a confirmation once the (fake) appeal is filed */
function ParkingAppealAnswer() {
  const [stage, setStage] = useState<"boot" | "think" | "working" | "done">("boot");

  useEffect(() => {
    if (stage !== "working") return;
    const t = setTimeout(() => setStage("done"), 1800);
    return () => clearTimeout(t);
  }, [stage]);

  return (
    <>
      <StreamLine
        tone="ink-2"
        text="Spinning up a browser — you can watch it work in the panel on the right, or click in to take a look."
        onDone={() => setStage((s) => (s === "boot" ? "think" : s))}
      />
      {stage !== "boot" && (
        <div className="mt-4" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
          <ThinkingState
            variant="Steps"
            active="Working the appeal"
            done="Filed the appeal"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
              </svg>
            }
            rows={[
              { primary: "Opening the city parking portal" },
              { primary: "Locating citation #A4471902" },
              { primary: "Filling out the appeal form" },
              { primary: "Attaching evidence", secondary: "2 photos · permit" },
            ]}
            onSettled={() => setStage((s) => (s === "think" ? "working" : s))}
          />
        </div>
      )}
      {stage === "working" && (
        <div className="mt-4 flex min-h-6 items-center" style={{ animation: "fade-in 200ms ease-out both" }}>
          <LoadingState label="Submitting the appeal" variant="Dots" />
        </div>
      )}
      {stage === "done" && (
        <div className="mt-4" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
          <StreamLine text="Done — the appeal for citation #A4471902 is submitted. The city portal returned confirmation PA-6621 and it's now under review; you'll hear back within 14 days. I attached the two curb-sign photos and your resident permit as evidence." />
        </div>
      )}
    </>
  );
}

/* ── scenarios ────────────────────────────────────────────────
 * Each maps a user prompt to an agent reply built from primitives.
 * `beat` is how long the agent "thinks" before the answer resolves
 * — shorter when the answer leads with its own live trace.
 */

type Scenario = {
  prompt: string;
  beat: number;
  Answer: () => ReactNode;
  /** optional one-off waiting treatment for a scenario */
  loadingVariant?: "Surfer";
  /** render the answer across the full chat window instead of the reading column */
  fullBleed?: boolean;
  /** optional artifact for the right-hand pane */
  paneTitle?: string;
  Pane?: () => ReactNode;
  /** spreadsheet workspace: the main pane is a live table, the chat docks to the right */
  Workspace?: () => ReactNode;
  workspaceTitle?: string;
};

const SCENARIOS: Record<string, Scenario> = {
  appeal: {
    prompt: "Appeal my parking ticket — citation #A4471902.",
    beat: 500,
    paneTitle: "Agent",
    Pane: () => <BrowserPane />,
    Answer: () => <ParkingAppealAnswer />,
  },
  todos: {
    prompt: "What urgent to-dos need my attention this morning?",
    beat: 1100,
    paneTitle: "Tasks",
    Pane: () => (
      <>
        <TaskRows variant="List" />
        <div className="mt-6">
          <ContextCards />
        </div>
      </>
    ),
    Answer: () => (
      <Reply intro="Three things are time-sensitive. I put the checklist in the side panel, ordered by how soon they’ll bite — and there’s one call worth making first.">
        <RecommendationCard />
      </Reply>
    ),
  },
  workload: {
    prompt: "Prep a summary of my workload.",
    beat: 900,
    Answer: () => <WorkloadAnswer />,
  },
  offboarding: {
    prompt: "I need your approval before I off-board a supplier.",
    beat: 850,
    Answer: () => <OffboardingAnswer />,
  },
  "find-ticket": {
    prompt: "There was a ticket about redesigning the flavor page — can you find it?",
    beat: 500,
    paneTitle: "Context",
    Pane: () => <ContextCards />,
    Answer: () => <FindTicketAnswer />,
  },
  suppliers: {
    prompt: "Show me our supplier records.",
    beat: 700,
    workspaceTitle: "Suppliers",
    Workspace: () => <RecordsTable fill />,
    Answer: () => (
      <StreamLine tone="ink-2" text="The grid’s on the left. Ask me to filter, enrich, or add a column — I’ll update the table live and show my work here." />
    ),
  },
  restock: {
    prompt: "Draft the batch restock function.",
    beat: 500,
    Answer: () => (
      <Reply intro="I planned it out and staged the edits. Hover a file chip to preview its diff — nothing runs until you say so.">
        <ToolChips />
      </Reply>
    ),
  },
  edits: {
    prompt: "Propose edits to the flavor list.",
    beat: 1000,
    Answer: () => (
      <Reply intro="I staged the changes as a reviewable draft — nothing is applied yet. Sweep through and approve what looks right.">
        <DiffTable />
      </Reply>
    ),
  },
  rewrite: {
    prompt: "Help me tighten this launch note.",
    beat: 700,
    Answer: () => (
      <Reply intro="Select any passage and hand it to me. I highlighted a line below — pick an action or describe the edit.">
        <SelectionActions />
      </Reply>
    ),
  },
  surfer: {
    prompt: "Can you audit the launch plan—and put Subway Surfers underneath so my attention span stays on payroll?",
    beat: 18000,
    loadingVariant: "Surfer",
    Answer: () => <Reply intro="All done. Thanks for locking in with me." />,
  },
};

type ScenarioId = keyof typeof SCENARIOS;

const KEYWORDS: [ScenarioId, string[]][] = [
  ["appeal", ["appeal", "parking", "citation", "contest", "dispute", "fine", "browser"]],
  ["todos", ["todo", "to-do", "urgent", "morning", "attention", "task"]],
  ["workload", ["summary", "summarize", "workload", "overview", "recap", "digest"]],
  ["offboarding", ["approve", "approval", "off-board", "offboard", "confirm", "sign off"]],
  ["find-ticket", ["find", "search", "ticket", "where", "look up", "locate"]],
  ["suppliers", ["supplier", "records", "vendor", "table", "maker", "grid"]],
  ["restock", ["restock", "code", "function", "batch", "script", "reorder"]],
  ["edits", ["edit", "diff", "change", "propose", "update the", "flavor list"]],
  ["rewrite", ["rewrite", "tighten", "reword", "shorten", "note", "copy"]],
];

function matchScenario(text: string): ScenarioId {
  const lower = text.toLowerCase();
  for (const [id, words] of KEYWORDS) {
    if (words.some((word) => lower.includes(word))) return id;
  }
  return "workload";
}

/* ── suggestion + recents catalogs ────────────────────────── */

function SuggestionIcon({ kind }: { kind: string }) {
  const props = { size: 15, stroke: 1.9 } as const;
  switch (kind) {
    case "todos":
      return <IconChecklist {...props} />;
    case "workload":
      return <IconChartBar {...props} />;
    case "find-ticket":
      return <IconTicket {...props} />;
    case "suppliers":
      return <IconDatabase {...props} />;
    case "restock":
      return <IconCode {...props} />;
    case "rewrite":
    case "edits":
      return <IconPencil {...props} />;
    case "tune":
      return <IconSettings {...props} />;
    case "appeal":
      return <IconGavel {...props} />;
    case "quote":
      return <IconCoins {...props} />;
    case "swap":
      return <IconRepeat {...props} />;
    case "balances":
      return <IconWallet {...props} />;
    case "portfolio":
      return <IconWallet {...props} />;
    case "routes":
      return <IconRoute {...props} />;
    default:
      return <IconChartBar {...props} />;
  }
}

const LIVE_SUGGESTIONS: { id: string; label: string }[] = [
  { id: "quote", label: "What would 100 USDC buy in NEAR?" },
  { id: "swap", label: "Swap 100 USDC for NEAR" },
  { id: "balances", label: "What do I hold?" },
  { id: "portfolio", label: "Show my portfolio balances" },
  { id: "routes", label: "What can I trade from here?" },
];

const SUGGESTION_POOL: { id: ScenarioId; label: string }[] = [
  { id: "appeal", label: "Appeal my parking ticket" },
  { id: "suppliers", label: "Show me our supplier records" },
  { id: "todos", label: "What urgent to-dos need my attention this morning?" },
  { id: "workload", label: "Prep a summary of my workload" },
  { id: "find-ticket", label: "Find the ticket about the flavor page redesign" },
  { id: "restock", label: "Draft the batch restock function" },
  { id: "rewrite", label: "Tighten this launch note" },
];

const RECENTS: { id: ScenarioId; label: string; prompt?: string }[] = [
  { id: "appeal", label: "Parking ticket appeal", prompt: SCENARIOS.appeal.prompt },
  { id: "suppliers", label: "Supplier records" },
  { id: "todos", label: "Urgent to-dos this morning" },
  { id: "find-ticket", label: "Flavor page ticket" },
  { id: "workload", label: "Workload summary" },
  { id: "offboarding", label: "Off-board a supplier" },
  { id: "restock", label: "Batch restock function" },
  { id: "edits", label: "Propose flavor edits" },
  { id: "surfer", label: "Subway surfing", prompt: SCENARIOS.surfer.prompt },
];

/* ── the agent reply — thinks, then builds the answer ─────── */

function AssistantResponse({ scenarioId, className = "" }: { scenarioId: ScenarioId; className?: string }) {
  const scenario = SCENARIOS[scenarioId];
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnswered(true), scenario.beat);
    return () => clearTimeout(t);
  }, [scenario.beat]);

  return (
    <article className={`min-w-0 ${className}`} style={{ animation: "fade-up 450ms cubic-bezier(0.23,1,0.32,1) both" }}>
      {answered ? (
        <div style={{ animation: "fade-in 260ms ease both" }}>
          {scenario.Answer()}
          <div className="mt-3">
            <AgentMessageActions
              text={scenario.prompt || "Response"}
              onRegenerate={() => {
                setAnswered(false);
                const t = setTimeout(() => setAnswered(true), scenario.beat);
                return () => clearTimeout(t);
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex min-h-6 items-center" style={{ animation: "fade-in 200ms ease-out both" }}>
          {scenario.loadingVariant === "Surfer" ? (
            <LoadingState variant="Surfer" />
          ) : (
            <LoadingState label="Thinking" variant="Dots" />
          )}
        </div>
      )}
    </article>
  );
}

/* ── empty state ──────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────
 * HOME ENTRANCE STORYBOARD
 *
 * Read top-to-bottom. Each value is ms after mount.
 *
 *  170ms   “Hello Shane” rises 23px, blur 17px → 0
 *  330ms   question follows with the same reveal
 *  400ms   prompt bar resolves into place
 *  550ms   recommendations finish the sequence
 * ───────────────────────────────────────────────────────── */

const HOME_REVEAL_TIMING = {
  hello:           170, // greeting enters first
  question:        330, // question follows closely
  prompt:          400, // composer lands after the copy
  recommendations: 550, // secondary actions finish the scene
};

const HOME_REVEAL = {
  offsetY:  23, // px traveled upward
  blur:     17, // px of initial blur
  duration: 800, // ms for each element to settle
  easing:   "cubic-bezier(0.16, 1, 0.3, 1)",
};

/* Static entrance params. These were previously tunable via DialKit; DialKit
 * (a dev-only tuning overlay) has been removed, so we use the tuned defaults. */
const revealParams = {
  reveal: {
    blur: HOME_REVEAL.blur,
    offsetY: HOME_REVEAL.offsetY,
    duration: HOME_REVEAL.duration,
  },
  sequence: {
    helloAt: HOME_REVEAL_TIMING.hello,
    questionAt: HOME_REVEAL_TIMING.question,
    promptAt: HOME_REVEAL_TIMING.prompt,
    recommendationsAt: HOME_REVEAL_TIMING.recommendations,
  },
};

// Played once per page load. Remounts later (switching chats, new chat)
// render the final state immediately instead of replaying the blur-fade.
let homeRevealPlayed = false;

function homeRevealStyle(
  visible: boolean,
  reveal: { blur: number; offsetY: number; duration: number },
): CSSProperties {
  return {
    opacity: visible ? 1 : 0,
    transform: visible ? "translate3d(0, 0, 0)" : `translate3d(0, ${reveal.offsetY}px, 0)`,
    filter: visible ? "blur(0px)" : `blur(${reveal.blur}px)`,
    transition: ["opacity", "transform", "filter"]
      .map((property) => `${property} ${reveal.duration}ms ${HOME_REVEAL.easing}`)
      .join(", "),
  };
}


function EmptyState({ onSend, shuffle, offset, live }: { onSend: (text: string, id: ScenarioId) => void; shuffle: () => void; offset: number; live?: LiveChat }) {
  const pool = live ? LIVE_SUGGESTIONS : SUGGESTION_POOL;
  const shown = [0, 1, 2].map((i) => pool[(offset + i) % pool.length]);
  /* The live composer is the primary action, not a scene to reveal. It is
   * present on the first frame; the staged blur-fade stays on the demo. */
  const [stage, setStage] = useState(live || homeRevealPlayed ? 4 : 0);
  useEffect(() => {
    const skipReveal = () => setStage(4);
    window.addEventListener(FOCUS_COMPOSER_EVENT, skipReveal);
    return () => window.removeEventListener(FOCUS_COMPOSER_EVENT, skipReveal);
  }, []);

  useEffect(() => {
    if (live) return;
    if (homeRevealPlayed) {
      setStage(4);
      return;
    }
    homeRevealPlayed = true;
    const timers = [
      setTimeout(() => setStage(1), revealParams.sequence.helloAt),
      setTimeout(() => setStage(2), revealParams.sequence.questionAt),
      setTimeout(() => setStage(3), revealParams.sequence.promptAt),
      setTimeout(() => setStage(4), revealParams.sequence.recommendationsAt),
    ];

    return () => {
      timers.forEach(clearTimeout);
      setStage(4);
    };
  }, [live]);

  return (
    <div className="mx-auto flex min-h-full w-full flex-col justify-center px-4 py-10 sm:px-8 lg:px-12">
      <div className="mx-auto w-full max-w-[720px]">
        <h1 className="text-[26px] font-normal tracking-[-0.02em] text-ink">
          <span className="home-reveal block text-ink-3" style={homeRevealStyle(stage >= 1, revealParams.reveal)}>{live ? "Your money, in plain language" : `Hello ${NAME}`}</span>
          <span className="home-reveal block" style={homeRevealStyle(stage >= 2, revealParams.reveal)}>{live ? "Ask for a trade and watch it settle." : "What can I help you with?"}</span>
        </h1>

        <div className="home-reveal relative mt-7" style={homeRevealStyle(stage >= 3, revealParams.reveal)}>
          <div className="relative">
            <PromptBar
              demo={false}
              tall
              autoFocus={true}
              placeholder={live ? "Ask for a trade, or ask what you hold" : "Ask anything about your finance ops..."}
              onSend={(text) => {
                if (live) live.send(text);
                else onSend(text, matchScenario(text));
                focusComposer();
              }}
            />
          </div>
        </div>

        <div className="home-reveal mt-6 flex flex-col" style={homeRevealStyle(stage >= 4, revealParams.reveal)}>
          {shown.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (live) live.send(item.label);
                else onSend(item.label, item.id as ScenarioId);
                focusComposer();
              }}
              className="-mx-2 flex items-center gap-3 rounded-control px-2 py-2.5 text-left text-[14px] text-ink transition-colors duration-150 hover:bg-hover"
            >
              <span className="text-ink-3">
                {item.id === "offboarding" ? (
                  <span className="block size-3.5 rounded-full bg-gradient-to-br from-orange to-red" />
                ) : (
                  <SuggestionIcon kind={item.id} />
                )}
              </span>
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
          ))}
          <div className="mt-1 flex items-center gap-5 pl-0.5 text-[13px] text-ink-3">
            <button type="button" onClick={shuffle} className="flex items-center gap-2 py-1 transition-colors duration-150 hover:text-ink">
              <IconRefresh size={14} stroke={2} aria-hidden />
              Shuffle suggestions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── main ─────────────────────────────────────────────────── */

type Msg =
  | { id: number; role: "user"; text: string; timestamp?: number }
  | { id: number; role: "assistant"; scenarioId: ScenarioId; timestamp?: number };

/* the pane arrives on the same beat as the answer it belongs to */
/* The pane shell reserves its space as soon as the message is sent, so the
 * column never reflows mid-thought. Only the body swaps — a quiet loader while
 * the agent works, then the artifact fades up in place. */
function PaneBody({ beat, children }: { beat: number; children: ReactNode }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), beat);
    return () => clearTimeout(t);
  }, [beat]);

  if (!show) {
    return (
      <div className="flex h-full items-center justify-center pb-10">
        <LoadingState label="Gathering" variant="Dots" />
      </div>
    );
  }

  return <div style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>{children}</div>;
}

/* ── spreadsheet views + property inspector ───────────────────
 * The bottom bar lists views; selecting one swaps the right pane
 * from the assistant chat to a Property configuration inspector.
 */
const SPREADSHEET_VIEWS = [
  { name: "Main", color: "var(--ink-3)", count: 60 },
  { name: "Gelato", color: "oklch(0.627 0.23 296.668)", count: 17 },
  { name: "Wholesale", color: "oklch(0.611 0.21 263.944)", count: 12 },
  { name: "Dairy-free", color: "oklch(0.671 0.118 219.351)", count: 9 },
];

function ConfigSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="relative h-4.5 w-7.5 shrink-0 rounded-full transition-colors duration-150"
      style={{ background: on ? "var(--accent)" : "var(--line-strong)" }}
    >
      <span
        className="absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow-btn transition-transform duration-150"
        style={{ transform: on ? "translateX(12px)" : "translateX(0)", transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
      />
    </button>
  );
}

function PropertyConfig({ view, onClose }: { view: string; onClose: () => void }) {
  const [grounding, setGrounding] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ animation: "fade-in 160ms ease-out both" }}>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3 sm:pl-4">
        <span className="text-[13px] font-semibold text-ink">Property configuration</span>
        <div className="flex items-center gap-0.5 text-ink-3">
          <button type="button" aria-label="Previous" className="flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 hover:bg-hover hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <button type="button" aria-label="Next" className="flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 hover:bg-hover hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <button
            type="button"
            aria-label="Back to chat"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim p-4">
        <div className="text-[14px] font-semibold text-ink">{view} suppliers</div>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-ink-3">Type</span>
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 6h16M4 12h10M4 18h7" /></svg>
              View filter
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-ink-3">Model</span>
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)" aria-hidden><path d="M12 3l1.7 5.1a2 2 0 0 0 1.2 1.2L20 11l-5.1 1.7a2 2 0 0 0-1.2 1.2L12 19l-1.7-5.1a2 2 0 0 0-1.2-1.2L4 11l5.1-1.7a2 2 0 0 0 1.2-1.2z" /></svg>
              Sprinkles 5
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-ink-3">Grounding</span>
            <ConfigSwitch on={grounding} onToggle={() => setGrounding((v) => !v)} />
          </div>
        </div>

        <div className="mt-4 rounded-[10px] bg-inset p-3 text-[13px] leading-relaxed text-ink-2 shadow-hairline">
          Only surface <span className="rounded-[5px] bg-accent-tint px-1.5 py-0.5 text-[12px] font-medium text-accent-ink">{view}</span> suppliers with a strong, recent connection — nothing else.
        </div>

        <button
          type="button"
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-[9px] text-[12.5px] font-medium text-ink shadow-btn transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.98]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
          Recompute stale fields
        </button>

        <div className="mt-6 flex flex-col gap-1">
          {[
            { label: "Use webhooks to integrate with other tools", icon: <path d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z" /> },
            { label: "Configure a Zapier integration", icon: <path d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z" /> },
          ].map((row) => (
            <button
              key={row.label}
              type="button"
              className="-mx-1.5 flex items-center gap-2.5 rounded-[8px] px-1.5 py-2 text-left text-[13px] text-ink transition-colors duration-100 hover:bg-hover"
            >
              <span className="text-accent"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>{row.icon}</svg></span>
              {row.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-[9px] bg-red-tint text-[12.5px] font-medium text-red transition-[filter,transform] duration-150 hover:brightness-95 active:scale-[0.98]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>
          Delete property
        </button>
      </div>
    </div>
  );
}

/** The real conversation, when the harness is driven by a live assistant. */
export type LiveChat = {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  send: (text: string) => void;
  error?: string;
  regenerate?: (messageId?: string) => void;
  editAndSend?: (messageId: string, nextText: string) => void;
  respondToApproval?: (
    approvalId: string,
    approved: boolean,
    context: ApprovalDecisionContext,
  ) => void | Promise<void | "approved" | "denied">;
  /** The chat these cards belong to, so a record can be linked to it. */
  conversationId?: string | null;
  /** Decisions on record; null while the read is in flight. */
  decisions?: ApprovalDecisions | null;
  /** Database settlements by tool approval id, for instant card states. */
  settlements?: Record<string, SettlementSnapshot>;
  /** Cards whose record has never been read; their footer is a skeleton. */
  pendingApprovalIds?: ReadonlySet<string>;
  /**
   * Called once when a money card scrolls into view, so the host can read
   * only the record the reader actually reached.
   */
  onApprovalVisible?: (approvalId: string) => boolean | void;
};

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function Harness({
  live,
  gated,
  title,
  onNewChat,
  onRename,
  threads,
  onPickThread,
  activeChatId,
  onHoverThread,
  onRenameThread,
  onDeleteThread,
  trashCount,
  trashActive,
  onOpenTrash,
  portfolioActive,
  onOpenPortfolio,
  historyActive,
  onOpenHistory,
  loadingThread,
  footer,
  footerCompact,
  onLoadOlder,
  hasMoreOlder,
  loadingOlder,
}: {
  live?: LiveChat;
  /** visitor prompts held at the gate, each answered by the connect reply */
  gated?: { id: number; prompt: string }[];
  /** the live thread title; null until the first prompt names it */
  title?: string | null;
  /** starts a fresh live thread */
  onNewChat?: () => void;
  /** renames the live thread */
  onRename?: (next: string) => void;
  /** all live threads for the sidebar; falls back to current title alone.
   * NULL labels are untitled and render as "New chat"; a stored "New chat"
   * string is a manual rename and renders as-is (identical text). */
  threads?: Array<{ id: string; label: string | null }>;
  /** navigate to a live thread */
  onPickThread?: (id: string) => void;
  /** unique id of the open live thread; highlight matches by this, not title */
  activeChatId?: string | null;
  /** hover intent on a live thread, for prefetching its history into cache */
  onHoverThread?: (id: string) => void;
  /** renames a saved live thread from its sidebar row */
  onRenameThread?: (id: string, next: string) => void;
  /** moves a saved live thread to trash from its sidebar row */
  onDeleteThread?: (id: string) => void;
  /** number of chats sitting in trash; shows the sidebar shortcut */
  trashCount?: number;
  /** the Trash page is open; highlights the sidebar shortcut */
  trashActive?: boolean;
  /** opens the Trash page */
  onOpenTrash?: () => void;
  /** the Portfolio page is open; highlights the sidebar row */
  portfolioActive?: boolean;
  /** opens the Portfolio page */
  onOpenPortfolio?: () => void;
  /** the History page is open; highlights the sidebar row */
  historyActive?: boolean;
  /** opens the History page */
  onOpenHistory?: () => void;
  /** a saved thread is loading its history; show a skeleton in place of messages */
  loadingThread?: boolean;
  /** replaces the sidebar's footer button */
  footer?: ReactNode;
  /** the icon-only footer control the collapsed sidebar keeps */
  footerCompact?: ReactNode;
  /** triggers loading older history when scrolling to the top */
  onLoadOlder?: () => void;
  /** whether there are more older messages to load */
  hasMoreOlder?: boolean;
  /** whether an older batch is currently loading */
  loadingOlder?: boolean;
} = {}) {
  /* the demo thread is a single conversation — one title, one transcript,
   * no tabs. The live thread is the same shape: `live.messages` plus the
   * title the application owns. */
  const [demoMessages, setDemoMessages] = useState<Msg[]>([]);
  const [demoTitle, setDemoTitle] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  /* spreadsheet: which view/property is open in the right inspector (null = chat) */
  const [propView, setPropView] = useState<string | null>(null);
  /* "use this harness" open-source modal */
  const [useOpen, setUseOpen] = useState(false); // retained so the modal removal is a no-op
  const msgIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerH, setComposerH] = useState(150);
  const [activeSpacer, setActiveSpacer] = useState(0);
  const initialSpacerRef = useRef(0);
  const messageTimestampsRef = useRef<Map<string, number>>(new Map());

  const resolveTimestamp = (msg: {
    id: string | number;
    metadata?: unknown;
    createdAt?: unknown;
    timestamp?: unknown;
  }) => {
    const key = String(msg.id);
    const existing = messageTimestampsRef.current.get(key);
    const resolved = getMessageTimestamp(msg, existing ?? Date.now());
    messageTimestampsRef.current.set(key, resolved);
    return resolved;
  };

  const liveClustered = useMemo(
    () => (live?.messages ? computeMessageClusters(live.messages, resolveTimestamp) : []),
    [live?.messages],
  );
  const demoClustered = useMemo(
    () => computeMessageClusters(demoMessages, resolveTimestamp),
    [demoMessages],
  );

  const displayTitle = live ? title : demoTitle;
  // In live mode the conversation lives in `live.messages`, so the thread is
  // "active" whenever the assistant has something to show — including a
  // gated turn.
  const gatedCount = live ? (gated?.length ?? 0) : 0;
  const active = live
    ? (live.messages?.length ?? 0) + gatedCount > 0
    : demoMessages.length > 0;

  /* right-hand pane: the latest assistant message that carries one */
  const [closedPaneId, setClosedPaneId] = useState(0);
  const lastPaneMsg = [...demoMessages]
    .reverse()
    .find(
      (m): m is Extract<Msg, { role: "assistant" }> =>
        m.role === "assistant" && !!SCENARIOS[m.scenarioId].Pane,
    );
  const paneMsg = lastPaneMsg && lastPaneMsg.id !== closedPaneId ? lastPaneMsg : null;
  const paneScenario = paneMsg ? SCENARIOS[paneMsg.scenarioId] : null;

  /* spreadsheet workspace: table becomes the main pane, chat docks to the right */
  const workspaceMsg = [...demoMessages]
    .reverse()
    .find(
      (m): m is Extract<Msg, { role: "assistant" }> =>
        m.role === "assistant" && !!SCENARIOS[m.scenarioId].Workspace,
    );
  const workspaceScenario = workspaceMsg ? SCENARIOS[workspaceMsg.scenarioId] : null;

  const send = (text: string, scenarioId: ScenarioId) => {
    setDemoTitle((current) => current ?? (text.length > 30 ? `${text.slice(0, 30).trimEnd()}…` : text));
    const now = Date.now();
    setDemoMessages((current) => [
      ...current,
      { id: (msgIdRef.current += 1), role: "user", text, timestamp: now },
      { id: (msgIdRef.current += 1), role: "assistant", scenarioId, timestamp: now },
    ]);
  };

  /* recents open as a fresh single thread with that prompt */
  const pickRecent = (scenarioId: ScenarioId, label: string, prompt = label) => {
    setDemoTitle(label);
    setPropView(null);
    const now = Date.now();
    setDemoMessages([
      { id: (msgIdRef.current += 1), role: "user", text: prompt, timestamp: now },
      { id: (msgIdRef.current += 1), role: "assistant", scenarioId, timestamp: now },
    ]);
  };

  const newDemoChat = () => {
    messageTimestampsRef.current.clear();
    setDemoMessages([]);
    setDemoTitle(null);
    setPropView(null);
    initialSpacerRef.current = 0;
    setActiveSpacer(0);
    focusComposer({ clearDraft: true });
  };

  const stickRef = useRef(true);
  const prevActiveChatIdRef = useRef<string | null | undefined>(undefined);
  const prevFirstMsgIdRef = useRef<string | number | null>(null);
  const prevMessagesCountRef = useRef(0);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const isPrependingRef = useRef(false);

  const firstMessage = live ? live.messages?.[0] : demoMessages[0];
  const firstMsgId = firstMessage ? String(firstMessage.id) : null;
  const messagesCount = live ? (live.messages?.length ?? 0) : demoMessages.length;
  const lastMessage = live
    ? live.messages?.[live.messages.length - 1]
    : demoMessages[demoMessages.length - 1];
  const lastMessageRole = lastMessage?.role;
  const liveStatus = live?.status;

  /* Stable identity for the thread container. The server id arrives after
   * the first turn (null → slug for the same messages), which must not
   * remount the list — the key below would replay its fade and wipe local
   * message state mid-stream. So the key only adopts a new id on a real
   * switch (different messages), never on first-save or older-page
   * prepends, which keep the current key. Adjusted during render so the
   * commit already carries the right key; no flash frame. */
  const [threadKey, setThreadKey] = useState<string>(activeChatId ?? "thread");
  const prevIdForKey = prevActiveChatIdRef.current;
  const prevFirstForKey = prevFirstMsgIdRef.current;
  let desiredKey = activeChatId ?? "thread";
  if (activeChatId === prevIdForKey) {
    desiredKey = threadKey;
  } else if (
    activeChatId != null &&
    prevIdForKey == null &&
    prevFirstForKey === firstMsgId &&
    firstMsgId != null
  ) {
    desiredKey = threadKey;
  }
  if (desiredKey !== threadKey) setThreadKey(desiredKey);

  const scrollToBottom = useCallback((smooth = true) => {
    stickRef.current = true;
    const el = scrollRef.current;
    if (!el) return;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    requestAnimationFrame(() => {
      if (scrollRef.current && stickRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (!el) return;

    /* A real switch is a different conversation, not the same one learning
     * its server id (null → slug with identical messages) and not the first
     * time the thread becomes active (EmptyState → thread on send, where the
     * spacer the send just set must survive). */
    const prevId = prevActiveChatIdRef.current;
    const prevFirst = prevFirstMsgIdRef.current;
    const isFirstSave =
      activeChatId != null &&
      prevId == null &&
      prevFirst === firstMsgId &&
      firstMsgId != null;
    const isBecomingActive = prevId === undefined;
    const isChatSwitch =
      prevId !== activeChatId && !isFirstSave && !isBecomingActive;

    if (isChatSwitch) {
      initialSpacerRef.current = 0;
      setActiveSpacer(0);
      prevActiveChatIdRef.current = activeChatId;
      prevFirstMsgIdRef.current = firstMsgId;
      prevMessagesCountRef.current = messagesCount;
      stickRef.current = true;
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        prevScrollHeightRef.current = scrollRef.current.scrollHeight;
        prevScrollTopRef.current = scrollRef.current.scrollTop;
      });
      return;
    }

    if (isPrependingRef.current) {
      const heightDiff = el.scrollHeight - prevScrollHeightRef.current;
      if (heightDiff > 0) {
        el.scrollTop = prevScrollTopRef.current + heightDiff;
      }
      isPrependingRef.current = false;
      prevFirstMsgIdRef.current = firstMsgId;
      prevMessagesCountRef.current = messagesCount;
      prevScrollHeightRef.current = el.scrollHeight;
      prevScrollTopRef.current = el.scrollTop;
      return;
    }

    if (messagesCount !== prevMessagesCountRef.current) {
      const isNewUserPrompt = lastMessageRole === "user" || liveStatus === "submitted";
      if (isNewUserPrompt) {
        if (!initialSpacerRef.current) {
          const availableH = Math.max(260, el.clientHeight - composerH);
          const targetSpacer = Math.round(availableH * 0.5);
          initialSpacerRef.current = targetSpacer;
          setActiveSpacer(targetSpacer);
        }
        scrollToBottom(true);
      } else if (stickRef.current) {
        scrollToBottom(false);
      }
      prevFirstMsgIdRef.current = firstMsgId;
      prevMessagesCountRef.current = messagesCount;
      prevScrollHeightRef.current = el.scrollHeight;
      prevScrollTopRef.current = el.scrollTop;
    }
  }, [
    active,
    activeChatId,
    composerH,
    firstMsgId,
    messagesCount,
    lastMessageRole,
    liveStatus,
    scrollToBottom,
  ]);

  useEffect(() => {
    if (!loadingOlder && isPrependingRef.current) {
      isPrependingRef.current = false;
    }
  }, [loadingOlder]);

  /* Measure the floating composer as it changes */
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const measure = () => setComposerH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  /* The composer floats outside the scroll container, so it needs the same
   * right inset the thread reserves via `[scrollbar-gutter:stable]`.
   * Mirroring the measured gutter width as a right margin on the composer
   * locks both edges together in every state; overlay scrollbars report
   * zero and change nothing.
   *
   * Measured in a layout effect, and measured while the thread is still
   * loading. A passive effect lands after the first frame, and the loading
   * state is not "active" yet, so the bar used to paint at the centre of the
   * pane and then hop left by half a scrollbar the moment the gutter was
   * known — on every reload and every return to a thread. The skeleton
   * inside the scroll container is already inset, so the bar has to be too,
   * from its first frame. */
  const [scrollGutter, setScrollGutter] = useState(0);
  useIsomorphicLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(0, el.offsetWidth - el.clientWidth);
      setScrollGutter((current) => (current === w ? current : w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active, loadingThread]);

  /* While streaming, as the assistant response grows, the empty space below shrinks
   * so that (prompt + assistant + empty space) fills the viewport naturally.
   * If the user scrolls away from the bottom after generation completes, the empty space collapses
   * to 0 so that no ghost padding lingers when they return. */
  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    const content = el?.firstElementChild as HTMLElement | null;
    if (!el || !content) return;
    let raf = 0;

    const onScroll = () => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;

      const isBusy = liveStatus === "submitted" || liveStatus === "streaming";

      // If the turn is finished and the user scrolls away from the bottom (e.g. scrolls up into history),
      // collapse the empty space so it never lingers when they return.
      if (!isBusy && initialSpacerRef.current > 0) {
        const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
        if (distanceFromBottom > 40) {
          initialSpacerRef.current = 0;
          setActiveSpacer(0);
        }
      }

      const lastChild = content.lastElementChild as HTMLElement | null;
      if (lastChild) {
        const contentBottom = lastChild.offsetTop + lastChild.offsetHeight;
        const composerThreshold = scrollEl.clientHeight - composerH - 28;
        const bottomInViewport = contentBottom - scrollEl.scrollTop;
        stickRef.current = bottomInViewport <= composerThreshold + 80;
      } else {
        stickRef.current = true;
      }

      if (
        scrollEl.scrollTop < 80 &&
        hasMoreOlder &&
        !loadingOlder &&
        onLoadOlder &&
        !isPrependingRef.current
      ) {
        isPrependingRef.current = true;
        prevScrollHeightRef.current = scrollEl.scrollHeight;
        prevScrollTopRef.current = scrollEl.scrollTop;
        onLoadOlder();
      }
    };

    const pin = () => {
      if (!stickRef.current) return;
      if (content.querySelector("[data-prevent-scroll-pin='true']")) return;

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;

        // "the ultimate combo is that the user prompt + agent + empty space is the total viewport"
        // As the assistant response expands, decrease the empty space spacer proportionally
        if (initialSpacerRef.current > 0) {
          const assistantEl = content.querySelector(
            '[data-role="assistant"]:last-of-type, [data-role="loading"]:last-of-type'
          ) as HTMLElement | null;
          if (assistantEl) {
            const assistantH = assistantEl.offsetHeight;
            const remainingSpacer = Math.max(0, initialSpacerRef.current - assistantH);
            setActiveSpacer((current) => (current !== remainingSpacer ? remainingSpacer : current));
          }
        }

        const lastChild = content.lastElementChild as HTMLElement | null;
        if (!lastChild) return;

        const contentBottom = lastChild.offsetTop + lastChild.offsetHeight;
        const composerThreshold = scrollEl.clientHeight - composerH - 24;
        const bottomInViewport = contentBottom - scrollEl.scrollTop;

        if (bottomInViewport <= composerThreshold) {
          return;
        }

        const neededScrollTop = contentBottom - composerThreshold;
        if (neededScrollTop > scrollEl.scrollTop) {
          scrollEl.scrollTop = neededScrollTop;
        }
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    const resize = new ResizeObserver(pin);
    resize.observe(content);
    const mutate = new MutationObserver(pin);
    mutate.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    return () => {
      el.removeEventListener("scroll", onScroll);
      resize.disconnect();
      mutate.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [active, composerH, hasMoreOlder, liveStatus, loadingOlder, onLoadOlder]);

  // Normal padding lets the last line rest flush above the composer.
  // The temporary activeSpacer is only present while a prompt is sent/streaming
  // and collapses to 0 once the turn completes and the user scrolls away or navigates.
  const threadPaddingBottom = composerH + 16 + activeSpacer;

  /* the title bar rides the top of the main pane in both layouts. The type
   * matches the sidebar's "New chat" row: 14px medium ink-2. Hovering the
   * title reveals a pencil that renames it inline. */
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const renameCancelledRef = useRef(false);

  const startRename = () => {
    renameCancelledRef.current = false;
    setTitleDraft(displayTitle ?? "");
    setEditingTitle(true);
  };
  const commitRename = () => {
    if (renameCancelledRef.current) return;
    const next = titleDraft.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
    setEditingTitle(false);
    const current = (displayTitle ?? "").trim();
    if (!next || next === current) return;
    if (live) onRename?.(next);
    else setDemoTitle(next);
  };

  /* a fresh thread leaves nothing to rename */
  useEffect(() => {
    if (!displayTitle) setEditingTitle(false);
  }, [displayTitle]);

  const titleBar = (
    <div className="group flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:pl-4">
      {editingTitle ? (
        <input
          autoFocus
          value={titleDraft}
          maxLength={TITLE_MAX_CHARS}
          aria-label="Rename chat"
          onChange={(event) => setTitleDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitRename();
            } else if (event.key === "Escape") {
              renameCancelledRef.current = true;
              setEditingTitle(false);
            }
          }}
          onBlur={commitRename}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-ink outline-none"
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <span
            className="block min-w-0 max-w-full truncate text-[14px] font-medium text-ink-2"
            title={displayTitle ?? "New chat"}
          >
            {displayTitle ?? "New chat"}
          </span>
          <button
            type="button"
            aria-label="Rename chat"
            onClick={startRename}
            className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 opacity-0 transition-[opacity,background-color,color] duration-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
          >
            <IconPencil size={15} stroke={1.9} />
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label="New chat"
        onClick={() => {
          if (live) onNewChat?.();
          else newDemoChat();
          focusComposer({ clearDraft: true });
        }}
        className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );

  /* the message thread + composer — reused as the main column (wide) or the
   * docked assistant panel in spreadsheet mode (narrow) */
  const renderThread = (narrow: boolean) => {
    const isToolPart = (type: string) =>
      type.startsWith("tool-") || type === "dynamic-tool";
    const lastAssistant =
      live?.messages &&
      live.messages.length > 0 &&
      live.messages[live.messages.length - 1].role === "assistant"
        ? live.messages[live.messages.length - 1]
        : null;
    const hasInflightAssistantContent = Boolean(
      lastAssistant?.parts?.some(
        (part) =>
          (part.type === "text" && part.text.trim().length > 0) ||
          part.type === "reasoning" ||
          isToolPart(part.type),
      ),
    );
    const showInflightLoader =
      (live?.status === "submitted" || live?.status === "streaming") &&
      !hasInflightAssistantContent;

    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
      {loadingOlder && (
        <div
          className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center"
          aria-hidden="true"
        >
          <div
            className="flex size-7 items-center justify-center rounded-full border border-line bg-surface/90 shadow-sm backdrop-blur-sm"
            style={{ animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both" }}
          >
            <SpinnerRing active size={18} stroke={2} />
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-slim [scrollbar-gutter:stable]"
      >
        {loadingThread ? (
          <ThreadSkeleton bottomPad={composerH + 16} narrow={narrow} />
        ) : (
          <div
            key={threadKey}
            className={`flex flex-col gap-8 pt-8 ${narrow ? "px-4" : "px-4 sm:px-8 lg:px-12"}`}
            /* pad the bottom by the floating composer's height so the last message
               can rest flush with the bar and older content scrolls behind it */
            style={{ animation: "fade-in 150ms ease both", paddingBottom: threadPaddingBottom }}
          >
            {live ? (
            <>
              {liveClustered.map(({ message, showTimestamp, timestamp }) => {
                const text = message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("");
                const isLastAssistant =
                  message.role === "assistant" &&
                  message.id === live.messages[live.messages.length - 1]?.id;
                const messageStatus = isLastAssistant ? live.status : "ready";
                // "Latest" is too strict: a turn can have several assistant
                // messages, and only a new user message means the user moved
                // on. That is what disables an unlock request.
                const messageIndex = live.messages.findIndex(
                  (entry) => entry.id === message.id,
                );
                const superseded =
                  messageIndex >= 0 &&
                  live.messages
                    .slice(messageIndex + 1)
                    .some((entry) => entry.role === "user");
                // An assistant turn with no real user message between it and
                // this one is the continuation that answered the unlock card.
                const unlockResolved = unlockResolvedAfter(
                  live.messages,
                  messageIndex,
                );
                // The request this card belongs to, so a new prompt from an
                // old card retries that request rather than the newest one.
                let priorUserText = "";
                for (let i = messageIndex - 1; i >= 0; i -= 1) {
                  const candidate = live.messages[i];
                  if (candidate?.role !== "user") continue;
                  const text = candidate.parts
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join(" ")
                    .trim();
                  if (text) {
                    priorUserText = text;
                    break;
                  }
                }
                const retryText = priorUserText || "Retry my last request.";
                return (
                  <Fragment key={message.id}>
                    {showTimestamp && (
                      <div
                        data-timestamp="true"
                        className={`scroll-mt-8 ${narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}`}
                      >
                        <TimestampPill timestamp={timestamp} />
                      </div>
                    )}
                    <div
                      data-role={message.role}
                      data-message-id={message.id}
                      className={`scroll-mt-8 ${narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}`}
                    >
                      {message.role === "user" ? (
                        <UserBubble
                          text={text}
                          onEdit={(next) => {
                            const el = scrollRef.current;
                            if (el) {
                              const availableH = Math.max(260, el.clientHeight - composerH);
                              const targetSpacer = Math.round(availableH * 0.5);
                              initialSpacerRef.current = targetSpacer;
                              setActiveSpacer(targetSpacer);
                            }
                            if (live.editAndSend) {
                              live.editAndSend(message.id, next);
                            } else {
                              live.send(next);
                            }
                          }}
                        />
                      ) : (
                        <LiveResponse
                          message={message}
                          status={messageStatus}
                          interactive
                          superseded={superseded}
                          resolved={unlockResolved}
                          onRetry={() => live.send(retryText)}
                          onPrompt={live.send}
                          onRegenerate={
                            live.regenerate
                              ? () => live.regenerate?.(message.id)
                              : undefined
                          }
                          onApproval={live.respondToApproval}
                          conversationId={live.conversationId}
                          decisions={live.decisions}
                          settlements={live.settlements}
                          pendingApprovalIds={live.pendingApprovalIds}
                          onApprovalVisible={live.onApprovalVisible}
                        />
                      )}
                    </div>
                  </Fragment>
                );
              })}
              {(gated ?? []).map((exchange) => (
                <div
                  key={`gated-${exchange.id}`}
                  data-role="gated"
                  className={`scroll-mt-8 ${narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}`}
                >
                  <div className="flex flex-col gap-8">
                    <UserBubble text={exchange.prompt} />
                    <ConnectGate />
                  </div>
                </div>
              ))}
            </>
          ) : (
            demoClustered.map(({ message, showTimestamp, timestamp }) => {
              const full = !narrow && message.role === "assistant" && SCENARIOS[message.scenarioId].fullBleed;
              return (
                <Fragment key={message.id}>
                  {showTimestamp && (
                    <div
                      data-timestamp="true"
                      className={`scroll-mt-8 ${narrow || full ? "w-full" : "mx-auto w-full max-w-[720px]"}`}
                    >
                      <TimestampPill timestamp={timestamp} />
                    </div>
                  )}
                  <div
                    data-role={message.role}
                    data-message-id={message.id}
                    className={`scroll-mt-8 ${narrow || full ? "w-full" : "mx-auto w-full max-w-[720px]"}`}
                  >
                    {message.role === "user" ? (
                      <UserBubble
                        text={message.text}
                        onEdit={(next) => {
                          const el = scrollRef.current;
                          if (el) {
                            const availableH = Math.max(260, el.clientHeight - composerH);
                            const targetSpacer = Math.round(availableH * 0.5);
                            initialSpacerRef.current = targetSpacer;
                            setActiveSpacer(targetSpacer);
                          }
                          setDemoMessages((current) =>
                            current.map((m) =>
                              m.id === message.id ? { ...m, text: next } : m,
                            ),
                          );
                        }}
                      />
                    ) : (
                      <AssistantResponse key={message.id} scenarioId={message.scenarioId} />
                    )}
                  </div>
                </Fragment>
              );
            })
          )}
          {/* the round trip from send to the first stream chunk has no
              assistant content to attach to, so the loader sits on its own */}
          {showInflightLoader ? (
            <div data-role="loading" className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
              {/* Pixel-matched to ActivityStatus' status row (-mx-1.5 + px-1.5
                  + py-1, icon 15px, gap-2, 13px label) so the swap to the live
                  activity line on the first stream chunk doesn't move the text. */}
              <div className="w-full max-w-95">
                <div className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1">
                  <LoadingState label="Thinking" variant="Drive" />
                </div>
              </div>
            </div>
          ) : null}
          {live?.error ? (
            <div data-role="error" className="mx-auto w-full max-w-[720px] text-[13px] text-red">
              {live.error}
            </div>
          ) : null}
        </div>
        )}
      </div>

      {/* soft fade so content dissolves into the bar instead of hard-clipping */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{ height: composerH + 32, background: "linear-gradient(to top, var(--page) 64%, transparent)" }}
      />

      {/* the composer floats over the thread; content scrolls behind it */}
      <div
        ref={composerRef}
        className={`absolute inset-x-0 bottom-0 ${narrow ? "px-4 pb-4" : "px-4 pb-6 sm:px-8 lg:px-12"}`}
        style={{ marginRight: scrollGutter }}
      >
        <div className={narrow ? "w-full" : "mx-auto w-full max-w-[720px]"}>
          <PromptBar
            demo={false}
            tall
            autoFocus={true}
            placeholder="Reply"
            onSend={(text) => {
              const el = scrollRef.current;
              if (el) {
                const availableH = Math.max(260, el.clientHeight - composerH);
                const targetSpacer = Math.round(availableH * 0.5);
                initialSpacerRef.current = targetSpacer;
                setActiveSpacer(targetSpacer);
              }
              if (live) live.send(text);
              else send(text, matchScenario(text));
              focusComposer();
            }}
          />
        </div>
      </div>
    </div>
  );
};

  return (
    <main className="flex h-[100dvh] gap-0 bg-canvas p-2.5 text-ink lg:pl-0">
      <SidebarNav
        fill
        className="hidden lg:flex"
        recents={
          live
            ? (threads && threads.length > 0
                ? threads.map((t) => ({ id: t.id, label: t.label ?? "New chat" }))
                : title
                  ? [{ id: "current", label: title }]
                  : [])
            : RECENTS
        }
        activeTitle={displayTitle}
        activeId={live ? (activeChatId ?? null) : undefined}
        onPick={
          live
            ? onPickThread
              ? (id) => onPickThread(id)
              : undefined
            : (id, label, prompt) => pickRecent(id as ScenarioId, label, prompt)
        }
        onHoverThread={live ? onHoverThread : undefined}
        onRenameChat={live ? onRenameThread : undefined}
        onDeleteChat={live ? onDeleteThread : undefined}
        trashCount={live ? (trashCount ?? 0) : 0}
        trashActive={trashActive}
        onOpenTrash={live ? onOpenTrash : undefined}
        portfolioActive={portfolioActive}
        onOpenPortfolio={live ? onOpenPortfolio : undefined}
        historyActive={historyActive}
        onOpenHistory={live ? onOpenHistory : undefined}
        onNewChat={() => {
          if (live) onNewChat?.();
          else newDemoChat();
          focusComposer({ clearDraft: true });
        }}
        footerLabel="Fork this"
        onFooterClick={footer ? () => {} : () => setUseOpen(true)}
        footer={footer}
        footerCompact={footerCompact}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {/* panels row — main pane + docked side pane */}
        <div className="flex min-h-0 flex-1 gap-2.5">
          {workspaceScenario ? (
            <>
              {/* main pane — the live spreadsheet */}
              <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
                {titleBar}
                <div className="flex min-h-0 flex-1 flex-col">{workspaceScenario.Workspace?.()}</div>
                {/* views — selecting one opens its property inspector on the right */}
                <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-t border-line px-2">
                  <button type="button" className="flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                    Sort &amp; filter
                  </button>
                  <span className="mx-1 h-4 w-px shrink-0 bg-line" />
                  {SPREADSHEET_VIEWS.map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      aria-pressed={propView === v.name}
                      onClick={() => setPropView((current) => (current === v.name ? null : v.name))}
                      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] font-medium transition-colors duration-100 ${
                        propView === v.name ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
                      }`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={v.color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0"><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M3.5 9.5h17M9.5 9.5v11" /></svg>
                      {v.name}
                      <span className="text-[11px] tabular-nums text-ink-3">{v.count}</span>
                    </button>
                  ))}
                  <button type="button" className="ml-0.5 flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] px-2 text-[12.5px] font-medium text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
                    New view
                  </button>
                </div>
              </section>

              {/* right inspector — assistant chat, or a property configurator when a view is selected */}
              <aside
                className="hidden w-[400px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-line bg-page lg:flex"
                style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}
              >
                {propView ? (
                  <PropertyConfig view={propView} onClose={() => setPropView(null)} />
                ) : (
                  <>
                    <div className="flex h-11 shrink-0 items-center border-b border-line px-4">
                      <span className="text-[13px] font-semibold text-ink">Chat</span>
                    </div>
                    {renderThread(true)}
                  </>
                )}
              </aside>
            </>
          ) : (
            <>
              <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
                {titleBar}
                {active || loadingThread ? (
                  renderThread(false)
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto scroll-slim [scrollbar-gutter:stable]">
                    <EmptyState onSend={send} shuffle={() => setOffset((current) => (current + 3) % SUGGESTION_POOL.length)} offset={offset} live={live} />
                  </div>
                )}
              </section>

              {/* artifact pane — its own rounded container */}
              {active && paneMsg && paneScenario?.Pane && (
                  <aside
                    key={paneMsg.id}
                    className="hidden w-[360px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-line bg-page lg:flex"
                    style={{ animation: "fade-in 300ms ease both" }}
                  >
                    <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3 sm:pl-4">
                      <span className="text-[13px] font-semibold text-ink">{paneScenario.paneTitle}</span>
                      <div className="flex items-center gap-0.5 text-ink-3">
                        <button type="button" aria-label="Previous" className="flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 hover:bg-hover hover:text-ink">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
                        </button>
                        <button type="button" aria-label="Next" className="flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 hover:bg-hover hover:text-ink">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                        </button>
                        <button type="button" aria-label="Pane options" className="flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 hover:bg-hover hover:text-ink">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
                        </button>
                        <button
                          type="button"
                          aria-label="Close pane"
                          onClick={() => setClosedPaneId(paneMsg.id)}
                          className="flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 hover:bg-hover hover:text-ink"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim p-4">
                      <PaneBody beat={paneScenario.beat}>{paneScenario.Pane()}</PaneBody>
                    </div>
                  </aside>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
