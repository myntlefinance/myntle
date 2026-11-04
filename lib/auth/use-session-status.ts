"use client";

import { useAuth, type SessionStatus } from "@/lib/auth/auth-provider";

export type { SessionStatus };

/**
 * Whether this browser holds a Myntle session, distinct from merely having a
 * wallet connected. Connection proves key access; this proves the login
 * signature happened. Chats gate on this, not on connection.
 *
 * The answer comes from the one AuthProvider, so every component on screen
 * agrees — including the ones that just signed in.
 */
export function useSessionStatus() {
  const { status, refresh } = useAuth();
  return { status, refresh };
}
