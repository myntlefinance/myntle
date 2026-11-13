import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getBalancesPort,
  getBalancesProviderName,
  getEvmRpcPort,
  getEvmRpcProviderName,
  getForwardableSolanaRpcEndpoint,
  getNameResolverPort,
  getSolanaRpcPort,
  getSolanaRpcProviderName,
} from "@/lib/adapters/registry";
import { SNS_PROXY_BASE } from "@/lib/adapters/solana-rpc/sns";
import { ProviderNotConfigured } from "./errors";

const KEYS = [
  "BALANCES_PROVIDER",
  "EVM_RPC_PROVIDER",
  "SOLANA_RPC_PROVIDER",
  "ALCHEMY_API_KEY",
  "NEXT_PUBLIC_SOLANA_RPC",
] as const;

const saved: Record<string, string | undefined> = {};
for (const key of KEYS) saved[key] = process.env[key];

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("adapter registry", () => {
  it("defaults to the production providers", () => {
    delete process.env.BALANCES_PROVIDER;
    delete process.env.EVM_RPC_PROVIDER;
    delete process.env.SOLANA_RPC_PROVIDER;
    expect(getBalancesProviderName()).toBe("alchemy");
    expect(getEvmRpcProviderName()).toBe("alchemy");
    expect(getSolanaRpcProviderName()).toBe("endpoint");
  });

  it("rejects unknown provider names with the typed error", () => {
    process.env.BALANCES_PROVIDER = "other";
    expect(() => getBalancesPort()).toThrow(ProviderNotConfigured);
    process.env.EVM_RPC_PROVIDER = "other";
    expect(() => getEvmRpcPort()).toThrow(ProviderNotConfigured);
    process.env.SOLANA_RPC_PROVIDER = "other";
    expect(() => getSolanaRpcPort()).toThrow(ProviderNotConfigured);
  });

  it("throws ProviderNotConfigured when the key is missing", () => {
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.BALANCES_PROVIDER;
    let caught: unknown;
    try {
      getBalancesPort();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderNotConfigured);
    expect((caught as ProviderNotConfigured).provider).toBe("alchemy");
    expect(() => getEvmRpcPort()).toThrow(ProviderNotConfigured);
  });

  it("resolves SNS without the EVM key while ENS still fails closed", async () => {
    const BONFIDA = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.SOLANA_RPC_PROVIDER;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ result: BONFIDA }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    // Constructing and resolving SNS must not touch the EVM adapter.
    await expect(
      getNameResolverPort().resolveName("solana", "bonfida.sns"),
    ).resolves.toMatchObject({ address: BONFIDA });

    // The EVM path still checks the key, but maps the failure to the
    // resolver's closed `unavailable` taxonomy instead of leaking the
    // configuration error.
    await expect(
      getNameResolverPort().resolveName("evm", "vitalik.eth"),
    ).rejects.toMatchObject({
      kind: "unavailable",
      reason: "ens_rpc",
      retryable: false,
    });
    expect(() => getEvmRpcPort()).toThrow(ProviderNotConfigured);
  });

  it("returns the wired production adapters behind the port signatures", async () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    // The real balances adapter short-circuits this filter before any
    // network call; the old stub threw "not wired yet" instead.
    const empty = await getBalancesPort().getBalances(
      "evm",
      "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      { networks: ["solana"] },
    );
    expect(empty.balances).toEqual([]);
    expect("error" in empty).toBe(false);
    expect(typeof getEvmRpcPort().getEnsAddress).toBe("function");
    expect(typeof getSolanaRpcPort().getEndpoint()).toBe("string");
    // The real name resolver validates locally: a bad suffix fails
    // without a network call. The old stub threw "not wired yet".
    await expect(
      getNameResolverPort().resolveName("evm", "vitalik.com"),
    ).rejects.toMatchObject({ kind: "invalid_input", reason: "bad_suffix" });
  });

  it("never selects a key-bearing Solana endpoint for ?rpc= forwarding", () => {
    // Key-bearing provider: never forward, even with a key configured.
    process.env.SOLANA_RPC_PROVIDER = "alchemy";
    process.env.ALCHEMY_API_KEY = "test-key";
    process.env.NEXT_PUBLIC_SOLANA_RPC = "https://example.invalid/";
    expect(getForwardableSolanaRpcEndpoint()).toBeUndefined();

    // Default path (nothing configured): send no endpoint.
    delete process.env.SOLANA_RPC_PROVIDER;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC;
    expect(getForwardableSolanaRpcEndpoint()).toBeUndefined();

    // Explicit non-key endpoint: the only forwarded case.
    process.env.NEXT_PUBLIC_SOLANA_RPC = "https://example.invalid/";
    expect(getForwardableSolanaRpcEndpoint()).toBe(
      "https://example.invalid/",
    );

    // A configured value that looks key-bearing is refused defensively.
    process.env.NEXT_PUBLIC_SOLANA_RPC =
      "https://solana-mainnet.g.alchemy.com/v2/test-key";
    expect(getForwardableSolanaRpcEndpoint()).toBeUndefined();
  });

  it("sends no ?rpc= on the default and key-bearing paths, forwards it otherwise", async () => {
    const BONFIDA = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ result: BONFIDA }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    process.env.ALCHEMY_API_KEY = "test-key";
    // The failover entry attempts the on-chain read first, so the log
    // carries the RPC POST too: URL-shape pins scope to the proxy hits.
    const proxyHits = () =>
      requested.filter((url) => url.startsWith(SNS_PROXY_BASE));
    const assertNoKeyInQuery = () => {
      for (const url of requested) {
        if (!url.includes("test-key")) continue;
        // A key-bearing URL is only ever the server-side endpoint POST —
        // it must never travel inside a ?rpc= query string.
        expect(url).not.toContain("?rpc=");
        expect(url.startsWith("https://solana-mainnet.g.alchemy.com/")).toBe(
          true,
        );
      }
    };

    // Key-bearing provider: the key must not appear in the query string.
    process.env.SOLANA_RPC_PROVIDER = "alchemy";
    delete process.env.NEXT_PUBLIC_SOLANA_RPC;
    await getNameResolverPort().resolveName("solana", "bonfida.sns");
    expect(proxyHits()).toHaveLength(1);
    expect(proxyHits()[0]).toBe(`${SNS_PROXY_BASE}/resolve/bonfida.sns`);
    assertNoKeyInQuery();

    // Default path: no endpoint forwarded either.
    requested.length = 0;
    delete process.env.SOLANA_RPC_PROVIDER;
    await getNameResolverPort().resolveName("solana", "bonfida.sns");
    expect(proxyHits()).toHaveLength(1);
    expect(proxyHits()[0]).toBe(`${SNS_PROXY_BASE}/resolve/bonfida.sns`);

    // Explicit non-key endpoint: forwarded as ?rpc=.
    requested.length = 0;
    process.env.NEXT_PUBLIC_SOLANA_RPC = "https://example.invalid/";
    await getNameResolverPort().resolveName("solana", "bonfida.sns");
    expect(proxyHits()).toHaveLength(1);
    expect(proxyHits()[0]).toBe(
      `${SNS_PROXY_BASE}/resolve/bonfida.sns?rpc=${encodeURIComponent("https://example.invalid/")}`,
    );
  });
});
