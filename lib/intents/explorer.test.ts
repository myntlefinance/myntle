import { describe, expect, it } from "vitest";
import { explorerTxUrl, settlementLinks } from "./explorer";

/**
 * The links a settled trade shows.
 *
 * Every fixture here is synthetic. The point is the contract: a hash the API
 * left without a URL still becomes a link on the chain the record named, and
 * a chain with no known explorer produces no link at all.
 */

describe("explorerTxUrl", () => {
  it("builds the EVM page for a known chain", () => {
    expect(explorerTxUrl("arb", "0xabc")).toBe(
      "https://arbiscan.io/tx/0xabc",
    );
    expect(explorerTxUrl("base", "0xdef")).toBe(
      "https://basescan.org/tx/0xdef",
    );
  });

  it("builds the native page for NEAR and Solana", () => {
    expect(explorerTxUrl("near", "71Fqpa")).toBe(
      "https://nearblocks.io/txns/71Fqpa",
    );
    expect(explorerTxUrl("sol", "5J8x")).toBe(
      "https://solscan.io/tx/5J8x",
    );
  });

  it("refuses a chain it cannot point at", () => {
    expect(explorerTxUrl("btc", "abc")).toBeNull();
    expect(explorerTxUrl(null, "abc")).toBeNull();
    expect(explorerTxUrl("arb", "")).toBeNull();
  });
});

describe("settlementLinks", () => {
  it("keeps a URL the API supplied", () => {
    expect(
      settlementLinks([
        {
          chain: "arb",
          hashes: [
            {
              hash: "0xabc",
              explorerUrl: "https://custom.example/tx/0xabc",
            },
          ],
        },
      ]),
    ).toEqual(["https://custom.example/tx/0xabc"]);
  });

  it("builds the link from the hash when the URL is empty", () => {
    expect(
      settlementLinks([
        { chain: "arb", hashes: [{ hash: "0xabc", explorerUrl: "" }] },
        { chain: "near", hashes: [{ hash: "71Fqpa" }] },
      ]),
    ).toEqual([
      "https://arbiscan.io/tx/0xabc",
      "https://nearblocks.io/txns/71Fqpa",
    ]);
  });

  it("drops a hash whose chain has no explorer, and never repeats a link", () => {
    expect(
      settlementLinks([
        { chain: "btc", hashes: [{ hash: "abc" }] },
        {
          chain: "arb",
          hashes: [{ hash: "0xabc" }, { hash: "0xabc" }],
        },
      ]),
    ).toEqual(["https://arbiscan.io/tx/0xabc"]);
  });
});
