"use client";

import { useSyncExternalStore } from "react";

function subscribeNoop() {
  return () => {};
}

/**
 * True once the tree has hydrated on the client. Portals into
 * `document.body` render only when mounted, so the server HTML and the
 * first client render agree and no mount-flag effect is needed.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}
