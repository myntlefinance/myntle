"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * The router reads this value at runtime and compares it against `"full"`.
 * The published option type names a TypeScript enum that `next/navigation`
 * does not re-export, so the literal has to be cast once, here, instead of
 * at every call site.
 */
type PrefetchOptions = NonNullable<
  Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]
>;
const FULL_PREFETCH = { kind: "full" } as unknown as PrefetchOptions;

/**
 * Warm a route's payload before the user commits to it.
 *
 * `router.prefetch` defaults to the PPR strategy, which yields nothing for a
 * dynamic route that has no loading boundary. Every screen in this application
 * is dynamic — the shared layout reads a request header, the chat page reads
 * the session — so that default call is a no-op here. A full prefetch asks for
 * the same payload the click would otherwise fetch, which is what lets the
 * navigation commit from cache instead of waiting on a server render.
 *
 * The payload lives in the router's client cache, so a visit inside its window
 * costs no request at all. A failed prefetch stays invisible: the click still
 * loads the route, and the in-page data caches still revalidate on mount.
 */
export function useRoutePrefetch() {
  const router = useRouter();
  return useCallback(
    (href: string) => {
      try {
        router.prefetch(href, FULL_PREFETCH);
      } catch {
        // Prefetching is an optimization; the navigation owns the fallback.
      }
    },
    [router],
  );
}
