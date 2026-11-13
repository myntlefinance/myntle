import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The layer boundary: only `lib/adapters/` may touch a provider SDK,
 * key, or URL. Ports stay pure (no provider imports, no `process.env`),
 * and app code imports ports + registry only.
 *
 * Pre-migration grandfather list: these files already coupled to the
 * balance provider before the layer existed, and steps 03/05 move them
 * behind it. No new file may join them — add provider coupling anywhere
 * else and this test fails.
 */

const ROOT = join(__dirname, "..", "..");

const PORTS_DIR = join(ROOT, "lib", "ports");
const ADAPTERS_DIR = join(ROOT, "lib", "adapters");

/** What must never appear in a port file (source, not tests). */
const FORBIDDEN_IN_PORTS: RegExp[] = [
  /process\.env/,
  /from\s+["']viem/,
  /@solana\//,
  /alchemy/i,
  /api\.g\./,
  /fastnear/i,
  /sns\.id|bonfida/i,
  /mainnet-beta/,
  /https?:\/\//,
];

/**
 * Provider key reads, URLs, and SDKs that belong in adapters. Scoped to
 * the balance/name surface the layer owns: chain RPC endpoint config
 * for transfers and the NEAR product reads are not this layer's.
 */
const PROVIDER_PATTERNS: RegExp[] = [
  /ALCHEMY_API_KEY/,
  /api\.g\.alchemy\.com/,
  /sdk-proxy/,
  /sns\.id/,
  /bonfida/i,
  /spl-name-service/,
];

/** Pre-migration files still coupling to the balance provider. Step 03
 * decoupled `lib/wallet/balances.ts` (provider I/O now lives in
 * `lib/adapters/alchemy/`), so nothing remains grandfathered. The list
 * stays so the upkeep assertion below keeps biting if coupling returns. */
const GRANDFATHERED: string[] = [];

function collectTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      collectTs(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path) || /\.probe\.tsx?$/.test(path);
}

function relative(path: string): string {
  return path.slice(ROOT.length + 1);
}

describe("anti-corruption boundary", () => {
  it("keeps port files pure", () => {
    const files = collectTs(PORTS_DIR).filter((f) => !isTestFile(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_IN_PORTS) {
        expect(text, `${relative(file)} must not match ${pattern}`).not.toMatch(
          pattern,
        );
      }
    }
  });

  it("keeps provider coupling inside lib/adapters (plus grandfathered)", () => {
    const roots = ["lib", "app", "components", "workflows"]
      .map((d) => join(ROOT, d))
      .filter((d) => {
        try {
          return statSync(d).isDirectory();
        } catch {
          return false;
        }
      });
    const violators = new Map<string, string[]>();
    for (const root of roots) {
      for (const file of collectTs(root)) {
        if (file.startsWith(ADAPTERS_DIR)) continue;
        if (isTestFile(file)) continue;
        const text = readFileSync(file, "utf8");
        const hits = PROVIDER_PATTERNS.filter((p) => p.test(text)).map(
          String,
        );
        if (hits.length > 0) violators.set(relative(file), hits);
      }
    }

    for (const file of violators.keys()) {
      expect(
        GRANDFATHERED,
        `${file} couples to a provider outside lib/adapters/`,
      ).toContain(file);
    }
    // Grandfather entries are upkeep, not forever: when a migration step
    // removes the coupling, remove the entry in the same change.
    for (const file of GRANDFATHERED) {
      expect(
        [...violators.keys()],
        `${file} no longer couples to a provider — remove it from GRANDFATHERED`,
      ).toContain(file);
    }
  });
});
