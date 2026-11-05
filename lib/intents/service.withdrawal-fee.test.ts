import { afterEach, describe, expect, it, vi } from "vitest";
import { quote } from "./service";

/**
 * The fee formatting lives on its own module instance so the catalogue this
 * file prices against is the one it asserts. `getAssets` caches for five
 * minutes per module graph, and the fixture decimals are what the assertion
 * is about.
 */

const FROM = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";
const RECIPIENT = "0xb0b14cd82e1f0e6ee391ae3a31a0173aff8373b1";
const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
const SERVER_DEADLINE = "2026-11-05T11:28:18.215Z";

const CATALOGUE = [
  {
    assetId: FROM,
    symbol: "USDC",
    decimals: 6,
    blockchain: "arb",
    price: 1,
    contractAddress: "0xaf88",
  },
];

function jsonResponse(body: unknown, status = 201) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function installFetch(respond: () => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/v0/tokens")) {
        return jsonResponse({ data: CATALOGUE }, 200);
      }
      return respond();
    }),
  );
}

function feeQuote(withdrawFee?: string) {
  return jsonResponse({
    quote: {
      amountIn: "500000",
      amountInFormatted: "0.5",
      amountOut: "489400",
      amountOutFormatted: "0.4894",
      minAmountOut: "484506",
      amountOutUsd: "0.49",
      depositAddress: "f".repeat(64),
      deadline: SERVER_DEADLINE,
      ...(withdrawFee ? { withdrawFee } : {}),
    },
  });
}

const PARAMS = {
  fromAssetId: FROM,
  toAssetId: FROM,
  amount: "500000",
  recipient: DESTINATION,
  refundTo: RECIPIENT,
  mode: "confidential-withdrawal" as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("withdrawal fee", () => {
  it("formats the flat fee in the origin asset's decimals", async () => {
    installFetch(() => feeQuote("10600"));

    const priced = await quote(PARAMS);

    // Measured on Arbitrum USDC: 10600 base units is 0.0106 USDC.
    expect(priced.withdrawFee).toBe("10600");
    expect(priced.withdrawFeeFormatted).toBe("0.0106");
  });

  it("leaves the fee absent when the quote did not report one", async () => {
    installFetch(() => feeQuote());

    const priced = await quote(PARAMS);

    expect(priced.withdrawFee).toBeUndefined();
    expect(priced.withdrawFeeFormatted).toBeUndefined();
  });
});
