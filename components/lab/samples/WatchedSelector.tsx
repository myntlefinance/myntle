"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconEye,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { truncateTechData } from "@/components/atoms/TechDataChip";
import GlideMenu from "@/components/primitives/GlideMenu";
import NetworkIcon from "@/components/finance/NetworkIcon";
import AddressPill from "@/components/finance/AddressPill";

/**
 * The watched address selector, with the two accounts from the product
 * screenshot: an EVM hex and a NEAR name.
 *
 * Rows — today's shape, faithful: the label row carries the truncated
 * address, and the pill carries it again in full beside a copy mark.
 * The duplication is the thing to look at.
 *
 * Compact rows — one address per row, shown once and truncated. Copy and
 * Delete join the trash hover pattern: hidden until the row is hovered.
 *
 * Dropdown — the trigger names the watched account and the menu overlays,
 * so tracking a fifth or tenth address never pushes the holdings below.
 * Watch new lives in the menu, beside the accounts, instead of as a
 * footer that grows the card.
 */

type Entry = { id: string; chain: "evm" | "solana" | "near"; network: string; label: string; address: string };

const ENTRIES: Entry[] = [
  {
    id: "brave",
    chain: "evm",
    network: "ethereum",
    label: "brave mach",
    address: "0x297f05AF42c78c243AaF1cA2156a32007A361434",
  },
  {
    id: "myntle",
    chain: "near",
    network: "near",
    label: "myntle",
    address: "myntle.near",
  },
];

/* Clipboard with a legacy fallback: `navigator.clipboard` is undefined
 * outside secure contexts (dev over LAN), where the optional chain alone
 * throws before any feedback runs. The check only shows on real success. */
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

function CopyButton({ value }: { value: string }) {
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

function DeleteAction({ label }: { label: string }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Delete ${label}`}
      className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-red transition-colors duration-100 hover:bg-red hover:text-white"
    >
      <IconTrash size={12} stroke={2} aria-hidden />
      Delete
    </span>
  );
}

/* Today's shape, for comparison. */
function Rows() {
  const [selected, setSelected] = useState<string | null>(ENTRIES[0].id);
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        <GlideMenu className="flex flex-col gap-px p-1.5">
          {ENTRIES.map((entry) => {
            const active = selected === entry.id;
            const label = entry.label;
            return (
              <div key={entry.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  data-menu-row
                  aria-pressed={active}
                  onClick={() => setSelected(active ? null : entry.id)}
                  className={`relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 text-left transition-colors duration-100 ${active ? "bg-hover" : ""}`}
                >
                  <NetworkIcon network={entry.network} size={16} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                    {label}
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
                    {truncateTechData(entry.address)}
                  </span>
                </button>
                <AddressPill address={entry.address} chain={entry.chain} />
                <div className="pointer-events-none flex shrink-0 items-center opacity-0 transition-opacity duration-75 group-hover:pointer-events-auto group-hover:opacity-100">
                  <DeleteAction label={label} />
                </div>
              </div>
            );
          })}
        </GlideMenu>
        <div className="border-t border-line p-1.5">
          <button
            type="button"
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            <IconPlus size={15} stroke={2} aria-hidden />
            Watch new
          </button>
        </div>
      </div>
      <div className="rounded-card bg-surface px-3 py-8 text-center shadow-card">
        <p className="text-[13px] text-ink-2">
          Holdings sit here. Every row above pushes them down.
        </p>
      </div>
    </div>
  );
}

/* One address per row, shown once. */
function CompactRows() {
  const [selected, setSelected] = useState<string | null>(ENTRIES[0].id);
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        <GlideMenu className="flex flex-col gap-px p-1.5">
          {ENTRIES.map((entry) => {
            const active = selected === entry.id;
            return (
              <div key={entry.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  data-menu-row
                  aria-pressed={active}
                  onClick={() => setSelected(active ? null : entry.id)}
                  className={`relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 text-left transition-colors duration-100 ${active ? "bg-hover" : ""}`}
                >
                  <NetworkIcon network={entry.network} size={16} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                    {entry.label}
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
                    {truncateTechData(entry.address)}
                  </span>
                </button>
                <CopyButton value={entry.address} />
                <div className="pointer-events-none flex shrink-0 items-center opacity-0 transition-opacity duration-75 group-hover:pointer-events-auto group-hover:opacity-100">
                  <DeleteAction label={entry.label} />
                </div>
              </div>
            );
          })}
        </GlideMenu>
        <div className="border-t border-line p-1.5">
          <button
            type="button"
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            <IconPlus size={15} stroke={2} aria-hidden />
            Watch new
          </button>
        </div>
      </div>
      <div className="rounded-card bg-surface px-3 py-8 text-center shadow-card">
        <p className="text-[13px] text-ink-2">
          Holdings sit here. Narrower rows, same downward push.
        </p>
      </div>
    </div>
  );
}

function Dropdown() {
  const [selected, setSelected] = useState<string>(ENTRIES[0].id);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = ENTRIES.find((entry) => entry.id === selected) ?? ENTRIES[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative" ref={ref}>
        <div className="flex h-10 items-center gap-1 rounded-[8px] bg-surface py-0 pl-2 pr-1 shadow-card">
          <div
            role="button"
            tabIndex={0}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Watched address"
            onClick={() => setOpen((value) => !value)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen((value) => !value);
              }
            }}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 outline-none"
          >
            <NetworkIcon network={current.network} size={16} />
            <span className="max-w-[180px] truncate text-[13px] font-medium text-ink">
              {current.label}
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
              {truncateTechData(current.address)}
            </span>
            <CopyButton value={current.address} />
            <IconChevronDown
              size={15}
              aria-hidden
              className={`ml-auto shrink-0 text-ink-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            />
          </div>
        </div>
        {open ? (
          <div className="absolute left-1/2 top-full z-50 mt-1 w-full min-w-[300px] -translate-x-1/2">
            <div
              role="menu"
              aria-label="Watched addresses"
              className="rounded-[12px] bg-surface p-1.5 shadow-overlay"
              style={{
                animation: "pop-in 140ms cubic-bezier(0.23,1,0.32,1) both",
                transformOrigin: "top center",
              }}
            >
            <div className="flex flex-col gap-px">
              {ENTRIES.map((entry) => (
                <div
                  key={entry.id}
                  className="group flex items-center gap-1 rounded-[8px] hover:bg-hover"
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected === entry.id}
                    onClick={() => {
                      setSelected(entry.id);
                      setOpen(false);
                    }}
                    className="flex h-10 min-w-0 flex-1 items-center gap-2 px-1.5 text-left"
                  >
                    <NetworkIcon network={entry.network} size={15} />
                    <span className="max-w-[140px] truncate text-[13px] font-medium text-ink">
                      {entry.label}
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
                      {truncateTechData(entry.address)}
                    </span>
                  </button>
                  <CopyButton value={entry.address} />
                  <div className="pointer-events-none flex shrink-0 items-center pr-1 opacity-0 transition-opacity duration-75 group-hover:pointer-events-auto group-hover:opacity-100">
                    <DeleteAction label={entry.label} />
                  </div>
                </div>
              ))}
              <div className="my-1 h-px bg-line" />
              <button
                type="button"
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                <IconPlus size={15} stroke={2} aria-hidden />
                Watch new
              </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="rounded-card bg-surface px-3 py-8 text-center shadow-card">
        <p className="text-[13px] text-ink-2">
          Holdings sit here. The menu floats, so they never move.
        </p>
      </div>
    </div>
  );
}

export default function WatchedSelector({ variant }: { variant?: string }) {
  return (
    <div className="mx-auto w-full max-w-[560px]">
      <p className="mb-3 flex items-center gap-1.5 text-[13px] text-ink-2">
        <IconEye size={14} stroke={1.7} aria-hidden />
        {variant === "Dropdown"
          ? "Overlay menu: the table below never shifts."
          : variant === "Compact rows"
            ? "Deduped rows: each address appears exactly once."
            : "Today's rows: the address appears twice per account."}
      </p>
      {variant === "Dropdown" ? (
        <Dropdown />
      ) : variant === "Compact rows" ? (
        <CompactRows />
      ) : (
        <Rows />
      )}
    </div>
  );
}
