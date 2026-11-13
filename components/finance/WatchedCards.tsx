"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  IconCheck,
  IconCircleCheck,
  IconCircleCheckFilled,
  IconCopy,
  IconDots,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconQrcode,
  IconTrash,
} from "@tabler/icons-react";
import { AddressQrDialog } from "@/components/app/AddressQrDialog";
import { truncateTechData } from "@/components/atoms/TechDataChip";
import NetworkIcon from "@/components/finance/NetworkIcon";
import type { WatchChain } from "@/lib/wallet/addresses";

/* ─────────────────────────────────────────────────────────
 * WATCHED CARDS
 * One card per watched address, scrolling sideways instead of
 * pushing the holdings down. The title row carries the name
 * with a static kebab; rename and delete live in its menu,
 * which is measured from the trigger like the sidebar's chat
 * row menu — the cards row clips its own overflow, so a menu
 * drawn inside a card would be cut off. The pill below
 * carries the network mark, the middle-truncated address, and
 * the copy mark hugging it. The hollow slot at the end tracks
 * another. Selection is the thin accent ring plus the wash,
 * the same pairing the records table uses for a selected row;
 * anything but the icon buttons selects the card.
 * ───────────────────────────────────────────────────────── */

/* Measured from the trigger, like CHAT_MENU in SidebarNav. */
const CARD_MENU = {
  width: 160,
  gap: 6,
  /** room a menu needs below the trigger before it flips upward */
  clearance: 96,
};

const CARD_MENU_ITEM =
  "flex h-8 w-full items-center gap-1 rounded-[8px] px-1.5 text-left text-[13px] text-ink hover:bg-hover-2";

export type WatchedCardEntry = {
  id: string;
  chain: WatchChain;
  address: string;
  label: string | null;
  /** The default a fresh visit opens to; at most one per list. */
  isDefault: boolean;
  /** The normalized name the row was tracked from, if any. */
  resolvedName?: string | null;
  /** Fresh ISO UTC from the read that stored the name, if any. */
  resolvedAt?: string | null;
};

const CHAIN_ICON: Record<WatchChain, string> = {
  evm: "ethereum",
  solana: "solana",
  near: "near",
};

function entryLabel(entry: WatchedCardEntry): string {
  return (
    entry.label ??
    entry.resolvedName ??
    truncateTechData(entry.address, entry.chain)
  );
}

/* Clipboard with a legacy fallback: `navigator.clipboard` is undefined
 * outside secure contexts, where the optional chain alone throws before
 * any feedback runs. The check only shows on real success. */
async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function CopyMark({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy address"}
      title={copied ? "Copied" : "Copy address"}
      onClick={(e) => {
        e.stopPropagation();
        void copyText(value).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex size-[22px] shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
    >
      {copied ? (
        <IconCheck size={12} className="text-green" aria-hidden />
      ) : (
        <IconCopy size={12} aria-hidden />
      )}
    </button>
  );
}

export function WatchedCards({
  entries,
  selectedId,
  onSelect,
  onEdit,
  onDeleteRequest,
  onAdd,
  onSetDefault,
  atLimit = false,
}: {
  entries: WatchedCardEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (entry: WatchedCardEntry, event?: React.MouseEvent) => void;
  onDeleteRequest: (entry: WatchedCardEntry) => void;
  onAdd: (event: React.MouseEvent) => void;
  /** Marks the default a fresh visit opens to. Resolves once the write
   * settles, so the menu can ride check → spinner → blue filled check. */
  onSetDefault: (entry: WatchedCardEntry, next: boolean) => void | Promise<unknown>;
  /** Five addresses at most: the hollow slot retires when full. */
  atLimit?: boolean;
}) {
  // Measured from the trigger, never drawn inside the card: the cards
  // row clips its own overflow, like the sidebar's history list.
  const [menu, setMenu] = useState<{
    id: string;
    top: number;
    left: number;
    above: boolean;
    side: "right" | "below";
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closeMenu = () => setMenu(null);

  // The QR dialog rides beside the menu, like the delete dialog rides
  // beside the cards in the tab: the menu only asks, the dialog shows.
  const [qrId, setQrId] = useState<string | null>(null);
  const qrEntry = qrId
    ? (entries.find((candidate) => candidate.id === qrId) ?? null)
    : null;

  // The set-default write stays inside the open menu through its states:
  // check → spinner while the PATCH is in flight → blue filled check
  // once the list confirms the flip. The menu never closes itself here;
  // the user dismisses it. A failed write drops back to the check.
  const [pendingDefaultId, setPendingDefaultId] = useState<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- clears the spinner once the list confirms the flip */
  useEffect(() => {
    if (!pendingDefaultId) return;
    if (entries.some((entry) => entry.id === pendingDefaultId && entry.isDefault)) {
      setPendingDefaultId(null);
      return;
    }
    const timer = window.setTimeout(() => setPendingDefaultId(null), 8000);
    return () => window.clearTimeout(timer);
  }, [entries, pendingDefaultId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const runSetDefault = (entry: WatchedCardEntry) => {
    if (pendingDefaultId || entry.isDefault) return;
    setPendingDefaultId(entry.id);
    void Promise.resolve(onSetDefault(entry, true)).then(
      () => {
        // Hold the spinner until the list confirms the flip (or the
        // safety timer above releases it).
      },
      () => setPendingDefaultId(null),
    );
  };

  // Dismiss on an outside press, Escape, resize, or any scroll: the menu
  // is fixed to the viewport, so a scroll or resize would leave it
  // behind the card it belongs to.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      if (
        (event.target as Element | null)?.closest("[data-watched-actions]")
      )
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

  // Focus the first item on open.
  useEffect(() => {
    if (!menu) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>("[role='menuitem']")
      ?.focus();
  }, [menu]);

  const openMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    entry: WatchedCardEntry,
  ) => {
    event.stopPropagation();
    if (menu?.id === entry.id) {
      closeMenu();
      return;
    }
    menuTriggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const above = rect.bottom + CARD_MENU.clearance > window.innerHeight;
    // Prefer the open canvas right of the card: the menu then floats
    // beside the card instead of covering the cards after the trigger.
    // Fall back to below/above only when the viewport is too narrow
    // for the menu to fit on the right.
    const fitsRight =
      window.innerWidth - rect.right >= CARD_MENU.width + CARD_MENU.gap + 8;
    if (fitsRight) {
      setMenu({
        id: entry.id,
        left: rect.right + CARD_MENU.gap,
        // Beside the card: the top edge aligns with the trigger, or the
        // bottom edge when flipped near the viewport bottom
        // (translateY(-100%) anchors the bottom at `top`).
        top: above ? rect.bottom : rect.top,
        above,
        side: "right",
      });
      return;
    }
    const left = Math.min(
      Math.max(rect.right - CARD_MENU.width, 8),
      window.innerWidth - CARD_MENU.width - 8,
    );
    setMenu({
      id: entry.id,
      left,
      above,
      top: above ? rect.top - CARD_MENU.gap : rect.bottom + CARD_MENU.gap,
      side: "below",
    });
  };

  return (
    // Breathing room for the ring and shadow: overflow-x-auto computes
    // overflow-y to auto, so without padding the top and left 1px rings
    // paint under the clip. The negative margin pays the padding back so
    // the row still lines up with the sections above and below it.
    // The SVG radius is what skullet reads for each icon bone, so the
    // kebab, copy, plus, and network marks never skeleton as sharp
    // squares — the same `[&_svg]` cover the app shell uses.
    <div className="-m-1 flex items-stretch gap-2 overflow-x-auto p-1 [&_svg]:rounded-[4px]">
      {entries.map((entry) => {
        const active = entry.id === selectedId;
        const label = entryLabel(entry);
        // A renamed row keeps its name on a second line, so the tracked
        // name is never lost behind a custom label. When the label is the
        // name (or there is none), the title already says it.
        const nameLine =
          entry.resolvedName && entry.resolvedName !== label
            ? entry.resolvedName
            : null;
        return (
          <div
            key={entry.id}
            onClick={() => onSelect(active ? null : entry.id)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(active ? null : entry.id);
              }
            }}
            tabIndex={0}
            aria-pressed={active}
            style={{
              // Both states carry the same two-shadow list so the ring
              // interpolates instead of popping: shadow lists of
              // different lengths flip discretely. The wash rides the
              // same curve.
              boxShadow: active
                ? "inset 0 0 0 1px var(--accent), var(--shadow-card)"
                : "inset 0 0 0 0 transparent, var(--shadow-card)",
              background: active
                ? "color-mix(in srgb, var(--accent) 7%, var(--surface))"
                : "var(--surface)",
            }}
            className="flex w-[220px] shrink-0 cursor-pointer flex-col rounded-card bg-surface p-3 shadow-card outline-none transition-[box-shadow,background-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-2 focus-visible:outline-accent"
          >
            <div className="flex min-w-0 items-center gap-1">
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                {label}
                {entry.isDefault ? (
                  <span className="font-normal text-ink-3"> · Default</span>
                ) : null}
              </p>
              {/* Static kebab: hover-revealed icon buttons were too easy
                to hit by accident on a card this small. */}
              <button
                type="button"
                data-watched-actions
                aria-label={`Card actions for ${label}`}
                aria-haspopup="menu"
                aria-expanded={menu?.id === entry.id}
                title="Card actions"
                onClick={(e) => openMenu(e, entry)}
                className={`flex size-6 shrink-0 items-center justify-center rounded-[6px] transition-colors duration-100 focus-visible:outline-none ${
                  menu?.id === entry.id
                    ? "text-ink"
                    : "text-ink-3 hover:text-ink focus-visible:text-ink"
                }`}
              >
                <IconDots size={16} stroke={1.9} aria-hidden />
              </button>
            </div>
            {nameLine ? (
              <p
                className="mt-0.5 min-w-0 truncate text-[12px] leading-relaxed text-ink-3"
                title={nameLine}
              >
                {nameLine}
              </p>
            ) : null}
            <div className="mt-2 min-w-0">
              <span
                className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-inset px-2 text-[12px] font-medium text-ink-2 shadow-btn"
                title={entry.address}
              >
                <NetworkIcon network={CHAIN_ICON[entry.chain]} size={14} />
                <span className="min-w-0 truncate">
                  {truncateTechData(entry.address, entry.chain)}
                </span>
                <CopyMark value={entry.address} />
              </span>
            </div>
          </div>
        );
      })}
      {atLimit ? null : (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Watch new address"
          className="flex w-[220px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-line-strong text-ink-3 transition-colors duration-100 hover:border-ink-3 hover:text-ink-2"
        >
          <IconPlus size={18} stroke={1.8} aria-hidden />
          <span className="text-[12.5px] font-medium">Watch new</span>
        </button>
      )}
      {menu ? (
        <MenuBody
          menu={menu}
          entries={entries}
          menuRef={menuRef}
          pendingDefaultId={pendingDefaultId}
          onEdit={(entry, event) => {
            closeMenu();
            onEdit(entry, event);
          }}
          onSetDefault={runSetDefault}
          onDelete={(entry) => {
            closeMenu();
            onDeleteRequest(entry);
          }}
          onShowQr={(entry) => {
            closeMenu();
            setQrId(entry.id);
          }}
        />
      ) : null}
      {qrEntry ? (
        <AddressQrDialog
          address={qrEntry.address}
          chain={qrEntry.chain}
          title={entryLabel(qrEntry)}
          onClose={() => setQrId(null)}
        />
      ) : null}
    </div>
  );
}

function MenuBody({
  menu,
  entries,
  menuRef,
  pendingDefaultId,
  onEdit,
  onSetDefault,
  onDelete,
  onShowQr,
}: {
  menu: { id: string; top: number; left: number; above: boolean; side: "right" | "below" };
  entries: WatchedCardEntry[];
  menuRef: RefObject<HTMLDivElement | null>;
  /** The card whose default write is in flight; its row spins. */
  pendingDefaultId: string | null;
  onEdit: (entry: WatchedCardEntry, event?: React.MouseEvent) => void;
  onSetDefault: (entry: WatchedCardEntry) => void;
  onDelete: (entry: WatchedCardEntry) => void;
  onShowQr: (entry: WatchedCardEntry) => void;
}) {
  const entry = entries.find((candidate) => candidate.id === menu.id);
  if (!entry) return null;
  // The default write rides inside the open menu: idle check, then a
  // spinner while the write is in flight, then the blue filled check the
  // confirmed default row carries. The icon swaps with the menu's own
  // pop so the change reads as a morph, not a cut.
  const saving = pendingDefaultId === entry.id && !entry.isDefault;
  const defaulted = entry.isDefault;
  const defaultDisabled = defaulted || saving;
  // Portal it: the cards sit inside the portfolio's entrance wrapper, and
  // a transformed ancestor turns `fixed` into coordinates relative to
  // itself — which parked the menu far from the kebab that opened it.
  return createPortal(
    <div
      className="fixed z-50"
      style={{
        top: menu.top,
        left: menu.left,
        transform: menu.above ? "translateY(-100%)" : undefined,
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Actions for ${entryLabel(entry)}`}
        className="w-[160px] rounded-[12px] bg-surface p-1 shadow-overlay"
        style={{
          animation: "pop-in 160ms cubic-bezier(0.23,1,0.32,1) both",
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
        <button
          type="button"
          role="menuitem"
          onClick={(e) => onEdit(entry, e)}
          className={CARD_MENU_ITEM}
        >
          <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
            <IconPencil size={15} stroke={1.8} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate">Edit</span>
        </button>
        <button
          type="button"
          role="menuitem"
          aria-label={defaulted ? "Default address" : "Set as default"}
          aria-disabled={defaultDisabled || undefined}
          disabled={defaultDisabled}
          onClick={saving ? undefined : () => onSetDefault(entry)}
          className={
            defaultDisabled
              ? "flex h-8 w-full cursor-default items-center gap-1 rounded-[8px] px-1.5 text-left text-[13px] text-ink-3"
              : CARD_MENU_ITEM
          }
        >
          <span
            key={defaulted ? "default" : saving ? "saving" : "idle"}
            className={`flex size-5 shrink-0 items-center justify-center ${defaulted ? "text-accent" : "text-ink-2"}`}
            style={{ animation: "pop-in 160ms cubic-bezier(0.23,1,0.32,1) both" }}
          >
            {defaulted ? (
              <IconCircleCheckFilled size={15} aria-hidden />
            ) : saving ? (
              <IconLoader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <IconCircleCheck size={15} stroke={1.8} aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {defaulted ? "Default" : "Set default"}
          </span>
        </button>
        <button
          type="button"
          role="menuitem"
          aria-label={`Show QR code for ${entryLabel(entry)}`}
          onClick={() => onShowQr(entry)}
          className={CARD_MENU_ITEM}
        >
          <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
            <IconQrcode size={15} stroke={1.8} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate">Show QR</span>
        </button>
        <button
          type="button"
          role="menuitem"
          aria-label={`Delete ${entryLabel(entry)}`}
          onClick={() => onDelete(entry)}
          className={`${CARD_MENU_ITEM} text-red hover:bg-hover-2`}
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            <IconTrash size={15} stroke={1.8} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate">Delete</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default WatchedCards;
