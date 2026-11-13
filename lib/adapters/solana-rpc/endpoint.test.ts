import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderNotConfigured } from "@/lib/ports";
import {
  DEFAULT_SOLANA_ENDPOINT,
  getAlchemySolanaUrl,
  getSolanaEndpoint,
  solanaRpcPort,
} from "./endpoint";

const KEYS = [
  "SOLANA_RPC_PROVIDER",
  "ALCHEMY_API_KEY",
  "NEXT_PUBLIC_SOLANA_RPC",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
});

describe("solana-rpc endpoint adapter", () => {
  it("defaults to the configured public endpoint", () => {
    expect(getSolanaEndpoint()).toBe(DEFAULT_SOLANA_ENDPOINT);
    expect(solanaRpcPort.getEndpoint()).toBe(DEFAULT_SOLANA_ENDPOINT);
  });

  it("honors the configured public override", () => {
    process.env.NEXT_PUBLIC_SOLANA_RPC = "https://example.invalid/";
    expect(getSolanaEndpoint()).toBe("https://example.invalid/");
  });

  it("serves the Alchemy Solana endpoint off the existing key", () => {
    process.env.SOLANA_RPC_PROVIDER = "alchemy";
    process.env.ALCHEMY_API_KEY = "test-key";
    expect(getSolanaEndpoint()).toBe(getAlchemySolanaUrl("test-key"));
    expect(getSolanaEndpoint()).toMatch(/^https:\/\/[^/]+\/v2\//);
  });

  it("throws ProviderNotConfigured when the Alchemy key is missing", () => {
    process.env.SOLANA_RPC_PROVIDER = "alchemy";
    const failure = (() => {
      try {
        getSolanaEndpoint();
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(failure).toBeInstanceOf(ProviderNotConfigured);
    expect((failure as ProviderNotConfigured).retryable).toBe(false);
    expect((failure as ProviderNotConfigured).provider).toBe("alchemy");
  });

  it("throws ProviderNotConfigured for an unknown provider", () => {
    process.env.SOLANA_RPC_PROVIDER = "other";
    expect(() => getSolanaEndpoint()).toThrowError(ProviderNotConfigured);
  });
});
