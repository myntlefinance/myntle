"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, base, arbitrum, polygon } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { NearProvider } from "near-connect-hooks";

/**
 * Every wallet provider lives in one client component.
 *
 * The root layout is a server component, and the wallet libraries call
 * `createContext` when they are evaluated. React's server build does not
 * have that function, so the providers have to be behind a client boundary
 * or the server fails while collecting the page data.
 */

const wagmiConfig = createConfig({
  chains: [mainnet, base, arbitrum, polygon],
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
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  // wagmi keeps its state in a query client, so the client is created once
  // and held for the life of the application.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <NearProvider config={{ network: "mainnet" }}>
          {children}
        </NearProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
