"use client";

import dynamic from "next/dynamic";

/**
 * The wallet providers are loaded without server rendering.
 *
 * One of the wallet connectors pulls in a wallet SDK that reaches for
 * `indexedDB` the moment it is evaluated, and the server has no such thing.
 * The providers are useless without a browser anyway, so the whole tree is
 * client-only rather than the warning being tolerated at build time.
 */
const Providers = dynamic(() => import("./providers").then((m) => m.Providers), {
  ssr: false,
  loading: () => null,
});

export function ProvidersLoader({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
