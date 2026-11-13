import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Every screen in this application is dynamically rendered, and Next
     * drops a dynamic route from the client cache immediately by default.
     * That made a second visit to the same screen — even half a second after
     * the first — a fresh server render, which is what a rapid switch
     * between Portfolio and a chat row was waiting on.
     *
     * Thirty seconds keeps the payload that was just rendered on the client.
     * It does not govern the data inside the screen: the portfolio, threads,
     * and history each revalidate from their own cache on mount.
     */
    staleTimes: { dynamic: 30 },
  },
};

export default withWorkflow(nextConfig);
