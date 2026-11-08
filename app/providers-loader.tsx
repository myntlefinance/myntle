"use client";

import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { ProvidersSkeleton } from "@/components/app/ProvidersSkeleton";
import type { PortfolioTab } from "@/components/app/portfolioTabs";

type ProvidersComponent = ComponentType<{
  children: ReactNode;
  initialPortfolioTab?: PortfolioTab;
}>;

/**
 * The wallet providers are loaded without server rendering.
 *
 * One of the wallet connectors pulls in a wallet SDK that reaches for
 * `indexedDB` the moment it is evaluated, and the server has no such thing.
 * The providers are useless without a browser anyway, so the whole tree is
 * client-only rather than the warning being tolerated at build time.
 *
 * The import runs from an effect, not `next/dynamic`'s `loading` fallback:
 * the fallback cannot receive the portfolio tab the server already read,
 * so a `?tab=super` or `?tab=watched` load painted the wallet shape first
 * and switched once hydration resolved the URL. The loading fallback is the
 * app shell here, with the tab the page will open, so the first paint is
 * already the right shape.
 */
export function ProvidersLoader({
  children,
  initialPortfolioTab,
}: {
  children: ReactNode;
  initialPortfolioTab?: PortfolioTab;
}) {
  const [Providers, setProviders] = useState<ProvidersComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("./providers").then((module) => {
      if (!cancelled) setProviders(() => module.Providers);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Providers) {
    return <ProvidersSkeleton initialPortfolioTab={initialPortfolioTab} />;
  }
  return (
    <Providers initialPortfolioTab={initialPortfolioTab}>
      {children}
    </Providers>
  );
}
