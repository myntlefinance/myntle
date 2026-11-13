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
};

export default withWorkflow(nextConfig);
