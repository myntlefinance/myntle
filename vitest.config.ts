import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    // The suite exercises the live price path by default. Tests that cover the
    // rollout flag stub NEXT_PUBLIC_PRICES_LIVE to "0" themselves.
    env: {
      NEXT_PUBLIC_PRICES_LIVE: "1",
    },
  },
});
