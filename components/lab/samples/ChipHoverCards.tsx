"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@/lib/use-mounted";
import { IconCheck, IconCopy, IconWallet } from "@tabler/icons-react";
import { StatusPill } from "@/components/atoms/StatusPill";
import { TokenAvatar } from "@/components/finance/TokenAvatar";
import { NetworkIcon } from "@/components/finance/NetworkIcon";

/**
 * Hover details on sentence chips, prototype.
 *
 * Every chip opens a small detail card on hover, keyboard focus, or tap:
 * tokens show chain, price, and a hoverable sample price graph; addresses
 * show the full address, a YOU marker for the connected wallet, and what
 * kind of account it is. All figures are sample data. Lab-only: production
 * still needs a real price-history source, which the codebase does not have.
 */

/* Sample 24-point price history for the graph. Production has no such
 * feed; this stands in for whatever source gets wired later. */
const SAMPLE_POINTS = [
  1.0001, 1.0003, 0.9999, 0.9997, 1.0002, 1.0005, 1.0004, 1.0, 0.9998,
  0.9996, 0.9999, 1.0001, 1.0003, 1.0006, 1.0004, 1.0002, 1.0, 0.9998,
  0.9997, 0.9999, 1.0001, 1.0002, 1.0001, 1.0,
];

/* ── chips (same inline-block grammar as the sentence card) ─────────── */

function TokenChip({ symbol, badge }: { symbol: string; badge?: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-baseline font-medium leading-none text-ink">
      <span aria-hidden="true" className="mr-[0.4em] inline-block align-middle">
        <TokenAvatar symbol={symbol} networkBadge={badge} size={18} />
      </span>
      {symbol}
    </span>
  );
}

function VenueChip({ label }: { label: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-baseline font-medium leading-none text-ink">
      <span aria-hidden="true" className="mr-[0.4em] inline-block align-middle">
        <NetworkIcon network="near" size={18} />
      </span>
      {label}
    </span>
  );
}

function AddressChip({ label }: { label: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-field px-[0.7em] py-[0.25em] align-baseline font-medium leading-none text-ink">
      <span aria-hidden="true" className="mr-[0.4em] inline-block align-middle">
        <IconWallet size={14} stroke={2} className="text-ink-2" />
      </span>
      {label}
    </span>
  );
}

function Amount({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold tabular-nums text-ink">{children}</strong>
  );
}

function PopupRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-ink-3">{label}</span>
      <span className="min-w-0 text-right text-xs tabular-nums text-ink">
        {children}
      </span>
    </div>
  );
}

/* ── hoverable price graph (sample data) ────────────────────────────── */

function Sparkline({ points }: { points: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 216;
  const h = 56;
  const pad = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) =>
    pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - 2 * pad);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p).toFixed(1)}`)
    .join(" ");
  const change = ((points[points.length - 1] - points[0]) / points[0]) * 100;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-ink-3">Last 24 hours</span>
        <span
          className={`text-xs font-medium tabular-nums ${change >= 0 ? "text-green" : "text-red"}`}
        >
          {change >= 0 ? "+" : ""}
          {change.toFixed(2)}%
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="block w-full cursor-crosshair"
        role="img"
        aria-label={`Sample price history, ${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(2)} percent over 24 hours`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(
            ((e.clientX - r.left) / r.width) * (points.length - 1),
          );
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        {hover != null ? (
          <g>
            <line
              x1={x(hover)}
              y1={0}
              x2={x(hover)}
              y2={h}
              stroke="var(--ink-3)"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle
              cx={x(hover)}
              cy={y(points[hover])}
              r={3}
              fill="var(--accent)"
            />
            <text
              x={Math.min(Math.max(x(hover), 30), w - 30)}
              y={12}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
              className="text-ink tabular-nums"
            >
              ${points[hover].toFixed(4)}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

/* ── popup shell (fixed position, flips above when space is short) ────
 * Portalled to the body so no ancestor — inline wrapper, card with
 * overflow-hidden, or stacking context — can trap or reflow it. */

function Popup({
  anchorRef,
  label,
  height,
  instant,
  onClose,
  onHoverChange,
  children,
}: {
  anchorRef: React.RefObject<HTMLSpanElement | null>;
  label: string;
  /** Estimated popup height for viewport flipping. */
  height: number;
  /** True when switching from another open card: no entrance animation. */
  instant: boolean;
  onClose: () => void;
  onHoverChange: (hovering: boolean) => void;
  children: React.ReactNode;
}) {
  const [box, setBox] = useState<
    { x: number; top?: number; bottom?: number; origin: string } | null
  >(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = 248;
    const x = Math.min(
      Math.max(8, r.left + r.width / 2 - w / 2),
      window.innerWidth - w - 8,
    );
    // Flip above when the estimated card would run past the viewport
    // bottom. The estimate only picks a side; the gap itself is exact —
    // below uses the chip's bottom edge, above anchors the card's bottom
    // edge 8px over the chip's top, so no guess can open a gap.
    const above =
      r.bottom + 8 + height > window.innerHeight && r.top - 8 - height > 8;
    // Origin-aware entrance, after the wallet menu: the card scales from
    // the chip, not from its own center — the vertical edge faces the
    // trigger, and the horizontal point tracks the chip's center, clamped
    // into the card when the viewport pushes it aside.
    const chipCenter = r.left + r.width / 2;
    const originX = Math.min(Math.max(((chipCenter - x) / w) * 100, 0), 100);
    const origin = `${originX.toFixed(1)}% ${above ? "100%" : "0%"}`;
    setBox(
      above
        ? { x, bottom: window.innerHeight - r.top + 8, origin }
        : { x, top: r.bottom + 8, origin },
    );
    const close = () => onClose();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [anchorRef, height, onClose]);

  if (!box) return null;
  return (
    <div
      role="dialog"
      aria-label={label}
      className="rounded-card bg-surface p-3 shadow-card"
      style={{
        position: "fixed",
        left: box.x,
        width: 248,
        zIndex: 50,
        ...(box.bottom != null ? { bottom: box.bottom } : { top: box.top }),
        // Wallet menu entrance: pop-in from 95% scale with the strong
        // ease-out, never from nothing. Instant when switching between
        // open cards. Reduced-motion users get the global instant
        // collapse for free.
        animation: instant
          ? "none"
          : "pop-in 180ms var(--ease-out-strong) both",
        transformOrigin: box.origin,
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {children}
    </div>
  );
}

/* ── hoverable chip ─────────────────────────────────────────────────── */

function HoverChip({
  id,
  openId,
  setOpenId,
  chip,
  popupLabel,
  popupHeight,
  popup,
}: {
  id: string;
  openId: string | null;
  setOpenId: React.Dispatch<React.SetStateAction<string | null>>;
  chip: React.ReactNode;
  popupLabel: string;
  popupHeight: number;
  popup: React.ReactNode;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A click that follows its own focus-open must not toggle straight back
  // shut: mousedown focuses (opens), mouseup clicks. The flag eats exactly
  // that click; later clicks toggle normally.
  const focusOpened = useRef(false);
  // Portal target only exists in the browser; the first render (and the
  // server) shows no popup so hydration always matches.
  const mounted = useMounted();
  // What was open on the previous render: switching straight from another
  // open card renders instantly, after the tooltip rule. Tracked in state
  // (synced during render) so the render-time read is state, not a ref.
  const [prevOpen, setPrevOpen] = useState<string | null>(null);
  const open = openId === id;
  if (prevOpen !== openId) {
    setPrevOpen(openId);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    // Switching between open chips skips the delay, after the tooltip
    // rule: the first appearance waits, the rest are instant.
    if (openId !== null) {
      setOpenId(id);
      return;
    }
    timer.current = setTimeout(() => setOpenId(id), 120);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setOpenId((current) => (current === id ? null : current)),
      150,
    );
  };
  // Keyboard focus can move from the chip into the popup itself (copy
  // button, graph); only close when focus leaves both entirely.
  const blur = (e: React.FocusEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setOpenId((current) => (current === id ? null : current));
  };

  return (
    <span
      ref={ref}
      tabIndex={0}
      aria-expanded={open}
      className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => {
        focusOpened.current = true;
        setOpenId(id);
      }}
      onBlur={blur}
      onClick={(e) => {
        // Mouse clicks carry a detail count; keyboard clicks do not. Only
        // a mouse click trailing its own focus-open is eaten.
        if (e.detail !== 0 && focusOpened.current) {
          focusOpened.current = false;
          return;
        }
        focusOpened.current = false;
        setOpenId(open ? null : id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpenId(null);
      }}
    >
      {chip}
      {/* Portalled to the body: as a child of this inline wrapper the
          fixed card would split the inline box and re-resolve line breaks,
          visibly moving the words around it. Outside the flow it cannot. */}
      {open && mounted
        ? createPortal(
            <Popup
              anchorRef={ref}
              label={popupLabel}
              height={popupHeight}
              instant={
                prevOpen !== null && prevOpen !== id
              }
              onClose={() =>
                setOpenId((current) => (current === id ? null : current))
              }
              onHoverChange={(hovering) => {
                if (timer.current) clearTimeout(timer.current);
                if (!hovering) hide();
              }}
            >
              {popup}
            </Popup>,
            document.body,
          )
        : null}
    </span>
  );
}

function CopyMini({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy address"}
      onClick={(e) => {
        e.stopPropagation();
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard unavailable in some contexts.
          }
        })();
      }}
      className="ml-1 inline-flex size-[22px] items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
    >
      {copied ? (
        <IconCheck size={13} stroke={2.6} className="text-green" />
      ) : (
        <IconCopy size={13} stroke={1.8} />
      )}
    </button>
  );
}

/* ── the three detail cards ─────────────────────────────────────────── */

function TokenPopup() {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <TokenAvatar symbol="USDC" networkBadge="arb" size={24} />
        <div>
          <p className="text-sm font-medium leading-tight text-ink">USDC</p>
          <p className="text-xs tabular-nums text-ink-3">$1.00</p>
        </div>
      </div>
      <PopupRow label="Chain">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-flex">
            <NetworkIcon network="arb" size={12} />
          </span>
          Arbitrum
        </span>
      </PopupRow>
      <div className="mt-1 border-t border-line pt-2">
        <Sparkline points={SAMPLE_POINTS} />
      </div>
    </div>
  );
}

function AddressPopup() {
  const address = "0x3259aBcDeF12345678901073";
  return (
    <div>
      <PopupRow label="Address">
        <span className="inline-flex items-center">
          <span className="truncate">0x3259…1073</span>
          <CopyMini value={address} />
        </span>
      </PopupRow>
      <PopupRow label="Identity">
        <StatusPill tone="green">You</StatusPill>
      </PopupRow>
      <PopupRow label="Kind">Connected wallet</PopupRow>
    </div>
  );
}

function VenuePopup() {
  return (
    <div>
      <PopupRow label="Account">Near Intents</PopupRow>
      <PopupRow label="Contract">intents.near</PopupRow>
      <PopupRow label="Kind">Settlement ledger</PopupRow>
    </div>
  );
}

/* ── sample ─────────────────────────────────────────────────────────── */

export default function ChipHoverCards({ variant }: { variant?: string }) {
  const initial =
    variant === "Address" ? "address" : variant === "Venue" ? "venue" : "token";
  const [openId, setOpenId] = useState<string | null>(initial);

  return (
    <div className="max-w-95">
      <div className="text-[15px] leading-[2] text-ink [text-wrap:pretty]">
        Send <Amount>2</Amount>{" "}
        <HoverChip
          id="token"
          openId={openId}
          setOpenId={setOpenId}
          chip={<TokenChip symbol="USDC" badge="arb" />}
          popupLabel="USDC details"
          popupHeight={250}
          popup={<TokenPopup />}
        />{" "}
        from{" "}
        <HoverChip
          id="address"
          openId={openId}
          setOpenId={setOpenId}
          chip={<AddressChip label="0x3259…1073" />}
          popupLabel="Wallet details"
          popupHeight={150}
          popup={<AddressPopup />}
        />{" "}
        to{" "}
        <HoverChip
          id="venue"
          openId={openId}
          setOpenId={setOpenId}
          chip={<VenueChip label="Near Intents" />}
          popupLabel="Near Intents details"
          popupHeight={150}
          popup={<VenuePopup />}
        />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        Hover, focus, or tap a chip. Escape closes the card.
      </p>
    </div>
  );
}
