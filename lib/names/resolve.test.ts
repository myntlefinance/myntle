import { describe, expect, it } from "vitest";
import {
  InvalidInput,
  isNameResolutionError,
  NotFound,
  ProviderNotConfigured,
  ProviderUnavailable,
  type EvmRpcPort,
} from "@/lib/ports";
import type { SnsResolution } from "@/lib/adapters/solana-rpc/sns";
import { NameCache } from "./cache";
import { createNameResolver } from "./resolve";

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;
const BONFIDA = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";

function setup(options?: {
  evm?: (name: string) => Promise<`0x${string}` | null>;
  sns?: (name: string) => Promise<SnsResolution>;
  cache?: NameCache | null;
}) {
  const evmCalls: string[] = [];
  const snsCalls: string[] = [];
  const evmRpc: EvmRpcPort = {
    async getEnsAddress(name: string) {
      evmCalls.push(name);
      return options?.evm ? options.evm(name) : VITALIK;
    },
  };
  const snsResolve = async (name: string) => {
    snsCalls.push(name);
    if (options?.sns) return options.sns(name);
    return { address: BONFIDA };
  };
  const resolver = createNameResolver({
    evmRpc,
    snsResolve,
    cache: options?.cache,
  });
  return { resolver, evmCalls, snsCalls };
}

describe("resolveName over evm", () => {
  it("returns address, normalized name, and a fresh timestamp", async () => {
    const { resolver, evmCalls } = setup();
    const hit = await resolver.resolveName("evm", "  VITALIK.ETH ");
    expect(hit?.address).toBe(VITALIK);
    expect(hit?.name).toBe("vitalik.eth");
    expect(Number.isNaN(Date.parse(hit?.resolvedAt ?? ""))).toBe(false);
    expect(evmCalls).toEqual(["vitalik.eth"]);
  });

  it("returns null when the name is unregistered", async () => {
    const { resolver } = setup({ evm: async () => null });
    await expect(
      resolver.resolveName("evm", "unregistered12345.eth"),
    ).resolves.toBeNull();
  });

  it("rejects a non-.eth suffix without a network call", async () => {
    const { resolver, evmCalls } = setup();
    const failure = await resolver
      .resolveName("evm", "vitalik.com")
      .catch((error: unknown) => error);
    expect(isNameResolutionError(failure)).toBe(true);
    expect(failure).toMatchObject({ kind: "invalid_input", reason: "bad_suffix", retryable: false });
    expect(evmCalls).toEqual([]);
  });

  it("rejects empty input without a network call", async () => {
    const { resolver, evmCalls } = setup();
    const failure = await resolver
      .resolveName("evm", "   ")
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: "invalid_input", reason: "bad_name" });
    expect(evmCalls).toEqual([]);
  });

  it("rejects a name the normalizer refuses without a network call", async () => {
    const { resolver, evmCalls } = setup();
    const failure = await resolver
      .resolveName("evm", "not_valid!.eth")
      .catch((error: unknown) => error);
    expect(isNameResolutionError(failure)).toBe(true);
    expect(failure).toMatchObject({ kind: "invalid_input", reason: "bad_name", retryable: false });
    expect(evmCalls).toEqual([]);
  });

  it("maps an RPC failure to retryable unavailable", async () => {
    const { resolver } = setup({
      evm: async () => {
        throw new ProviderUnavailable("down");
      },
    });
    const failure = await resolver
      .resolveName("evm", "vitalik.eth")
      .catch((error: unknown) => error);
    expect(isNameResolutionError(failure)).toBe(true);
    expect(failure).toMatchObject({ kind: "unavailable", reason: "ens_rpc", retryable: true });
  });

  it("maps a missing key to non-retryable unavailable", async () => {
    const { resolver } = setup({
      evm: async () => {
        throw new ProviderNotConfigured("alchemy");
      },
    });
    const failure = await resolver
      .resolveName("evm", "vitalik.eth")
      .catch((error: unknown) => error);
    expect(isNameResolutionError(failure)).toBe(true);
    expect(failure).toMatchObject({
      kind: "unavailable",
      reason: "ens_rpc",
      retryable: false,
    });
  });
});

describe("resolveName over solana", () => {
  it("returns the address under the lowercased name", async () => {
    const { resolver, snsCalls } = setup();
    const hit = await resolver.resolveName("solana", " Bonfida.SNS ");
    expect(hit?.address).toBe(BONFIDA);
    expect(hit?.name).toBe("bonfida.sns");
    expect(Number.isNaN(Date.parse(hit?.resolvedAt ?? ""))).toBe(false);
    expect(snsCalls).toEqual(["bonfida.sns"]);
  });

  it("holds every .sol name as unavailable in transition, never null", async () => {
    const { resolver, snsCalls } = setup();
    for (const input of ["vitalik.sol", " VITALIK.SOL "]) {
      const failure = await resolver
        .resolveName("solana", input)
        .catch((error: unknown) => error);
      expect(isNameResolutionError(failure)).toBe(true);
      expect(failure).toMatchObject({
        kind: "unavailable",
        reason: "sns_sol_transition",
        retryable: true,
      });
    }
    expect(snsCalls).toEqual([]);
  });

  it("rejects other suffixes without a network call", async () => {
    const { resolver, snsCalls } = setup();
    const failure = await resolver
      .resolveName("solana", "bonfida.com")
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: "invalid_input", reason: "bad_suffix" });
    expect(snsCalls).toEqual([]);
  });

  it("rejects bad characters and oversized labels without a call", async () => {
    const { resolver, snsCalls } = setup();
    for (const input of ["bad_!.sns", `${"a".repeat(64)}.sns`, "   "]) {
      const failure = await resolver
        .resolveName("solana", input)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ kind: "invalid_input", reason: "bad_name" });
    }
    expect(snsCalls).toEqual([]);
  });

  it("returns null when the name is unregistered", async () => {
    const { resolver } = setup({
      sns: async () => {
        throw new NotFound("gone");
      },
    });
    await expect(
      resolver.resolveName("solana", "unregistered-xyz.sns"),
    ).resolves.toBeNull();
  });

  it("maps a proxy failure to retryable unavailable", async () => {
    const { resolver } = setup({
      sns: async () => {
        throw new ProviderUnavailable("down");
      },
    });
    const failure = await resolver
      .resolveName("solana", "bonfida.sns")
      .catch((error: unknown) => error);
    expect(isNameResolutionError(failure)).toBe(true);
    expect(failure).toMatchObject({
      kind: "unavailable",
      reason: "sns_proxy",
      retryable: true,
    });
  });

  it("maps a missing key to non-retryable unavailable", async () => {
    const { resolver } = setup({
      sns: async () => {
        throw new ProviderNotConfigured("alchemy");
      },
    });
    const failure = await resolver
      .resolveName("solana", "bonfida.sns")
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      kind: "unavailable",
      reason: "sns_proxy",
      retryable: false,
    });
  });

  it("maps invalid input from the reader explicitly", async () => {
    const { resolver } = setup({
      sns: async () => {
        throw new InvalidInput("bad");
      },
    });
    const failure = await resolver
      .resolveName("solana", "bonfida.sns")
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: "invalid_input", reason: "bad_name" });
  });
});

describe("resolveName with a request cache", () => {
  it("serves the second mention from memory", async () => {
    const { resolver, evmCalls } = setup({ cache: new NameCache() });
    await resolver.resolveName("evm", "vitalik.eth");
    await resolver.resolveName("evm", "VITALIK.eth");
    expect(evmCalls).toEqual(["vitalik.eth"]);
  });

  it("retries after a failure instead of storing it", async () => {
    let calls = 0;
    const { resolver, evmCalls } = setup({
      cache: new NameCache(),
      evm: async () => {
        calls += 1;
        if (calls === 1) throw new ProviderUnavailable("down");
        return VITALIK;
      },
    });
    await expect(resolver.resolveName("evm", "vitalik.eth")).rejects.toMatchObject({
      kind: "unavailable",
    });
    const hit = await resolver.resolveName("evm", "vitalik.eth");
    expect(hit?.address).toBe(VITALIK);
    expect(evmCalls).toEqual(["vitalik.eth", "vitalik.eth"]);
  });
});
