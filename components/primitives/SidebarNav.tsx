"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  IconCheck,
  IconChevronDown,
  IconDots,
  IconHome,
  IconPencil,
  IconSearch,
  IconLayoutSidebarLeftCollapse,
  IconHistory,
  IconTrash,
  IconUserPlus,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import { focusComposer } from "@/lib/composer";
import { useHoverIntent } from "@/components/app/useHoverIntent";

/* ─────────────────────────────────────────────────────────
 * SIDEBAR NAV
 * Shared by the design-system preview and the harness shell:
 * compact workspace switcher, primary navigation, searchable
 * chat history, and a collapse that preserves icon alignment.
 * ───────────────────────────────────────────────────────── */

const NAV_ITEMS = [
  { key: "home", label: "Home", icon: <IconHome size={18} /> },
  {
    key: "invite",
    label: "Invite users",
    icon: <IconUserPlus size={18} />,
    count: "3/10",
  },
];

export type SidebarRecent = {
  id: string;
  label: string;
  prompt?: string;
};

/* Parents rebuild this list on every render (usually a `.map` over the
 * threads), so a new array identity says nothing about new content.
 * Comparing by value lets the sync effect below bail out instead of
 * scheduling a state update — and a render — for an identical list. */
function sameRecentItems(a: SidebarRecent[], b: SidebarRecent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].label !== b[i].label || a[i].prompt !== b[i].prompt)
      return false;
  }
  return true;
}

const DEFAULT_RECENTS: SidebarRecent[] = [
  { id: "suppliers", label: "Vendor records" },
  { id: "todos", label: "Urgent to-dos this morning" },
  { id: "flavor", label: "Asset page ticket" },
  { id: "workload", label: "Workload summary" },
  { id: "offboarding", label: "Off-board a vendor" },
  { id: "restock", label: "Batch restock function" },
  { id: "edits", label: "Propose asset edits" },
  { id: "subway", label: "Subway surfing" },
];

type SidebarNavProps = {
  activeTitle?: string | null;
  /** unique id of the selected chat; when set, highlight matches by id, not label */
  activeId?: string | null;
  className?: string;
  fill?: boolean;
  onNewChat?: () => void;
  onPick?: (id: string, label: string, prompt?: string) => void;
  /** controlled primary-nav selection (e.g. "home" | "invite") */
  activeNav?: string;
  onNavigate?: (key: string) => void;
  /** footer call-to-action — defaults to the demo "Upgrade" button */
  footerLabel?: string;
  footerIcon?: ReactNode;
  onFooterClick?: () => void;
  recents?: SidebarRecent[];
  /** hover intent on a chat row, for prefetching its history into cache */
  onHoverThread?: (id: string) => void;
  /** renames a saved chat from its row menu */
  onRenameChat?: (id: string, next: string) => void;
  /** moves a saved chat to trash from its row menu */
  onDeleteChat?: (id: string) => void;
  /** number of chats sitting in trash; shows the Trash shortcut */
  trashCount?: number;
  /** the Trash page is open; highlights the Trash shortcut */
  trashActive?: boolean;
  /** opens the Trash page */
  onOpenTrash?: () => void;
  /** the Portfolio page is open; highlights the Portfolio row */
  portfolioActive?: boolean;
  /** opens the Portfolio page */
  onOpenPortfolio?: () => void;
  /** the History page is open; highlights the History row */
  historyActive?: boolean;
  /** opens the History page */
  onOpenHistory?: () => void;
  /** replaces the footer button when the application needs its own control there */
  footer?: ReactNode;
  /** the icon-only footer control the rail keeps once the copy is gone */
  footerCompact?: ReactNode;
  variant?: string;
};

const SIDEBAR_MOTION = {
  // 5% wider than the original 224px. The row width in globals.css is this
  // minus the two 8px margins, and the footer matches it.
  expandedWidth: 235,
  collapsedWidth: 52,
  duration: 280,
  copyDuration: 180,
  copyOffset: 8,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

/* ─────────────────────────────────────────────────────────
 * CHAT SEARCH STORYBOARD
 *
 *   0ms   search is triggered; Chats label begins fading
 *   0ms   field grows right → left from the search control
 * 180ms   field fills the row; cursor is focused and ready
 * ───────────────────────────────────────────────────────── */
const CHAT_SEARCH_MOTION = {
  duration: 180,
  closedWidth: 28,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

/* ─────────────────────────────────────────────────────────
 * CHAT ROW MENU
 * Rename and Delete for a saved chat. The popup is measured
 * from the trigger rather than drawn inside the row, because
 * the history list clips its own overflow. It prefers the open
 * canvas right of the sidebar so it never covers sibling rows,
 * falling back to below/above the trigger on narrow viewports.
 * ───────────────────────────────────────────────────────── */
const CHAT_MENU = {
  width: 180,
  gap: 6,
  /** room a menu needs below the trigger before it flips upward */
  clearance: 132,
};

const CHAT_MENU_ITEM =
  "flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[13.5px] text-ink hover:bg-hover-2";

function RailButton({
  icon,
  label,
  active = false,
  count,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  count?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`sidebar-row relative mx-2 flex h-8 items-center rounded-[8px] px-2 text-left
        transition-[width,transform] duration-150 hover:bg-hover-2 active:scale-[0.98]
        ${active ? "bg-hover-2" : ""}`}
    >
      <span
        className={`flex size-5 shrink-0 items-center justify-center ${active ? "text-ink" : "text-ink-2"}`}
      >
        {icon}
      </span>
      <span
        className={`sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium ${active ? "text-ink" : "text-ink-2"}`}
      >
        {label}
      </span>
      {count && (
        <span className="sidebar-copy mr-2 shrink-0 text-[12px] font-medium tabular-nums text-ink-3">
          {count}
        </span>
      )}
    </button>
  );
}

export default function SidebarNav({
  activeTitle,
  activeId,
  className = "",
  fill = false,
  onNewChat,
  onPick,
  activeNav,
  onNavigate,
  footerLabel = "Upgrade",
  footerIcon,
  onFooterClick,
  recents = DEFAULT_RECENTS,
  footer,
  footerCompact,
  onHoverThread,
  onRenameChat,
  onDeleteChat,
  trashCount = 0,
  trashActive = false,
  onOpenTrash,
  portfolioActive = false,
  onOpenPortfolio,
  historyActive = false,
  onOpenHistory,
}: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [internalNav, setInternalNav] = useState("chats");
  const currentNav = activeNav ?? internalNav;
  /* The Trash shortcut is the top of the pinned system zone (Trash + footer).
   * When it shows, it carries the single hairline that separates the
   * scrolling chats above from the pinned rows below, and the footer drops
   * its own hairline so the two never stack into a double rule. */
  const showTrash = Boolean(onOpenTrash ?? trashActive);
  const showPortfolio = Boolean(onOpenPortfolio ?? portfolioActive);
  const showHistory = Boolean(onOpenHistory ?? historyActive);
  const selectNav = (key: string) => {
    setInternalNav(key);
    onNavigate?.(key);
  };
  const [demoActiveTitle, setDemoActiveTitle] = useState<string | null>(null);
  // A row must be rested on before its history is warmed. Crossing the list,
  // or a row sliding under a stationary pointer during a scroll, is not intent.
  const hoverThread = useCallback(
    (id: string) => onHoverThread?.(id),
    [onHoverThread],
  );
  const hoverIntent = useHoverIntent(hoverThread);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chatsOpen, setChatsOpen] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  /* row menu */
  const canManage = Boolean(onRenameChat || onDeleteChat);
  const [menu, setMenu] = useState<{
    id: string;
    top: number;
    left: number;
    above: boolean;
    side: "right" | "below";
  } | null>(null);
  /* The Delete row arms itself into Confirm in place: same button, same menu
   * height, so nothing around it shifts. A second press confirms. */
  const [armedDelete, setArmedDelete] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  /* Optimistic labels paint the new name the moment Enter is pressed,
   * while the PATCH + refetch settle in the background. Each entry keeps
   * the server label it replaced, so it clears as soon as the incoming
   * list moves — to the new name on success, or back on a failed write. */
  const [optimisticLabels, setOptimisticLabels] = useState<
    Record<string, { next: string; base: string | null }>
  >({});
  /* Rows collapsing out of the list, mirroring the insert keyframes in
   * reverse. A set (not a single id) so back-to-back deletes each hold
   * their own row through the collapse. Entries clear once the list
   * stops containing the row. */
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const exitTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /* newly persisted chat: the row grows from 0 to full height so the rows
   * below it glide down instead of jumping. Cleared once the keyframes end. */
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const prevIdsRef = useRef<string[] | null>(null);
  const [displayedRecents, setDisplayedRecents] = useState(recents);
  const [isExitingAll, setIsExitingAll] = useState(false);
  const [isEnteringAll, setIsEnteringAll] = useState(false);
  const exitAllTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterAllTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (exitAllTimerRef.current) clearTimeout(exitAllTimerRef.current);
      if (enterAllTimerRef.current) clearTimeout(enterAllTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const ids = recents.map((item) => item.id);
    const prevIds = prevIdsRef.current;
    prevIdsRef.current = ids;

    if (prevIds === null) {
      setDisplayedRecents(recents);
      return;
    }

    // Sign out / clearing all: previous list had items, now empty
    if (prevIds.length > 0 && recents.length === 0) {
      const reduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        setDisplayedRecents([]);
        setIsExitingAll(false);
        return;
      }
      setIsExitingAll(true);
      if (exitAllTimerRef.current) clearTimeout(exitAllTimerRef.current);
      const exitDuration = 275 + Math.min(prevIds.length, 8) * 25;
      exitAllTimerRef.current = setTimeout(() => {
        setDisplayedRecents([]);
        setIsExitingAll(false);
        exitAllTimerRef.current = null;
      }, exitDuration);
      return;
    }

    // Sign in / bulk entrance: previous was empty, now has items
    if (prevIds.length === 0 && recents.length > 0) {
      if (exitAllTimerRef.current) {
        clearTimeout(exitAllTimerRef.current);
        exitAllTimerRef.current = null;
      }
      setIsExitingAll(false);
      setDisplayedRecents(recents);
      setIsEnteringAll(true);
      if (enterAllTimerRef.current) clearTimeout(enterAllTimerRef.current);
      const enterDuration = 275 + Math.min(recents.length, 8) * 25;
      enterAllTimerRef.current = setTimeout(() => {
        setIsEnteringAll(false);
        enterAllTimerRef.current = null;
      }, enterDuration);
      return;
    }

    // Normal update (single item added or renamed). The guard skips the
    // common no-op: a fresh array with the same rows must not schedule
    // an update, or every parent render becomes a sidebar render.
    setDisplayedRecents((prev) =>
      sameRecentItems(prev, recents) ? prev : recents,
    );
    const prev = new Set(prevIds);
    const added = ids.find((id) => !prev.has(id));
    if (added && ids.length === prevIds.length + 1) {
      setEnteringId(added);
      const timer = setTimeout(() => setEnteringId(null), 350);
      return () => clearTimeout(timer);
    }
  }, [recents]);

  // Direct sign-out event listener: start reverse cascade animation immediately
  useEffect(() => {
    const onSignOut = () => {
      if (displayedRecents.length === 0) return;
      setIsExitingAll(true);
      if (exitAllTimerRef.current) clearTimeout(exitAllTimerRef.current);
      const exitDuration = 275 + Math.min(displayedRecents.length, 8) * 25;
      exitAllTimerRef.current = setTimeout(() => {
        setDisplayedRecents([]);
        setIsExitingAll(false);
        exitAllTimerRef.current = null;
      }, exitDuration);
    };

    window.addEventListener("myntle:sign-out", onSignOut);
    return () => window.removeEventListener("myntle:sign-out", onSignOut);
  }, [displayedRecents.length]);

  const selectedTitle =
    activeTitle === undefined ? demoActiveTitle : activeTitle;
  // Drop an optimistic label once the server list moves past the label it
  // replaced — to the new name on success, or back on a failed write — so
  // a retry never sticks a stale name on screen.
  useEffect(() => {
    setOptimisticLabels((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        const server = recents.find((item) => item.id === id)?.label ?? null;
        if (server !== prev[id].base) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [recents]);
  const visibleRecents = displayedRecents
    .map((item) =>
      optimisticLabels[item.id]
        ? { ...item, label: optimisticLabels[item.id].next }
        : item,
    )
    .filter((item) =>
      item.label.toLowerCase().includes(query.trim().toLowerCase()),
    );

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const closeMenu = () => {
    setMenu(null);
    setArmedDelete(false);
  };

  const toggleChats = () => {
    // The menu floats over the list, so it cannot stay open while the rows
    // it belongs to unmount.
    if (chatsOpen) closeMenu();
    setChatsOpen(!chatsOpen);
  };

  // A collapsed rail has no room for a popup trigger, and the row it was
  // anchored to is 36px wide.
  useEffect(() => {
    if (!collapsed) return;
    setMenu(null);
    setArmedDelete(false);
    setRenamingId(null);
  }, [collapsed]);

  // Dismiss on an outside press, Escape, resize, or any scroll: the popup is
  // fixed to the viewport, so a scroll or resize would leave it behind the
  // row it belongs to.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      if ((event.target as Element | null)?.closest("[data-chat-actions]"))
        return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
      menuTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menu]);

  // Focus the first item on open. The armed Confirm keeps focus where it
  // is: the same button morphs in place, so moving focus would fight it.
  useEffect(() => {
    if (!menu) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>("[role='menuitem']")
      ?.focus();
  }, [menu]);

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>, id: string) => {
    event.stopPropagation();
    if (menu?.id === id) {
      closeMenu();
      return;
    }
    menuTriggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const above = rect.bottom + CHAT_MENU.clearance > window.innerHeight;
    // Prefer the open canvas to the right of the sidebar: the menu then
    // floats over the main pane instead of covering the rows below the
    // trigger. Fall back to the below/above placement only when the
    // viewport is too narrow for the menu to fit on the right.
    const fitsRight =
      window.innerWidth - rect.right >= CHAT_MENU.width + CHAT_MENU.gap + 8;
    setArmedDelete(false);
    if (fitsRight) {      setMenu({
        id,
        left: rect.right + CHAT_MENU.gap,
        // Beside the row: the top edge aligns with the row, or the bottom
        // edge when flipped near the viewport bottom (translateY(-100%)
        // anchors the bottom at `top`).
        top: above ? rect.bottom : rect.top,
        above,
        side: "right",
      });
      return;
    }
    const left = Math.min(
      Math.max(rect.right - CHAT_MENU.width, 8),
      window.innerWidth - CHAT_MENU.width - 8,
    );
    setMenu({
      id,
      left,
      above,
      top: above ? rect.top - CHAT_MENU.gap : rect.bottom + CHAT_MENU.gap,
      side: "below",
    });
  };

  const startRename = (id: string, label: string) => {
    closeMenu();
    setRenameDraft(label);
    setRenamingId(id);
  };

  const commitRename = (id: string) => {
    // Escape clears the id first, so a late blur cannot save the draft.
    if (renamingId !== id) return;
    const next = renameDraft.replace(/\s+/g, " ").trim();
    setRenamingId(null);
    if (!next) return;
    const serverLabel =
      displayedRecents.find((item) => item.id === id)?.label ??
      recents.find((item) => item.id === id)?.label ??
      "";
    const current = (optimisticLabels[id]?.next ?? serverLabel)
      .replace(/\s+/g, " ")
      .trim();
    if (current && next === current) return;
    // Paint instantly; the server write + refetch happen behind it.
    setOptimisticLabels((prev) => ({
      ...prev,
      [id]: { next, base: serverLabel },
    }));
    onRenameChat?.(id, next);
  };

  const deleteChat = (id: string) => {
    if (exitingIds.has(id)) return;
    closeMenu();
    // Hold the row through the collapse, then hand it to the application.
    // Each id owns its timer so a second delete never cancels the first.
    // The list update unmounts the row; the effect below clears an id the
    // list drops, and the safety timer glides back a row a failed request
    // leaves behind — all without any list refetch.
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      onDeleteChat?.(id);
      return;
    }
    setExitingIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const timer = setTimeout(() => {
      exitTimerRef.current.delete(id);
      onDeleteChat?.(id);
      // Safety: a failed delete never drops the row from the list, so
      // release the collapse and let it glide back instead of sticking.
      const safety = setTimeout(() => {
        exitTimerRef.current.delete(id);
        setExitingIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 4000);
      exitTimerRef.current.set(id, safety);
    }, 275);
    exitTimerRef.current.set(id, timer);
  };

  useEffect(() => {
    if (exitingIds.size === 0) return;
    const gone = [...exitingIds].filter(
      (id) => !recents.some((item) => item.id === id),
    );
    if (gone.length === 0) return;
    for (const id of gone) {
      const timer = exitTimerRef.current.get(id);
      if (timer) clearTimeout(timer);
      exitTimerRef.current.delete(id);
    }
    setExitingIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of gone) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [recents, exitingIds]);

  useEffect(
    () => () => {
      for (const timer of exitTimerRef.current.values()) clearTimeout(timer);
      exitTimerRef.current.clear();
    },
    [],
  );

  const collapse = () => {
    setCollapsed(true);
    setSearchOpen(false);
    setQuery("");
  };

  /* `skullet-ignore` is inert in the app. It tells the skeleton measurer to
   * keep the element's layout but draw no bone for it: the brand mark, the
   * collapse control and the chat search are chrome, not content, and a bone
   * for each one reads as a skeleton inside a skeleton. */
  return (
    <aside
      data-sidebar-collapsed={collapsed}
      aria-label="Workspace navigation"
      className={`relative flex shrink-0 overflow-hidden transition-[width] ${fill ? "h-full" : "h-[600px]"} ${className}`}
      style={
        {
          width: collapsed
            ? SIDEBAR_MOTION.collapsedWidth
            : SIDEBAR_MOTION.expandedWidth,
          transitionDuration: `${SIDEBAR_MOTION.duration}ms`,
          transitionTimingFunction: SIDEBAR_MOTION.easing,
          "--sidebar-copy-duration": `${SIDEBAR_MOTION.copyDuration}ms`,
          "--sidebar-copy-offset": `${SIDEBAR_MOTION.copyOffset}px`,
          "--sidebar-easing": SIDEBAR_MOTION.easing,
        } as CSSProperties
      }
    >
      <div className="flex min-h-0 w-[235px] shrink-0 flex-col">
        <div className="relative mb-2.5 h-10 shrink-0">
          <div
            aria-hidden={collapsed}
            className="sidebar-logo absolute left-4 top-1 flex h-8 items-center"
          >
            <img
              src="/myntle-logo.svg"
              alt="Myntle"
              className="h-[31px] w-auto"
              {...{ "skullet-ignore": "" }}
            />
          </div>

          <button
            type="button"
            aria-label="Collapse sidebar"
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : 0}
            onClick={collapse}
            className="sidebar-collapse-control absolute right-2 top-1 flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
            {...{ "skullet-ignore": "" }}
          >
            <IconLayoutSidebarLeftCollapse size={18} />
          </button>
          <button
            type="button"
            aria-label="Expand sidebar"
            aria-hidden={!collapsed}
            tabIndex={collapsed ? 0 : -1}
            onClick={() => setCollapsed(false)}
            className="sidebar-expand-control absolute left-2 top-0.5 flex size-9 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
            {...{ "skullet-ignore": "" }}
          >
            <IconLayoutSidebarLeftCollapse size={18} className="rotate-180" />
          </button>
        </div>

        <div className="flex flex-col gap-px">
          <RailButton
            icon={<IconPencil size={18} />}
            label="New chat"
            onClick={() => {
              if (activeTitle === undefined) setDemoActiveTitle(null);
              selectNav("chats");
              onNewChat?.();
              focusComposer({ clearDraft: true });
            }}
          />
          {NAV_ITEMS.map((item) => (
            <RailButton
              key={item.key}
              icon={item.icon}
              label={item.label}
              count={item.count}
              active={currentNav === item.key}
              onClick={() => selectNav(item.key)}
            />
          ))}
          {showPortfolio && (
            <RailButton
              icon={<IconWallet size={18} />}
              label="Portfolio"
              active={portfolioActive}
              onClick={() => onOpenPortfolio?.()}
            />
          )}
          {showHistory && (
            <RailButton
              icon={<IconHistory size={18} />}
              label="History"
              active={historyActive}
              onClick={() => onOpenHistory?.()}
            />
          )}
        </div>

        {/* The scroll region is bracketed by hairlines: this one above, the
            Trash one below. The border sits on the scroll container itself so
            it stays put while the rows move, and the Chats header sticks to
            it while rows slide underneath on the canvas background. */}
        <div
          className="sidebar-chats scroll-slim mt-2 min-h-0 flex-1 overflow-y-auto border-t border-line pt-2"
          aria-hidden={collapsed}
          inert={collapsed}
        >
          <div className="sidebar-copy sticky top-0 z-10 mx-2 h-8 bg-canvas pb-1">
            <button
              type="button"
              aria-hidden={searchOpen}
              tabIndex={searchOpen ? -1 : 0}
              aria-label={chatsOpen ? "Collapse chat list" : "Expand chat list"}
              aria-expanded={chatsOpen}
              onClick={toggleChats}
              className={`absolute inset-0 flex items-center gap-1.5 rounded-[8px] px-2 text-left text-[12.5px] font-medium text-ink-3 transition-[opacity,transform,background-color] hover:bg-hover-2 ${searchOpen ? "pointer-events-none -translate-x-1 opacity-0" : "translate-x-0 opacity-100"}`}
              style={{
                transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`,
                transitionTimingFunction: CHAT_SEARCH_MOTION.easing,
              }}
            >
              <IconChevronDown
                size={16}
                className={`shrink-0 transition-transform duration-150 ${chatsOpen ? "" : "-rotate-90"}`}
                {...{ "skullet-ignore": "" }}
              />
              <span>Chats</span>
            </button>

            <button
              type="button"
              aria-label="Search chats"
              aria-expanded={searchOpen}
              onClick={() => {
                // Searching a hidden list shows nothing, so expand first.
                setChatsOpen(true);
                setSearchOpen(true);
              }}
              className={`absolute right-0 top-0 z-10 flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color,transform] hover:bg-hover-2 hover:text-ink active:scale-[0.96] ${searchOpen ? "pointer-events-none opacity-0" : "opacity-100"}`}
              style={{ transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms` }}
              {...{ "skullet-ignore": "" }}
            >
              <IconSearch size={16} />
            </button>

            <div
              className={`absolute right-0 top-0 z-20 flex h-8 items-center overflow-hidden rounded-[8px] bg-field text-ink-3 shadow-hairline transition-[width,opacity] focus-within:text-ink-2 ${searchOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
              style={{
                width: searchOpen ? "100%" : CHAT_SEARCH_MOTION.closedWidth,
                transitionDuration: `${CHAT_SEARCH_MOTION.duration}ms`,
                transitionTimingFunction: CHAT_SEARCH_MOTION.easing,
              }}
              {...{ "skullet-ignore": "" }}
            >
              <span className="ml-2 flex shrink-0 items-center justify-center">
                <IconSearch size={15} />
              </span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchOpen(false);
                    setQuery("");
                  }
                }}
                placeholder="Search chats"
                aria-label="Search chat history"
                className="ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
              <button
                type="button"
                aria-label="Close chat search"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
                className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]"
              >
                <IconX size={16} />
              </button>
            </div>
          </div>

          {chatsOpen && (
            <div className="flex flex-col gap-px">
              {visibleRecents.map((item, index) => {
                const active =
                  activeId != null
                    ? item.id === activeId
                    : item.label === selectedTitle;
                const menuOpen = menu?.id === item.id;
                const renaming = renamingId === item.id;
                const isEntering = item.id === enteringId || isEnteringAll;
                const isExiting = exitingIds.has(item.id) || isExitingAll;
                return (
                  <div
                    key={item.id}
                    role="none"
                    onPointerEnter={(event) =>
                      hoverIntent.enter(item.id, event.pointerType)
                    }
                    onPointerLeave={() => hoverIntent.leave(item.id)}
                    style={
                      isExitingAll
                        ? {
                            animationDelay: `${index * 25}ms`,
                            animationFillMode: "both",
                          }
                        : isEnteringAll
                          ? {
                              animationDelay: `${index * 25}ms`,
                              animationFillMode: "both",
                            }
                          : undefined
                    }
                    className={`sidebar-row group/chat relative mx-2 h-8 rounded-[8px] transition-[width,background-color] duration-150 ${
                      renaming
                        ? ""
                        : active || menuOpen
                          ? "bg-hover-2"
                          : "hover:bg-hover-2 active:bg-hover-2 focus-within:bg-hover-2"
                    }${isEntering ? " sidebar-chat-enter" : ""}${isExiting ? " sidebar-chat-exit" : ""}`}
                  >
                    {renaming ? (
                      <>
                        <input
                          autoFocus
                          ref={(el) => {
                            el?.select();
                          }}
                          value={renameDraft}
                          onChange={(event) =>
                            setRenameDraft(event.target.value)
                          }
                          onBlur={() => commitRename(item.id)}
                          onFocus={(event) => event.currentTarget.select()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitRename(item.id);
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setRenamingId(null);
                            }
                          }}
                          maxLength={84}
                          aria-label="Chat name"
                          className="h-full w-full rounded-[8px] bg-field py-0 pl-2 pr-8 text-[14px] font-medium text-ink outline-none"
                        />
                        <button
                          type="button"
                          aria-label={`Save name for ${item.label}`}
                          onClick={() => commitRename(item.id)}
                          className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-[6px] text-ink-2 transition-colors duration-100 hover:text-ink"
                        >
                          <IconCheck size={16} stroke={2} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        title={item.label}
                        onClick={() => {
                          // The click is the read. A dwell timer still
                          // pending for this row must not fire after it.
                          hoverIntent.cancel();
                          selectNav("chats");
                          if (activeTitle === undefined)
                            setDemoActiveTitle(item.label);
                          onPick?.(item.id, item.label, item.prompt);
                        }}
                        className={`flex h-full w-full items-center rounded-[8px] px-2 text-left transition-colors duration-150 group-hover/chat:bg-hover-2 group-focus-within/chat:bg-hover-2 ${active || menuOpen ? "bg-hover-2" : ""}`}
                      >
                        <span
                          className={`sidebar-copy sidebar-label-fade min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[14px] font-medium ${active ? "text-ink" : "text-ink-2"}`}
                        >
                          {item.label}
                        </span>
                      </button>
                    )}

                    {canManage && !renaming && (
                      <div
                        className={`sidebar-actions-overlay absolute inset-y-0 right-0 flex w-14 items-center justify-end rounded-r-[8px] pr-1.5 pointer-events-none ${
                          menuOpen
                            ? "opacity-100"
                            : "opacity-0 group-hover/chat:opacity-100 group-focus-within/chat:opacity-100"
                        }`}
                      >
                        <button
                          type="button"
                          data-chat-actions
                          aria-label={`Chat actions for ${item.label}`}
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          onClick={(event) => openMenu(event, item.id)}
                          className={`pointer-events-auto flex size-6 items-center justify-center rounded-[6px] transition-colors duration-100 focus-visible:outline-none ${
                            menuOpen
                              ? "text-ink"
                              : "text-ink-3 hover:text-ink focus-visible:text-ink"
                          }`}
                        >
                          <IconDots size={16} stroke={1.9} />
                        </button>
                      </div>
                    )}

                    {menuOpen && menu && (
                      <div
                        className="fixed z-50"
                        style={{
                          top: menu.top,
                          left: menu.left,
                          transform: menu.above
                            ? "translateY(-100%)"
                            : undefined,
                        }}
                      >
                        <div
                          ref={menuRef}
                          role="menu"
                          aria-label={`Actions for ${item.label}`}
                          className="w-[180px] rounded-[14px] bg-surface p-1.5 shadow-overlay"
                          style={{
                            animation:
                              "pop-in 160ms cubic-bezier(0.23,1,0.32,1) both",
                            transformOrigin:
                              menu.side === "right"
                                ? menu.above
                                  ? "bottom left"
                                  : "top left"
                                : menu.above
                                  ? "bottom right"
                                  : "top right",
                          }}
                        >
                          {onRenameChat && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => startRename(item.id, item.label)}
                              className={CHAT_MENU_ITEM}
                            >
                              <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
                                <IconPencil size={16} stroke={1.8} />
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                Rename
                              </span>
                            </button>
                          )}
                          {onDeleteChat && (
                            <button
                              type="button"
                              role="menuitem"
                              aria-label={
                                armedDelete
                                  ? `Confirm deletion of ${item.label}`
                                  : `Delete ${item.label}`
                              }
                              onClick={() =>
                                armedDelete
                                  ? deleteChat(item.id)
                                  : setArmedDelete(true)
                              }
                              className={`chat-menu-morph flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[13.5px] active:scale-[0.98] ${
                                armedDelete
                                  ? "is-armed bg-red text-white hover:bg-red"
                                  : "text-red hover:bg-hover-2"
                              }`}
                            >
                              <span className="flex size-5 shrink-0 items-center justify-center">
                                <IconTrash size={16} stroke={1.8} />
                              </span>
                              <span className="relative min-w-0 flex-1">
                                <span
                                  className={`chat-menu-label truncate ${armedDelete ? "is-exiting" : ""}`}
                                >
                                  Delete
                                </span>
                                <span
                                  className={`chat-menu-label absolute inset-0 truncate ${armedDelete ? "" : "is-exiting"}`}
                                >
                                  Confirm
                                </span>
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {query && visibleRecents.length === 0 && (
                <div className="sidebar-copy mx-2 px-2 py-2 text-[12.5px] text-ink-3">
                  No chats found
                </div>
              )}
            </div>
          )}

        </div>

        {showTrash && (
          <div
            className="sidebar-trash relative mx-2 mb-1 mt-2 shrink-0 border-t border-line pt-2 [&_.sidebar-row]:mx-0"
            aria-hidden={collapsed}
            inert={collapsed}
          >
            <RailButton
              icon={<IconTrash size={18} />}
              label="Trash"
              active={trashActive}
              count={trashCount > 0 ? String(trashCount) : undefined}
              onClick={() => onOpenTrash?.()}
            />
          </div>
        )}

        <div
          className={`sidebar-foot relative mx-2 shrink-0 border-t pb-1.5 ${showTrash ? "mt-1 border-transparent pt-2" : "mt-3 border-line pt-3"}`}
        >
          <div
            className="sidebar-copy w-[219px]"
            aria-hidden={collapsed}
            inert={collapsed}
          >
            {footer ?? (
              <button
                type="button"
                onClick={() => {
                  if (onFooterClick) onFooterClick();
                  else {
                    onNewChat?.();
                    focusComposer({ clearDraft: true });
                  }
                }}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-control bg-hover-2 text-[12.5px] font-medium text-ink transition-[background-color,transform] duration-150 hover:bg-line-strong active:scale-[0.98]"
              >
                {footerIcon}
                {footerLabel}
              </button>
            )}
          </div>

          {footerCompact ? (
            <div
              className="sidebar-rail-foot absolute inset-x-0 top-3 flex h-8 items-center justify-center"
              aria-hidden={!collapsed}
              inert={!collapsed}
            >
              {footerCompact}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
