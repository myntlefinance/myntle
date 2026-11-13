"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";

/* ─────────────────────────────────────────────────────────
 * COPY ADDRESS BUTTON
 * The wallet menu's copy row, shared wherever an address needs
 * a full-width copy action: the 16px mark crossfades to the green
 * check while the label crossfades to Copied, both on the same
 * curve, then both morph back.
 * ───────────────────────────────────────────────────────── */

const CROSSFADE =
  "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), filter 240ms cubic-bezier(0.16, 1, 0.3, 1), transform 240ms cubic-bezier(0.16, 1, 0.3, 1)";

export function CopyAddressButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      } catch {
        /* clipboard unavailable — leave the row unchanged */
      }
    })();
  };

  return (
    <button
      type="button"
      role="menuitem"
      className="flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[13.5px] text-ink transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover-2 active:scale-[0.97]"
      onClick={copy}
    >
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        <span
          aria-hidden={copied}
          className="absolute inset-0 flex items-center justify-center text-ink-2"
          style={{
            opacity: copied ? 0 : 1,
            filter: copied ? "blur(2.5px)" : "blur(0px)",
            transform: copied ? "scale(0.85)" : "scale(1)",
            pointerEvents: copied ? "none" : "auto",
            transition: CROSSFADE,
            willChange: "transform, opacity, filter",
          }}
        >
          <IconCopy size={16} stroke={1.8} strokeWidth={1.8} />
        </span>
        <span
          aria-hidden={!copied}
          className="absolute inset-0 flex items-center justify-center text-green"
          style={{
            opacity: copied ? 1 : 0,
            filter: copied ? "blur(0px)" : "blur(2.5px)",
            transform: copied ? "scale(1)" : "scale(0.85)",
            pointerEvents: copied ? "auto" : "none",
            transition: CROSSFADE,
            willChange: "transform, opacity, filter",
          }}
        >
          <IconCheck size={16} stroke={2.6} strokeWidth={2.6} />
        </span>
      </span>
      <span className="relative h-5 min-w-0 flex-1 overflow-hidden">
        <span
          aria-hidden={copied}
          className="absolute inset-0 flex items-center"
          style={{
            opacity: copied ? 0 : 1,
            filter: copied ? "blur(2px)" : "blur(0px)",
            pointerEvents: copied ? "none" : "auto",
            transition: CROSSFADE,
            willChange: "opacity, filter",
          }}
        >
          <span className="truncate">Copy address</span>
        </span>
        <span
          aria-hidden={!copied}
          className="absolute inset-0 flex items-center font-medium text-green"
          style={{
            opacity: copied ? 1 : 0,
            filter: copied ? "blur(0px)" : "blur(2px)",
            pointerEvents: copied ? "auto" : "none",
            transition: CROSSFADE,
            willChange: "opacity, filter",
          }}
        >
          <span className="truncate">Copied</span>
        </span>
      </span>
    </button>
  );
}

export default CopyAddressButton;
