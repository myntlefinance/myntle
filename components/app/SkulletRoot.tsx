"use client";

import { useEffect } from "react";
import { forgetShapes } from "skullet";
import { SkulletProvider } from "skullet/react";
import { SIGN_OUT_EVENT } from "@/lib/auth/events";

/**
 * One skeleton configuration for every page.
 *
 * The colours are not set here: `--skullet-base` and `--skullet-highlight`
 * live in `globals.css` beside the surface tokens, so the skeleton follows
 * the application's class-based theme rather than the operating system's
 * preference. The provider only sets the reveal, which is what makes every
 * skeleton on the page share one choice and one shimmer phase.
 */
export function SkulletRoot({ children }: { children: React.ReactNode }) {
  // Remembered shapes are layout only, but they still describe what the
  // last account had on screen; they leave with that account.
  useEffect(() => {
    const onSignOut = () => forgetShapes();
    window.addEventListener(SIGN_OUT_EVENT, onSignOut);
    return () => window.removeEventListener(SIGN_OUT_EVENT, onSignOut);
  }, []);

  return <SkulletProvider reveal="smart">{children}</SkulletProvider>;
}
