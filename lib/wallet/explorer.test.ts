import { describe, expect, it } from "vitest";
import { addressExplorerUrl } from "./explorer";

describe("addressExplorerUrl", () => {
  it("points an EVM address at Blockscan", () => {
    expect(
      addressExplorerUrl(
        "evm",
        "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      ),
    ).toBe(
      "https://blockscan.com/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    );
  });

  it("points a NEAR account at NEAR Blocks", () => {
    expect(addressExplorerUrl("near", "myntle.near")).toBe(
      "https://nearblocks.io/address/myntle.near",
    );
  });

  it("points a Solana address at Solscan", () => {
    expect(
      addressExplorerUrl(
        "solana",
        "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
      ),
    ).toBe(
      "https://solscan.io/account/5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    );
  });
});
