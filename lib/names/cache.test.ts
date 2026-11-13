import { describe, expect, it } from "vitest";
import {
  RESOLVED_NAME_TTL_MS,
  UNREGISTERED_NAME_TTL_MS,
  type ResolvedName,
} from "@/lib/ports";
import {
  createRequestMemo,
  NameCache,
  nameCacheKey,
  ttlForNameValue,
} from "./cache";

function resolved(name = "vitalik.eth"): ResolvedName {
  return {
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    name,
    resolvedAt: new Date(0).toISOString(),
  };
}

describe("name cache", () => {
  it("keys entries by chain and normalized name", () => {
    expect(nameCacheKey("evm", "vitalik.eth")).toBe("evm:vitalik.eth");
    expect(nameCacheKey("solana", "bonfida.sns")).toBe("solana:bonfida.sns");
  });

  it("uses the frozen TTLs per value kind", () => {
    expect(ttlForNameValue(resolved())).toBe(RESOLVED_NAME_TTL_MS);
    expect(ttlForNameValue(null)).toBe(UNREGISTERED_NAME_TTL_MS);
  });

  it("misses on absent entries", () => {
    expect(new NameCache().get("evm", "vitalik.eth")).toEqual({ hit: false });
  });

  it("serves success entries until the 10-minute mark", () => {
    const cache = new NameCache();
    cache.set("evm", "vitalik.eth", resolved(), 0);
    expect(cache.get("evm", "vitalik.eth", RESOLVED_NAME_TTL_MS - 1)).toEqual({
      hit: true,
      value: resolved(),
    });
    expect(cache.get("evm", "vitalik.eth", RESOLVED_NAME_TTL_MS)).toEqual({
      hit: false,
    });
  });

  it("holds unregistered entries for the full hour", () => {
    const cache = new NameCache();
    cache.set("evm", "unregistered.eth", null, 0);
    expect(cache.get("evm", "unregistered.eth", UNREGISTERED_NAME_TTL_MS - 1)).toEqual({
      hit: true,
      value: null,
    });
    expect(cache.get("evm", "unregistered.eth", UNREGISTERED_NAME_TTL_MS)).toEqual({
      hit: false,
    });
  });

  it("clears entries on demand", () => {
    const cache = new NameCache();
    cache.set("evm", "vitalik.eth", resolved());
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("evm", "vitalik.eth")).toEqual({ hit: false });
  });
});

describe("request memo", () => {
  it("runs the fresh read once per name per turn", async () => {
    const memo = createRequestMemo();
    let calls = 0;
    const fresh = async () => {
      calls += 1;
      return resolved();
    };
    const first = await memo.resolve("evm", "vitalik.eth", fresh);
    const second = await memo.resolve("evm", "vitalik.eth", fresh);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it("never stores a failure, so the next mention retries", async () => {
    const memo = createRequestMemo();
    let calls = 0;
    const fresh = async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return resolved();
    };
    await expect(memo.resolve("evm", "vitalik.eth", fresh)).rejects.toThrow(
      "transient",
    );
    const retried = await memo.resolve("evm", "vitalik.eth", fresh);
    expect(calls).toBe(2);
    expect(retried).toEqual(resolved());
  });
});
