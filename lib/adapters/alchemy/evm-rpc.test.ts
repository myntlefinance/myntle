import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderNotConfigured, ProviderUnavailable } from "@/lib/ports";
import {
  alchemyEvmRpcPort,
  createAlchemyMainnetClient,
  fetchEnsAddress,
  getAlchemyMainnetUrl,
  type EnsClient,
} from "./evm-rpc";

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.ALCHEMY_API_KEY;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ALCHEMY_API_KEY;
  else process.env.ALCHEMY_API_KEY = originalKey;
});

function stubClient(
  impl: (name: string) => Promise<`0x${string}` | null>,
): EnsClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getEnsAddress({ name }: { name: string }) {
      calls.push(name);
      return impl(name);
    },
  };
}

describe("evm-rpc client factory", () => {
  it("throws ProviderNotConfigured when the key is missing", () => {
    delete process.env.ALCHEMY_API_KEY;
    const failure = (() => {
      try {
        createAlchemyMainnetClient();
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(failure).toBeInstanceOf(ProviderNotConfigured);
    expect((failure as ProviderNotConfigured).retryable).toBe(false);
  });

  it("builds the mainnet URL off the key", () => {
    expect(getAlchemyMainnetUrl("k")).toBe(
      "https://eth-mainnet.g.alchemy.com/v2/k",
    );
  });
});

describe("fetchEnsAddress", () => {
  it("returns the checksummed address", async () => {
    const client = stubClient(async () => VITALIK.toLowerCase() as `0x${string}`);
    const address = await fetchEnsAddress("vitalik.eth", { client });
    expect(address).toBe(VITALIK);
    expect(client.calls).toEqual(["vitalik.eth"]);
  });

  it("returns null when the name is unregistered", async () => {
    const client = stubClient(async () => null);
    await expect(fetchEnsAddress("unregistered12345.eth", { client })).resolves.toBeNull();
  });

  it("reads through an injected client without requiring a key", async () => {
    delete process.env.ALCHEMY_API_KEY;
    const client = stubClient(async () => VITALIK);
    // Injection is the seam tests and probes use; only the default
    // factory path enforces key presence (pinned by the port test below).
    await expect(fetchEnsAddress("vitalik.eth", { client })).resolves.toBe(
      VITALIK,
    );
  });

  it("throws ProviderUnavailable when the RPC fails", async () => {
    const client = stubClient(async () => {
      throw new Error("socket hang up");
    });
    const failure = await fetchEnsAddress("vitalik.eth", { client }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ProviderUnavailable);
    const err = failure as ProviderUnavailable;
    expect(err.retryable).toBe(true);
    expect(err.message).not.toMatch(/alchemy/i);
  });

  it("throws ProviderUnavailable on a hung read", async () => {
    const client = stubClient(() => new Promise(() => {}));
    const failure = await fetchEnsAddress("vitalik.eth", {
      client,
      timeoutMs: 20,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });
});

describe("alchemyEvmRpcPort", () => {
  it("throws ProviderNotConfigured when the key is missing", async () => {
    delete process.env.ALCHEMY_API_KEY;
    await expect(
      alchemyEvmRpcPort.getEnsAddress("vitalik.eth"),
    ).rejects.toThrowError(ProviderNotConfigured);
  });
});
