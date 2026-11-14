import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * A screen the session has already rendered is never thrown away for age.
     *
     * Every route here is dynamic, so the default (0 seconds) makes each
     * navigation a fresh server render and holds the old screen until it
     * arrives. A countdown does not fix that; it only moves the wait. The
     * screen is instead served from the client cache on every click, however
     * old it is, and the data inside it revalidates from its own source.
     *
     * Freshness never depended on this value: portfolio balances refresh
     * through React Query, the transcript refreshes on mount from the
     * messages route (see the seed timestamp in ChatView), and the sidebar
     * lists revalidate behind their cached copies.
     *
     * The client cache is memory only, so a reload clears it, and sign-out
     * performs a full load so the next account cannot reach a previous
     * account's rendered screens.
     */
    staleTimes: { dynamic: 86_400, static: 86_400 },
  },
  async headers() {
    // Baseline hardening. No CSP here: the wallet connectors, WalletConnect
    // relay, and streaming transports need a per-source policy, which is a
    // separate change with its own testing.
    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default withWorkflow(nextConfig);
