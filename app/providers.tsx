"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, base, arbitrum, polygon, optimism, bsc, avalanche, gnosis, scroll } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { NearProvider } from "near-connect-hooks";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { ProvidersSkeleton } from "@/components/app/ProvidersSkeleton";
import type { PortfolioTab } from "@/components/app/portfolioTabs";

/**
 * Every wallet provider lives in one client component.
 *
 * The root layout is a server component, and the wallet libraries call
 * `createContext` when they are evaluated. React's server build does not
 * have that function, so the providers have to be behind a client boundary
 * or the server fails while collecting the page data.
 */

const wagmiConfig = createConfig({
  chains: [mainnet, base, arbitrum, polygon, optimism, bsc, avalanche, gnosis, scroll],
  connectors: [
    injected(),
    // The WalletConnect connector fetches its configuration from the network
    // on start-up, and it warns loudly when the project id is a placeholder.
    // It is only offered once a real id is configured.
    ...(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
      ? [
          walletConnect({
            projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
          }),
        ]
      : []),
  ],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [polygon.id]: http(),
    [optimism.id]: http(),
    [bsc.id]: http(),
    [avalanche.id]: http(),
    [gnosis.id]: http(),
    [scroll.id]: http(),
  },
  // The provider tree is client-only (see providers-loader), so SSR
  // discovery is off. With `ssr: true` wagmi defers EIP-6963 (MIPD)
  // connectors until after hydration, which hides per-wallet cards.
  ssr: false,
});

export function Providers({
  children,
  initialPortfolioTab,
}: {
  children: React.ReactNode;
  initialPortfolioTab?: PortfolioTab;
}) {
  // wagmi keeps its state in a query client, so the client is created once
  // and held for the life of the application.
  const [queryClient] = useState(() => new QueryClient());

  /**
   * A development wallet has to exist before wagmi first checks for one, or
   * the injected connector reads "no accounts", calls itself disconnected, and
   * never retries. The key arrives from a local route rather than a bundle
   * constant, so the tree waits for it — in development only. A production
   * build starts ready and never fetches anything.
   */
  const [walletReady, setWalletReady] = useState(
    process.env.NODE_ENV === "production",
  );

  useEffect(() => {
    if (walletReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/dev/wallet", { cache: "no-store" });
        const body = res.ok
          ? ((await res.json()) as { key?: string | null })
          : null;
        if (body?.key && !cancelled) {
          const { installDevWallet } = await import("@/lib/wallet/dev-wallet");
          installDevWallet(body.key);
        }
      } catch {
        // No dev wallet. An installed extension still connects as usual.
      } finally {
        if (!cancelled) setWalletReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletReady]);

  // Keep the shell painted while the dev wallet arrives. Returning null here
  // unmounted the fallback and left a blank frame between the skeleton and
  // the real application, which on a slow connection reads as a second load.
  if (!walletReady) return <ProvidersSkeleton initialPortfolioTab={initialPortfolioTab} />;

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <NearProvider config={{ network: "mainnet" }}>
          {/* One wallet instance and one session answer for the whole app. */}
          <AuthProvider>{children}</AuthProvider>
        </NearProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
