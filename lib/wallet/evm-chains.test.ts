import { describe, expect, it } from "vitest";
import { evmChainForSlug } from "./evm-chains";

describe("evmChainForSlug", () => {
  it("resolves the catalogue slugs the desk quotes", () => {
    expect(evmChainForSlug("arb")).toMatchObject({ id: 42161 });
    expect(evmChainForSlug("eth")).toMatchObject({ id: 1 });
    expect(evmChainForSlug("base")).toMatchObject({ id: 8453 });
    expect(evmChainForSlug("op")).toMatchObject({ id: 10 });
    expect(evmChainForSlug("pol")).toMatchObject({ id: 137 });
  });

  it("ignores case and accepts long names", () => {
    expect(evmChainForSlug("ARB")).toMatchObject({ id: 42161 });
    expect(evmChainForSlug("Arbitrum")).toMatchObject({ id: 42161 });
    expect(evmChainForSlug("ethereum")).toMatchObject({ id: 1 });
  });

  it("returns nothing for non-EVM chains and empty input", () => {
    expect(evmChainForSlug("near")).toBeNull();
    expect(evmChainForSlug("sol")).toBeNull();
    expect(evmChainForSlug(null)).toBeNull();
    expect(evmChainForSlug(undefined)).toBeNull();
    expect(evmChainForSlug("")).toBeNull();
  });

  it("carries a display name for the switch prompt", () => {
    expect(evmChainForSlug("arb")?.name).toMatch(/arbitrum/i);
  });
});
