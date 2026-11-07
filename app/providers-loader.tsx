"use client";

import dynamic from "next/dynamic";
import { ThreadSkeleton } from "@/components/app/ThreadSkeleton";

/**
 * The wallet providers are loaded without server rendering.
 *
 * One of the wallet connectors pulls in a wallet SDK that reaches for
 * `indexedDB` the moment it is evaluated, and the server has no such thing.
 * The providers are useless without a browser anyway, so the whole tree is
 * client-only rather than the warning being tolerated at build time.
 *
 * The loading fallback is a real skeleton (not null) so server HTML is
 * never an empty body: first paint shows the thread shape while the
 * wallet chunk loads.
 */
const Providers = dynamic(() => import("./providers").then((m) => m.Providers), {
  ssr: false,
  loading: () => <ThreadSkeleton />,
});

export function ProvidersLoader({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
