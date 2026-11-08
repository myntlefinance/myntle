"use client";

import { useEffect } from "react";
import { forgetShapes, smart } from "skullet";
import { SkulletProvider } from "skullet/react";
import { SIGN_OUT_EVENT } from "@/lib/auth/events";

/**
 * One skeleton configuration for every page.
 *
 * The colours are not set here: `--skullet-base` and `--skullet-highlight`
 * live in `globals.css` beside the surface tokens, so the skeleton follows
 * the application's class-based theme rather than the operating system's.
 * That is also why `mode` is left out — skullet treats an explicit `system`
 * as a request for its own default palette, which would override those
 * variables and follow the OS instead of the theme class.
 *
 * Everything else is set here: the bars are drawn from the ascender down to
 * the descender so hanging letters are covered, the 8px radius softens every
 * measured line, and the slow shimmer is one stream for the whole page. The
 * reveal keeps the smart policy and adds a small blur to each piece as it
 * lands, which is cheap here because it only runs for the length of one
 * reveal and is skipped entirely under reduced motion.
 */
export function SkulletRoot({ children }: { children: React.ReactNode }) {
  // Remembered shapes are layout only, but they still describe what the
  // last account had on screen; they leave with that account.
  useEffect(() => {
    const onSignOut = () => forgetShapes();
    window.addEventListener(SIGN_OUT_EVENT, onSignOut);
    return () => window.removeEventListener(SIGN_OUT_EVENT, onSignOut);
  }, []);

  return (
    <SkulletProvider
      reveal={{ ...smart, enter: { filter: "blur(6px)" } }}
      theme={{
        radius: "8px",
        animation: "shimmer",
        speed: "slow",
        text: { top: "ascender", bottom: "descender" },
      }}
    >
      {children}
    </SkulletProvider>
  );
}
