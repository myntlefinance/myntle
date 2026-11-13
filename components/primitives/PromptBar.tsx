"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isDesktop,
  isEditableElement,
  FOCUS_COMPOSER_EVENT,
  type FocusComposerDetail,
  typeToFocusComposer,
} from "@/lib/composer";
import {
  fetchNamePreview,
  findNamesInText,
  replaceFirstName,
} from "@/lib/names/detect";
import { shortAddr } from "@/lib/trade/identity";

/* ─────────────────────────────────────────────────────────
 * PROMPT BAR
 * A composer with real controls: attach, @ data sources,
 * / commands, dictation, and send.
 * Type @ or / to open the menus; ↑↓ + Enter to pick.
 * Variants: Rounded (card radius) · Pill (full radius).
 * ───────────────────────────────────────────────────────── */

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: React.ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const GLYPHS: Record<string, React.ReactNode> = {
  clip: <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  layers: <g><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></g>,
  globe: <g><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></g>,
};

/* real product marks, inline so the file stays self-contained */
const BRANDS: Record<string, React.ReactNode> = {
  figma: (
    <svg width="11" height="16" viewBox="0 0 38 57" aria-hidden="true">
      <path d="M9.5 57A9.5 9.5 0 0 0 19 47.5V38H9.5a9.5 9.5 0 0 0 0 19z" fill="#0ACF83" />
      <path d="M0 28.5A9.5 9.5 0 0 1 9.5 19H19v19H9.5A9.5 9.5 0 0 1 0 28.5z" fill="#A259FF" />
      <path d="M0 9.5A9.5 9.5 0 0 1 9.5 0H19v19H9.5A9.5 9.5 0 0 1 0 9.5z" fill="#F24E1E" />
      <path d="M19 0h9.5a9.5 9.5 0 1 1 0 19H19V0z" fill="#FF7262" />
      <path d="M38 28.5a9.5 9.5 0 1 1-19 0 9.5 9.5 0 0 1 19 0z" fill="#1ABCFE" />
    </svg>
  ),
  slack: (
    <svg width="15" height="15" viewBox="0 0 127 127" aria-hidden="true">
      <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A" />
      <path d="M47 27.2c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.7 39.7.8 47 .8c7.3 0 13.2 5.9 13.2 13.2v13.2H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.3.7 54.4.7 47.1c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0" />
      <path d="M99.9 47.1c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V47.1zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.9C66.9 6.6 72.8.7 80.1.7c7.3 0 13.2 5.9 13.2 13.2v33.2z" fill="#2EB67D" />
      <path d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z" fill="#ECB22E" />
    </svg>
  ),
  gmail: (
    <svg width="15" height="12" viewBox="0 0 256 193" aria-hidden="true">
      <path d="M58.182 192.05V93.14L27.507 65.077 0 49.504v125.091c0 9.658 7.825 17.455 17.455 17.455h40.727Z" fill="#4285F4" />
      <path d="M197.818 192.05h40.727c9.659 0 17.455-7.826 17.455-17.455V49.505l-31.156 17.837-27.026 25.798v98.91Z" fill="#34A853" />
      <path d="m58.182 93.14-4.174-38.647 4.174-36.989L128 69.868l69.818-52.364 4.669 34.992-4.669 40.644L128 145.504 58.182 93.14Z" fill="#EA4335" />
      <path d="M197.818 17.504V93.14L256 49.504V26.231c0-21.585-24.64-33.89-41.89-20.945l-16.292 12.218Z" fill="#FBBC04" />
      <path d="m0 49.504 26.759 20.07L58.182 93.14V17.504L41.89 5.286C24.61-7.66 0 4.646 0 26.23v23.273Z" fill="#C5221F" />
    </svg>
  ),
};

type Source = {
  key: string;
  name: string;
  desc: string;
  glyph?: string;
  brand?: string;
  attach?: boolean;
  connect?: boolean;
};

const SOURCES: Source[] = [
  { key: "attach", name: "Add photos & files", desc: "Upload from your computer", glyph: "clip", attach: true },
  { key: "scoop", name: "Scoop Data", desc: "Sales & churn metrics", glyph: "chart" },
  { key: "flavors", name: "Flavor records", desc: "26 makers, tags, links", glyph: "layers" },
  { key: "web", name: "Web search", desc: "Real-time news and info", glyph: "globe" },
  { key: "figma", name: "Figma", desc: "Design-to-code workflows", brand: "figma" },
  { key: "slack", name: "Slack", desc: "Read and manage Slack", brand: "slack" },
  { key: "gmail", name: "Gmail", desc: "Read and manage Gmail", brand: "gmail", connect: true },
];

const COMMANDS = [
  { key: "compare", name: "/compare", desc: "Flavor vs. last summer" },
  { key: "churn-plan", name: "/churn-plan", desc: "Draft a churn schedule" },
  { key: "restock", name: "/restock", desc: "Build a reorder list" },
  { key: "draft-email", name: "/draft-email", desc: "Write a supplier email" },
  { key: "summarize", name: "/summarize", desc: "Digest the thread so far" },
];

export type AttachedFile = {
  id: string;
  name: string;
  ext: string;
  size: number;
  type: string;
  /** object URL for local preview; revoked on remove/send */
  url: string;
  kind: "image" | "svg" | "file";
};

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "ico", "heic", "heif"]);

function getExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function classifyFile(name: string, type: string): AttachedFile["kind"] {
  const ext = getExtension(name);
  if (ext === "svg" || type === "image/svg+xml") return "svg";
  if (type.startsWith("image/") || IMAGE_EXTS.has(ext)) return "image";
  return "file";
}

/** extension → branded icon; missing files fall back to file.webp, then the generic glyph */
function iconSrcFor(ext: string): string {
  return `/file-icons/${ext || "file"}.webp`;
}

function AttachmentThumb({ file }: { file: AttachedFile }) {
  const [failed, setFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  if (file.kind === "image" || file.kind === "svg") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- blob: object-URL attachment preview; next/image cannot optimize object URLs
      <img
        src={file.url}
        alt=""
        draggable={false}
        className="size-4 shrink-0 rounded-[4px] object-cover"
      />
    );
  }
  if (!failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny 16px file-type icon; a next/image wrapper would break the inline thumb layout
      <img
        src={iconSrcFor(file.ext)}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className="size-4 shrink-0 rounded-[4px] object-cover"
      />
    );
  }
  if (!fallbackFailed && file.ext !== "file") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny fallback file icon; a next/image wrapper would break the inline thumb layout
      <img
        src="/file-icons/file.webp"
        alt=""
        draggable={false}
        onError={() => setFallbackFailed(true)}
        className="size-4 shrink-0 rounded-[4px] object-cover"
      />
    );
  }
  return (
    <Icon size={12}>
      <g>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </g>
    </Icon>
  );
}

const ATTACH_ACCEPT =
  ".png,.jpg,.jpeg,.webp,.gif,.avif,.svg,.bmp,.ico,.heic,.heif,.pdf,.doc,.docx,.odt,.rtf,.txt,.md,.log,.xls,.xlsx,.csv,.tsv,.ods,.ppt,.pptx,.odp,.zip,.rar,.7z,.tar,.gz,.json,.mp3,.wav,.m4a,.mp4,.mov,.webm";
const MAX_ATTACHMENTS = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** The pause after the last keystroke before a name preview starts. */
const NAME_STRIP_DEBOUNCE_MS = 350;
const DICTATION = "Compare pistachio weekends to last summer";

/* self-running demo: walk the @ menu, then the / menu, and repeat.
 * Any pointer or key interaction hands control to the user. */
const AUTO_STEPS: {
  draft: string;
  active?: number;
  connect?: boolean;
  hold: number;
}[] = [
  { draft: "", connect: false, hold: 1100 },
  { draft: "@", active: 0, hold: 900 },
  { draft: "@", active: 1, hold: 620 },
  { draft: "@", active: 4, hold: 620 },
  { draft: "@", active: 6, hold: 700 },
  { draft: "@", active: 6, connect: true, hold: 1000 },
  { draft: "", hold: 700 },
  { draft: "/", active: 0, hold: 900 },
  { draft: "/", active: 1, hold: 620 },
  { draft: "/", active: 3, hold: 1000 },
  { draft: "", hold: 900 },
];

/* the last @word or /word being typed, if any */
function parseToken(draft: string): { kind: "at" | "slash"; query: string; start: number } | null {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!match) return null;
  return {
    kind: match[2] === "@" ? "at" : "slash",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length,
  };
}

export default function PromptBar({
  variant = "Rounded",
  demo = true,
  tall = false,
  placeholder,
  onSend,
  autoFocus = false,
}: {
  variant?: string;
  /** the self-running walkthrough; turn off when embedding in a real surface */
  demo?: boolean;
  /** hero sizing: a multi-line input with controls on their own row */
  tall?: boolean;
  placeholder?: string;
  onSend?: (text: string, files: AttachedFile[]) => void;
  /** activates input on mount on desktop only */
  autoFocus?: boolean;
}) {
  const pill = variant === "Pill";
  const [draft, setDraft] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(0);
  const [listening, setListening] = useState(false);
  const [auto, setAuto] = useState(demo);
  const [autoStep, setAutoStep] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const wide = expanded || tall;

  /* name confirm strip — the first detected name previews its address
   * above the input so it can be confirmed before sending. Display only:
   * the server resolves again when the turn runs and never trusts the
   * address shown here. */
  const [nameFound, setNameFound] = useState<{
    raw: string;
    name: string;
    chain: "evm" | "solana";
  } | null>(null);
  const [nameAddress, setNameAddress] = useState<string | null>(null);
  const [dismissedName, setDismissedName] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- debounce sync: a new
   * draft clears the previous preview before its read starts */
  useEffect(() => {
    if (demo) return;
    if (dismissedName && !draft.toLowerCase().includes(dismissedName)) {
      setDismissedName(null);
    }
    const found = findNamesInText(draft)[0] ?? null;
    if (!found || found.name === dismissedName) {
      setNameFound(null);
      setNameAddress(null);
      return;
    }
    setNameFound((current) => {
      if (current && current.name === found.name) return current;
      return { raw: found.raw, name: found.name, chain: found.chain };
    });
    setNameAddress(null);
    let live = true;
    const timer = window.setTimeout(() => {
      void fetchNamePreview(found.raw, found.chain).then((read) => {
        if (!live) return;
        if (read.ok) {
          setNameAddress(read.address);
        } else {
          // No strip for an unregistered or unreadable name: the server
          // answers properly when the turn runs.
          setNameFound(null);
          setNameAddress(null);
        }
      });
    }, NAME_STRIP_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [demo, draft, dismissedName]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const useNameAddress = () => {
    if (!nameFound || !nameAddress) return;
    const raw = nameFound.raw;
    setDraft((current) => replaceFirstName(current, raw, nameAddress));
    setNameFound(null);
    setNameAddress(null);
    inputRef.current?.focus();
  };

  const dismissNameStrip = () => {
    if (nameFound) setDismissedName(nameFound.name);
    setNameFound(null);
    setNameAddress(null);
  };

  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [engaged, setEngaged] = useState(false);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /* hand control to the user: stop the demo loop, and when they aim at
   * the input itself, clear the demo's leftover draft for a clean start */
  const takeOver = (event: { target: EventTarget | null }) => {
    setAuto(false);
    if (auto && event.target === inputRef.current) setDraft("");
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    setAttachments((current) => {
      const next = [...current];
      for (const file of incoming) {
        if (next.length >= MAX_ATTACHMENTS) break;
        if (file.size > MAX_FILE_BYTES) continue;
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          ext: getExtension(file.name),
          size: file.size,
          type: file.type,
          url: URL.createObjectURL(file),
          kind: classifyFile(file.name, file.type),
        });
      }
      return next;
    });
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const target = current.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((a) => a.id !== id);
    });
  };

  /* revoke object URLs on unmount — read from a ref so the cleanup
   * doesn't call setState after unmount */
  const attachmentsRef = useRef<AttachedFile[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    return () => {
      for (const a of attachmentsRef.current) URL.revokeObjectURL(a.url);
    };
  }, []);

  /* desktop auto-focus on mount */
  useEffect(() => {
    if (!autoFocus || !isDesktop()) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 40);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  /* listen for programmatic composer activation (e.g. user clicked "New chat") */
  useEffect(() => {
    const handleFocus = (event: Event) => {
      if (!isDesktop()) return;
      const custom = event as CustomEvent<FocusComposerDetail>;
      if (custom.detail?.clearDraft) {
        setDraft("");
      }
      inputRef.current?.focus();
    };

    window.addEventListener(FOCUS_COMPOSER_EVENT, handleFocus);
    return () => window.removeEventListener(FOCUS_COMPOSER_EVENT, handleFocus);
  }, []);

  /* Global "begins typing something" listener on desktop.
   * If focus is lost or the user begins typing anywhere on desktop,
   * capture the keystroke, focus the composer textarea, and ensure
   * nothing is dropped or double-entered. */
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (!isDesktop()) return;
      if (event.defaultPrevented) return;

      // Handle paste shortcut (Cmd+V or Ctrl+V) when outside editable inputs
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "v" &&
        !event.altKey
      ) {
        const activeEl = document.activeElement;
        const target = event.target as Element | null;
        if (isEditableElement(target) || isEditableElement(activeEl)) return;
        if (
          document.querySelector(
            '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"]',
          )
        ) {
          return;
        }
        inputRef.current?.focus();
        return;
      }

      // Disallow any meta/ctrl/alt combinations (e.g. Cmd+R, Alt+Tab, Ctrl+C)
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Only single printable characters (letters, numbers, punctuation)
      if (event.key.length !== 1) return;

      // Ignore IME / composition states
      if (event.isComposing || event.key === "Process" || event.key === "Dead") return;

      // Check if user is already typing in an editable field
      const target = event.target as Element | null;
      const activeEl = document.activeElement;
      if (isEditableElement(target) || isEditableElement(activeEl)) return;

      // Check if an open modal, alertdialog, or menu is active
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"]',
        )
      ) {
        return;
      }

      // If Space is pressed while a button is focused, allow the button click
      if (
        event.key === " " &&
        (activeEl?.tagName === "BUTTON" || target?.tagName === "BUTTON")
      ) {
        return;
      }

      const input = inputRef.current;
      if (!input) return;

      // Prevent default to avoid scrolling on Space or double-character entry
      event.preventDefault();
      setAuto(false);

      typeToFocusComposer(input, event.key, (nextVal) => {
        setDraft(nextVal);
        setDismissed(false);
        setPlusOpen(false);
      });
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const token = dismissed ? null : parseToken(draft);
  const menu: "at" | "slash" | null = plusOpen ? "at" : token?.kind ?? null;
  const query = plusOpen ? "" : token?.query ?? "";

  const rows: { key: string; name: string; desc: string }[] =
    menu === "at"
      ? SOURCES.filter((s) => s.name.toLowerCase().includes(query))
      : menu === "slash"
        ? COMMANDS.filter((c) => c.name.slice(1).startsWith(query))
        : [];

  // A new menu or query restarts the highlight at the top, unhovered.
  // Adjusted during render — not synced in an effect — so the reset lands
  // on the same pass that produces the new rows.
  const [prevMenuQuery, setPrevMenuQuery] = useState<{
    menu: typeof menu;
    query: string;
  }>({ menu, query });
  if (prevMenuQuery.menu !== menu || prevMenuQuery.query !== query) {
    setPrevMenuQuery({ menu, query });
    setActive(0);
    setEngaged(false);
  }

  /* a single highlight glides to the active row instead of each row
   * toggling its own background — matches the gliding pill in the nav */
  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [menu, query, active, connected, rows.length]);

  /* autoplay: the step applies on the pass that selects it, and the effect
   * only advances the clock after its hold — same timing, no sync set. */
  const [appliedAutoStep, setAppliedAutoStep] = useState(-1);
  if (auto && appliedAutoStep !== autoStep) {
    setAppliedAutoStep(autoStep);
    const step = AUTO_STEPS[autoStep % AUTO_STEPS.length];
    setDraft(step.draft);
    if (step.active !== undefined) setActive(step.active);
    if (step.connect !== undefined) setConnected(step.connect);
  }
  useEffect(() => {
    if (!auto) return;
    const step = AUTO_STEPS[autoStep % AUTO_STEPS.length];
    const t = setTimeout(() => setAutoStep((s) => s + 1), step.hold);
    return () => clearTimeout(t);
  }, [auto, autoStep]);

  /* dictation resolves after a beat, like a real transcript landing */
  useEffect(() => {
    if (!listening) return;
    const t = setTimeout(() => {
      setDraft((current) => (current ? `${current.trimEnd()} ${DICTATION}` : DICTATION));
      setListening(false);
      inputRef.current?.focus();
    }, 2200);
    return () => clearTimeout(t);
  }, [listening]);

  /* Move wrapped text above the controls, then grow to a compact maximum. */
  useLayoutEffect(() => {
    const input = inputRef.current;
    const controls = controlsRef.current;
    const measure = measureRef.current;
    if (!input || !controls || !measure) return;

    const fixedControlsWidth = 28 * 3;
    const inlineGaps = 3 * 4;
    const inlineInputWidth = controls.clientWidth - fixedControlsWidth - inlineGaps;
    const needsFullWidth = draft.includes("\n") || measure.offsetWidth + 8 > inlineInputWidth;
    if (needsFullWidth !== expanded) {
      setExpanded(needsFullWidth);
    }

    const minHeight = 28;
    const maxHeight = 100;
    input.style.setProperty("height", "0px");
    const contentHeight = input.scrollHeight;
    input.style.setProperty("height", `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`);
    input.style.setProperty("overflow-y", contentHeight > maxHeight ? "auto" : "hidden");
  }, [draft, expanded]);

  /* clicking anywhere outside the composer closes the plus menu */
  useEffect(() => {
    if (!plusOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-promptbar]")) {
        setPlusOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [plusOpen]);

  const closeMenus = () => {
    setPlusOpen(false);
  };

  const pick = (row: { key: string; name: string }) => {
    const source = SOURCES.find((s) => s.key === row.key);
    if (source?.attach) {
      if (token) setDraft(draft.slice(0, token.start));
      setPlusOpen(false);
      setDismissed(false);
      openFilePicker();
      return;
    } else if (menu === "at") {
      setDraft(`${token ? draft.slice(0, token.start) : draft}@${row.name} `);
    } else {
      setDraft(`${token ? draft.slice(0, token.start) : draft}${row.name} `);
    }
    setPlusOpen(false);
    setDismissed(false);
    inputRef.current?.focus();
  };

  const canSend = draft.trim().length > 0 || attachments.length > 0;
  const send = () => {
    if (!canSend) return;
    const text = draft.trim();
    onSend?.(text, attachments);
    for (const a of attachments) URL.revokeObjectURL(a.url);
    setDraft("");
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    closeMenus();

    if (isDesktop()) {
      inputRef.current?.focus();
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  };

  return (
    <div
      data-promptbar
      className={demo ? "flex min-h-[384px] w-full max-w-105 flex-col justify-end pb-8" : "w-full"}
      onPointerDownCapture={takeOver}
      onKeyDownCapture={takeOver}
    >
      {/* composer is the anchor — menus grow up from its top edge */}
      <div ref={composerAnchorRef} className="relative">
      {/* ── @ / slash menu ─────────────────────────────── */}
      {menu && (
        <div
          onMouseLeave={() => setEngaged(false)}
          className="absolute inset-x-0 bottom-full z-10 mb-2 rounded-[10px] bg-surface p-1 shadow-raised"
          style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}
        >
          {/* single gliding highlight — appears once a row is hovered */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
            style={{
              top: rowBox?.top ?? 0,
              height: rowBox?.height ?? 0,
              opacity: rowBox && engaged && rows.length > 0 ? 1 : 0,
              transition:
                "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
            }}
          />
          {rows.map((row, i) => {
            const source = menu === "at" ? SOURCES.find((s) => s.key === row.key) : undefined;
            return (
              <button
                key={row.key}
                type="button"
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  setActive(i);
                  setEngaged(true);
                }}
                onClick={() => pick(row)}
                className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
              >
                {source && (
                  <span className="flex size-5.5 shrink-0 items-center justify-center text-ink-2">
                    {source.brand ? BRANDS[source.brand] : <Icon size={15}>{GLYPHS[source.glyph ?? "clip"]}</Icon>}
                  </span>
                )}
                <span className="shrink-0 text-[12.5px] font-medium text-ink">
                  {row.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{row.desc}</span>
                {source?.connect && (
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation();
                      setConnected((current) => !current);
                    }}
                    className={`shrink-0 text-[12px] font-medium transition-colors duration-100 ${
                      connected ? "text-green" : "text-accent-ink hover:underline"
                    }`}
                  >
                    {connected ? "Connected" : "Connect"}
                  </span>
                )}
              </button>
            );
          })}
          {rows.length === 0 && (
            <div className="flex h-9 items-center px-2 text-[12px] text-ink-3">
              No matches for “{query}”
            </div>
          )}
          <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-3">
            {menu === "at" ? "Type to search sources & files" : "Type to search commands"}
          </div>
        </div>
      )}

      {/* ── composer ───────────────────────────────────── */}
      <div
        className={`relative isolate flex flex-col overflow-hidden border border-line bg-surface shadow-card transition-[border-color,border-radius] duration-150 focus-within:border-line-strong ${
          tall ? "gap-2.5 p-3.5" : "gap-1.5 p-1.5"
        } ${
          pill ? (attachments.length > 0 || wide ? "rounded-[24px]" : "rounded-full") : tall ? "rounded-[22px]" : "rounded-[14px]"
        }`}
      >
        <span
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none absolute invisible whitespace-pre text-[13px] leading-[18px]"
        >
          {draft}
        </span>

        {attachments.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 pt-0.5 ${pill ? "px-1" : "px-0.5"}`}>
            {attachments.map((file) => (
              <span
                key={file.id}
                className={`flex h-6.5 items-center gap-1.5 bg-field py-1 pr-1 pl-1.5 text-[11.5px] text-ink-2 shadow-hairline ${
                  pill ? "rounded-full" : "rounded-chip"
                }`}
                style={{ animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both" }}
              >
                <AttachmentThumb file={file} />
                <span className="max-w-36 truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => removeAttachment(file.id)}
                  className={`-my-1 flex size-6 items-center justify-center text-ink-3 transition-colors duration-100 hover:bg-line/70 hover:text-ink ${
                    pill ? "rounded-full" : "rounded-[5px]"
                  }`}
                >
                  <Icon size={10} strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12" /></Icon>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* real file picker — opened from the + menu's Add photos & files row */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            addFiles(event.target.files ?? []);
            event.target.value = "";
          }}
        />

        {/* name confirm strip — the detected name with its previewed
            address, above the input. Use swaps the address into the draft;
            Dismiss hides the strip until the name is retyped. */}
        {nameFound ? (
          <div
            role="status"
            className="flex items-center gap-2 px-1"
            style={{ animation: "fade-in 180ms ease-out both" }}
          >
            {nameAddress ? (
              <>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
                  {nameFound.name} → {shortAddr(nameAddress)}
                </span>
                <button
                  type="button"
                  onClick={useNameAddress}
                  className="shrink-0 rounded-full bg-ink px-2.5 py-1 text-[11.5px] font-medium text-surface transition-transform duration-150 active:scale-[0.96]"
                >
                  Use
                </button>
                <button
                  type="button"
                  onClick={dismissNameStrip}
                  className="shrink-0 rounded-full px-2 py-1 text-[11.5px] font-medium text-ink-3 transition-colors duration-100 hover:text-ink"
                >
                  Dismiss
                </button>
              </>
            ) : (
              <span className="text-[12.5px] text-ink-3">
                Resolving {nameFound.name}.
              </span>
            )}
          </div>
        ) : null}

        <div
          ref={controlsRef}
          className="grid grid-cols-[28px_minmax(0,1fr)_28px_28px] items-end gap-x-1 gap-y-1.5"
        >
          <button
            type="button"
            aria-label="Add attachments and sources"
            aria-expanded={plusOpen}
            onClick={() => {
              setPlusOpen((current) => !current);
              inputRef.current?.focus();
            }}
            className={`flex size-7 shrink-0 items-center justify-center justify-self-start text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94] ${
              pill ? "rounded-full" : "rounded-[8px]"
            } ${plusOpen ? "bg-hover text-ink" : ""} ${wide ? "col-start-1 row-start-2" : "col-start-1 row-start-1"}`}
          >
            <Icon size={16} strokeWidth={2}><path d="M12 5v14M5 12h14" /></Icon>
          </button>

          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setDismissed(false);
              setPlusOpen(false);
            }}
            onKeyDown={(event) => {
              if (menu && rows.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setEngaged(true);
                  setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
                  return;
                }
                if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                  event.preventDefault();
                  pick(rows[active]);
                  return;
                }
              }
              if (event.key === "Escape") {
                setDismissed(true);
                closeMenus();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={listening ? "Listening…" : placeholder ?? "Write a message…"}
            aria-label="Prompt"
            className={`${tall ? "min-h-[68px] px-2 py-2 text-[14px] leading-5" : "min-h-7 px-1 py-[5px] text-[13px] leading-[18px]"} scroll-slim min-w-0 w-full resize-none bg-transparent text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3 ${
              wide ? "col-span-full col-start-1 row-start-1" : "col-start-2 row-start-1"
            }`}
          />

          {/* dictation */}
          <button
            type="button"
            aria-label={listening ? "Stop dictation" : "Start dictation"}
            aria-pressed={listening}
            onClick={() => setListening((current) => !current)}
            className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-150 active:scale-[0.94] ${
              pill ? "rounded-full" : "rounded-[8px]"
            } ${listening ? "bg-accent-tint text-accent-ink" : "text-ink-3 hover:bg-hover hover:text-ink"} ${wide ? "col-start-3 row-start-2" : "col-start-3 row-start-1"}`}
          >
            {listening ? (
              <span className="flex h-3.5 items-center gap-[2.5px]">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-[2.5px] rounded-full bg-current"
                    style={{ height: "100%", animation: `eq-bounce 900ms ease-in-out ${i * 150}ms infinite` }}
                  />
                ))}
              </span>
            ) : (
              <Icon size={15} strokeWidth={2}><g><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></g></Icon>
            )}
          </button>

          {/* send — tactile square (round in the pill variant) */}
          <button
            type="button"
            aria-label="Send"
            disabled={!canSend}
            onMouseDown={(event) => {
              if (isDesktop()) {
                // Prevent mouse down on the send button from stealing focus
                // from the textarea, which would blur to body once disabled.
                event.preventDefault();
              }
            }}
            onClick={send}
            className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] ${
              pill ? "rounded-full" : "rounded-[8px]"
            } ${wide ? "col-start-4 row-start-2" : "col-start-4 row-start-1"}`}
            style={{
              background: canSend ? "var(--ink)" : "var(--line-strong)",
              color: canSend ? "var(--surface)" : "var(--ink-2)",
            }}
          >
            <Icon size={16} strokeWidth={2.4}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
