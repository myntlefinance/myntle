"use client";

import { useState } from "react";

/* The stored theme is read during the first render, not in an effect, so a
 * remount — e.g. opening the wallet menu — renders the thumb in place
 * instead of replaying the light→dark slide. Server render assumes the dark
 * default; ThemeSync owns the truth right after hydration. */
function initialDark(): boolean {
  try {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("bui-theme");
    if (stored) return stored !== "light";
    return document.documentElement.classList.contains("dark");
  } catch {
    return true;
  }
}

/** Sun/moon segmented pill from the refs. */
export function ThemeToggle({ compact = false }: { compact?: boolean } = {}) {
  const [dark, setDark] = useState<boolean>(initialDark);

  function apply(next: boolean) {
    if (next === dark) return;
    setDark(next);
    /* freeze all transitions while every token flips, so the theme change
     * is one clean swap instead of hundreds of mismatched color fades */
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.classList.toggle("dark", next);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
    try {
      localStorage.setItem("bui-theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <div
      className={`relative inline-grid grid-cols-2 items-center rounded-full bg-field p-0.5 ${
        compact ? "h-8" : "h-9"
      }`}
    >
      <span
        aria-hidden
        suppressHydrationWarning
        className={`absolute inset-y-0.5 left-0.5 rounded-full bg-surface shadow-btn transition-transform duration-200 ${
          compact ? "w-7" : "w-8"
        }`}
        style={{
          transform: dark
            ? compact
              ? "translateX(28px)"
              : "translateX(32px)"
            : "translateX(0)",
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      />
      <button
        aria-label="Light mode"
        onClick={() => apply(false)}
        className={`relative z-10 flex items-center justify-center rounded-full transition-colors duration-150 ${
          compact ? "size-7" : "size-8"
        } ${dark ? "text-ink-3 hover:text-ink-2" : "text-ink"}`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </button>
      <button
        aria-label="Dark mode"
        onClick={() => apply(true)}
        className={`relative z-10 flex items-center justify-center rounded-full transition-colors duration-150 ${
          compact ? "size-7" : "size-8"
        } ${dark ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </button>

    </div>
  );
}
