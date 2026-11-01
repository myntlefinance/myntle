"use client";

import { useCallback, useState, useMemo, type ReactNode } from "react";
import {
  IconCopy,
  IconCheck,
  IconBrandTypescript,
  IconBrandJavascript,
  IconBrandPython,
  IconBrandRust,
  IconBrandGolang,
  IconBrandCpp,
  IconBrandCSharp,
  IconBrandHtml5,
  IconBrandCss3,
  IconBrandPhp,
  IconBrandSwift,
  IconBrandKotlin,
  IconBraces,
  IconTerminal2,
  IconDatabase,
  IconGitCompare,
  IconMarkdown,
  IconFileCode,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────
 * CODE BLOCK
 * A light editor panel with two versions (switch in the card):
 *   · Code — a line-numbered listing
 *   · Diff — a unified diff: old/new gutters, a green/red accent
 *     bar and row tint, plus word-level add/del highlights.
 * Both share syntax coloring, insets, and wrapping behavior.
 * ───────────────────────────────────────────────────────── */

const FILE = "churn.ts";

const CODE_LINES = [
  "export async function churnBatch() {",
  '  const flavor = await getFlavor("pistachio");',
  "  const base = await dairy.fetch({ flavor });",
  '  await freezer.store(base, { temp: "-16C" });',
  "  if (!base.approved) return null;",
  "  return base.gallons;",
  "}",
];

/* A single run of code within a diff row; `change` tints it as an add/del. */
export type CodePiece = { text: string; change?: "add" | "del" };
/* One row of a unified diff: old/new line numbers, its kind, and its pieces. */
export type DiffRow = {
  old: number | null;
  cur: number | null;
  type: "ctx" | "add" | "del";
  pieces: CodePiece[];
};
/* Prominent copy strings on the code block. */
export type CodeBlockLabels = { copy: string; copied: string };

// Back-compat internal aliases for the local component signatures.
type Piece = CodePiece;
type Row = DiffRow;

const DIFF: Row[] = [
  { old: 1, cur: 1, type: "ctx", pieces: [{ text: "export async function churnBatch() {" }] },
  { old: 2, cur: 2, type: "ctx", pieces: [{ text: '  const flavor = await getFlavor("pistachio");' }] },
  { old: 3, cur: 3, type: "ctx", pieces: [{ text: "  const base = await dairy.fetch({ flavor });" }] },
  { old: 4, cur: null, type: "del", pieces: [{ text: "  await freezer.store(base, { temp: " }, { text: '"-14C"', change: "del" }, { text: " });" }] },
  { old: null, cur: 4, type: "add", pieces: [{ text: "  await freezer.store(base, { temp: " }, { text: '"-16C"', change: "add" }, { text: " });" }] },
  { old: null, cur: 5, type: "add", pieces: [{ text: "  if (!base.approved) return null;" }] },
  { old: 5, cur: 6, type: "ctx", pieces: [{ text: "  return base.gallons;" }] },
  { old: 6, cur: 7, type: "ctx", pieces: [{ text: "}" }] },
];

const HATCH = "repeating-linear-gradient(45deg, var(--red) 0, var(--red) 1.5px, transparent 1.5px, transparent 3px)";

/** Parses unified diff text into unified diff rows */
export function parseUnifiedDiff(raw: string): DiffRow[] {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let curLine = 1;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (m) {
        oldLine = parseInt(m[1], 10);
        curLine = parseInt(m[2], 10);
      }
      continue;
    }
    if (
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("diff --git") ||
      line.startsWith("index ")
    ) {
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({
        old: null,
        cur: curLine++,
        type: "add",
        pieces: [{ text: line.slice(1), change: "add" }],
      });
    } else if (line.startsWith("-")) {
      rows.push({
        old: oldLine++,
        cur: null,
        type: "del",
        pieces: [{ text: line.slice(1), change: "del" }],
      });
    } else {
      const text = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({
        old: oldLine++,
        cur: curLine++,
        type: "ctx",
        pieces: [{ text }],
      });
    }
  }
  return rows;
}

/* light syntax coloring — keywords/imports/conditionals, functions, strings & numbers */
const KEYWORDS = new Set([
  "import", "from", "export", "default", "async", "function", "const", "let", "var",
  "await", "return", "if", "else", "for", "while", "new", "throw", "try", "catch",
  "null", "true", "false", "undefined",
  "def", "class", "self", "None", "True", "False", "elif", "with", "as", "in", "is",
  "fn", "pub", "mut", "impl", "struct", "enum", "type", "match", "func", "package"
]);
const TOKEN = /(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b(?:import|from|export|default|async|function|const|let|var|await|return|if|else|for|while|new|throw|try|catch|null|true|false|undefined|def|class|self|None|True|False|elif|with|as|in|is|fn|pub|mut|impl|struct|enum|type|match|func|package)\b|[A-Za-z_$][\w$]*(?=\s*\())/g;

function highlight(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    const t = m[0];
    if (idx > last) nodes.push(<span key={k++}>{text.slice(last, idx)}</span>);
    let color: string;
    let weight: number | undefined;
    if (t.startsWith("//") || t.startsWith("#")) color = "var(--ink-3)"; // comment
    else if (/^["'`]/.test(t) || /^\d/.test(t)) color = "var(--orange)"; // string / number
    else if (KEYWORDS.has(t)) color = "var(--accent-ink)"; // keyword / import / conditional
    else { color = "var(--ink)"; weight = 500; } // function call
    nodes.push(<span key={k++} style={{ color, fontWeight: weight }}>{t}</span>);
    last = idx + t.length;
  }
  if (last < text.length) nodes.push(<span key={k++}>{text.slice(last)}</span>);
  return nodes;
}

function Pieces({ pieces }: { pieces: Piece[] }) {
  const totalText = pieces.map((p) => p.text).join("");
  if (totalText.length === 0) {
    return "\u00A0";
  }
  return (
    <>
      {pieces.map((p, i) => {
        if (p.change) {
          const add = p.change === "add";
          return (
            <span
              key={i}
              className="rounded-[3px]"
              style={{
                background: `color-mix(in srgb, var(--${add ? "green" : "red"}) 18%, transparent)`,
                padding: "0 2px",
                margin: "0 -1px",
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
              }}
            >
              {highlight(p.text)}
            </span>
          );
        }
        return <span key={i}>{highlight(p.text)}</span>;
      })}
    </>
  );
}

function getLanguageKey(language?: string, filename?: string): string {
  if (language) return language.toLowerCase();
  if (filename && filename.includes(".")) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext) return ext;
  }
  return "";
}

function LanguageIcon({
  language,
  filename,
  isDiff,
}: {
  language?: string;
  filename?: string;
  isDiff?: boolean;
}) {
  if (isDiff || language === "diff") {
    return <IconGitCompare size={15} stroke={1.8} className="shrink-0 text-accent-ink" />;
  }
  const key = getLanguageKey(language, filename);
  switch (key) {
    case "ts":
    case "typescript":
    case "tsx":
      return <IconBrandTypescript size={15} stroke={1.8} className="shrink-0 text-[#3178C6]" />;
    case "js":
    case "javascript":
    case "jsx":
    case "mjs":
    case "cjs":
      return <IconBrandJavascript size={15} stroke={1.8} className="shrink-0 text-[#EAB308]" />;
    case "py":
    case "python":
      return <IconBrandPython size={15} stroke={1.8} className="shrink-0 text-[#38BDF8]" />;
    case "rs":
    case "rust":
      return <IconBrandRust size={15} stroke={1.8} className="shrink-0 text-[#F97316]" />;
    case "go":
    case "golang":
      return <IconBrandGolang size={15} stroke={1.8} className="shrink-0 text-[#00ADD8]" />;
    case "c":
    case "cpp":
    case "cc":
    case "cxx":
    case "h":
    case "hpp":
      return <IconBrandCpp size={15} stroke={1.8} className="shrink-0 text-[#60A5FA]" />;
    case "cs":
    case "csharp":
      return <IconBrandCSharp size={15} stroke={1.8} className="shrink-0 text-[#22C55E]" />;
    case "html":
    case "htm":
      return <IconBrandHtml5 size={15} stroke={1.8} className="shrink-0 text-[#F97316]" />;
    case "css":
    case "scss":
    case "sass":
      return <IconBrandCss3 size={15} stroke={1.8} className="shrink-0 text-[#38BDF8]" />;
    case "json":
      return <IconBraces size={15} stroke={1.8} className="shrink-0 text-[#F59E0B]" />;
    case "sql":
    case "psql":
    case "mysql":
      return <IconDatabase size={15} stroke={1.8} className="shrink-0 text-accent-ink" />;
    case "sh":
    case "bash":
    case "zsh":
    case "shell":
      return <IconTerminal2 size={15} stroke={1.8} className="shrink-0 text-[#22C55E]" />;
    case "php":
      return <IconBrandPhp size={15} stroke={1.8} className="shrink-0 text-[#818CF8]" />;
    case "swift":
      return <IconBrandSwift size={15} stroke={1.8} className="shrink-0 text-[#F97316]" />;
    case "kt":
    case "kotlin":
    case "kts":
      return <IconBrandKotlin size={15} stroke={1.8} className="shrink-0 text-[#A855F7]" />;
    case "md":
    case "markdown":
      return <IconMarkdown size={15} stroke={1.8} className="shrink-0 text-ink-2" />;
    default:
      return <IconFileCode size={15} stroke={1.8} className="shrink-0 text-ink-3" />;
  }
}

function getLanguageBadgeStyle(language?: string): string {
  const k = (language ?? "").toLowerCase();
  switch (k) {
    case "py":
    case "python":
      return "bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/25";
    case "js":
    case "javascript":
    case "jsx":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25";
    case "ts":
    case "typescript":
    case "tsx":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25";
    case "rs":
    case "rust":
      return "bg-orange-tint text-orange border border-orange/25";
    case "go":
    case "golang":
      return "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/25";
    case "json":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25";
    case "sh":
    case "bash":
    case "zsh":
    case "shell":
      return "bg-green-tint text-green border border-green/25";
    case "diff":
    case "git":
      return "bg-accent-tint text-accent-ink border border-accent/25";
    case "sql":
      return "bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25";
    case "html":
      return "bg-orange-tint text-orange border border-orange/25";
    case "css":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25";
    default:
      return "bg-accent-tint text-accent-ink border border-accent/25";
  }
}

const DEFAULT_LABELS: CodeBlockLabels = { copy: "Copy", copied: "Copied" };

export type CodeBlockProps = {
  /** Which view to render — "Code" (line-numbered listing) or "Diff". */
  variant?: string;
  /** The lines shown in the Code view. */
  lines?: string[];
  /** Raw text placed on the clipboard by Copy. Defaults to `lines` joined. */
  code?: string;
  /** The unified-diff rows shown in the Diff view. */
  diff?: DiffRow[];
  /** Filename shown in the header. */
  filename?: string;
  /** Programming language displayed in the header pill (e.g. "typescript", "json", "python"). */
  language?: string;
  /** Additional class names applied to the card container. */
  className?: string;
  /** Prominent copy strings. */
  labels?: Partial<CodeBlockLabels>;
  /** Called with the copied text after a successful copy. */
  onCopy?: (text: string) => void;
};

export default function CodeBlock({
  variant,
  lines,
  code,
  diff,
  filename = FILE,
  language,
  className,
  labels,
  onCopy,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const text = { ...DEFAULT_LABELS, ...labels };

  const isDiff =
    variant === "Diff" ||
    (variant === undefined && (language === "diff" || diff !== undefined));

  const resolvedDiff = useMemo(() => {
    if (diff) return diff;
    if (isDiff && code) return parseUnifiedDiff(code);
    return DIFF;
  }, [diff, isDiff, code]);

  const displayLines = useMemo(() => {
    if (lines) return lines;
    if (code !== undefined) {
      return code.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
    }
    return CODE_LINES;
  }, [lines, code]);

  const raw =
    code ??
    (isDiff
      ? resolvedDiff
          .map((r) => r.pieces.map((p) => p.text).join(""))
          .join("\n")
      : displayLines.join("\n"));

  const copy = useCallback(() => {
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      onCopy?.(raw);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [raw, onCopy]);

  const added = resolvedDiff.filter((r) => r.type === "add").length;
  const removed = resolvedDiff.filter((r) => r.type === "del").length;

  return (
    <div className={cn("w-full overflow-hidden rounded-card bg-surface shadow-card", className)}>
      {/* header — file · (language pill · diff stat · copy) */}
      <div className="flex h-11 items-center gap-2 border-b border-line px-4 text-[12.5px]">
        <span className="inline-flex min-w-0 items-center gap-[7px]">
          <LanguageIcon language={language} filename={filename} isDiff={isDiff} />
          <span className="truncate font-mono leading-none text-ink">{filename}</span>
        </span>

        <div className="ml-auto flex items-center gap-2">
          {language && (
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold leading-none capitalize tracking-tight",
                getLanguageBadgeStyle(language),
              )}
            >
              {language}
            </span>
          )}

          {isDiff && (
            <span className="inline-flex items-center gap-2 font-mono text-[12px] leading-none tabular-nums">
              <span className="text-green">+{added}</span>
              <span className="text-red">-{removed}</span>
            </span>
          )}

          <button
            type="button"
            aria-label={copied ? text.copied : text.copy}
            onClick={copy}
            className={cn(
              "flex h-6 w-[68px] shrink-0 items-center justify-center gap-1.5 rounded-[6px] text-[11px] transition-colors duration-150 hover:bg-hover active:scale-[0.97]",
              copied ? "text-green font-medium" : "text-ink-3 hover:text-ink",
            )}
          >
            <span className="relative flex size-3 shrink-0 items-center justify-center">
              <span
                aria-hidden={copied}
                className="absolute inset-0 flex items-center justify-center transition-all duration-200"
                style={{
                  opacity: copied ? 0 : 1,
                  transform: copied ? "scale(0.8)" : "scale(1)",
                }}
              >
                <IconCopy size={12} />
              </span>
              <span
                aria-hidden={!copied}
                className="absolute inset-0 flex items-center justify-center text-green transition-all duration-200"
                style={{
                  opacity: copied ? 1 : 0,
                  transform: copied ? "scale(1)" : "scale(0.8)",
                }}
              >
                <IconCheck size={12} stroke={2.4} strokeWidth={2.4} />
              </span>
            </span>

            <span className="relative h-3.5 w-[38px] shrink-0 overflow-hidden text-left">
              <span
                aria-hidden={copied}
                className="absolute inset-0 flex items-center transition-all duration-200"
                style={{
                  opacity: copied ? 0 : 1,
                  transform: copied ? "translateY(-5px)" : "translateY(0)",
                }}
              >
                {text.copy}
              </span>
              <span
                aria-hidden={!copied}
                className="absolute inset-0 flex items-center text-green font-medium transition-all duration-200"
                style={{
                  opacity: copied ? 1 : 0,
                  transform: copied ? "translateY(0)" : "translateY(5px)",
                }}
              >
                {text.copied}
              </span>
            </span>
          </button>
        </div>
      </div>

      {/* body — equal 14px/16px inset on top / left / right; integer 23px line-height with baseline alignment */}
      <div className="overflow-x-auto py-3.5 font-mono text-[12.5px] leading-[23px] text-ink-2 scroll-slim">
        {isDiff ? (
          <div className="relative min-w-full">
            <span className="pointer-events-none absolute inset-y-0 left-[44px] w-px bg-line" />
            {resolvedDiff.map((r, i) => {
              const add = r.type === "add";
              const del = r.type === "del";
              // one gutter column: removals keep the old number, additions/context show the new one
              const num = del ? r.old : r.cur;
              return (
                <div
                  key={i}
                  className={cn(
                    "relative grid grid-cols-[44px_minmax(0,1fr)] items-baseline",
                    add ? "bg-green-tint" : del ? "bg-red-tint" : "",
                  )}
                >
                  {(add || del) && (
                    <span
                      className="absolute inset-y-0 left-0 w-[3px]"
                      style={{ background: add ? "var(--green)" : HATCH }}
                    />
                  )}
                  <span
                    className={cn(
                      "select-none px-2 text-center text-[11px] leading-[23px] tabular-nums",
                      add ? "text-green" : del ? "text-red" : "text-ink-3",
                    )}
                  >
                    {num ?? "\u00A0"}
                  </span>
                  <code className="pl-3.5 pr-4 break-words whitespace-pre-wrap leading-[23px]">
                    <Pieces pieces={r.pieces} />
                  </code>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="relative min-w-full">
            <span className="pointer-events-none absolute inset-y-0 left-[44px] w-px bg-line" />
            {displayLines.map((line, i) => (
              <div key={i} className="grid grid-cols-[44px_minmax(0,1fr)] items-baseline">
                <span className="select-none px-2 text-center text-[11px] leading-[23px] tabular-nums text-ink-3">
                  {i + 1}
                </span>
                <code className="pl-3.5 pr-4 break-words whitespace-pre-wrap leading-[23px]">
                  {line.length === 0 ? "\u00A0" : highlight(line)}
                </code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
