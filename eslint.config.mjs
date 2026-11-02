import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // These five come from the React Compiler ruleset in
      // eslint-plugin-react-hooks 7. They describe patterns that work today
      // but block the compiler, so they stay advisory until we adopt it.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      // Correctness rules stay fatal.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  globalIgnores([
    // Build output and generated files.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "app/.well-known/workflow/**",
    // Every per-harness agent directory holds a copy of the impeccable
    // skill, including a vendored bundle. None of it is our source.
    ".*/**",
    // Local working notes.
    "learnings/**",
    "plans/**",
  ]),
]);

export default eslintConfig;
