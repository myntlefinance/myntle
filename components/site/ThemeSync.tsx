"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { syncThemeColor } from "@/lib/theme";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* React 19 reconciles <html>'s className during hydration, wiping the class
 * the pre-paint head script set. A layout effect re-applies it before the
 * browser paints the hydrated document, so the correction cannot flash. */
export function ThemeSync() {
  const pathname = usePathname();
  useIsomorphicLayoutEffect(() => {
    try {
      const theme = localStorage.getItem("bui-theme");
      const dark = theme !== "light";
      document.documentElement.classList.toggle("dark", dark);
      syncThemeColor(dark);
    } catch {
      document.documentElement.classList.add("dark");
      syncThemeColor(true);
    }
  }, [pathname]);

  return null;
}
