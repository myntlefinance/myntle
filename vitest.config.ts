import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    // Local research probes live in gitignored plans/ and must never gate the
    // product suite; a fresh clone does not have them.
    exclude: [...configDefaults.exclude, "plans/**"],
    // The suite exercises the live price path by default. Tests that cover the
    // rollout flag stub NEXT_PUBLIC_PRICES_LIVE to "0" themselves.
    env: {
      NEXT_PUBLIC_PRICES_LIVE: "1",
    },
  },
});
