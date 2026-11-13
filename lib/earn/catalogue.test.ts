import { describe, expect, it } from "vitest";
import {
  earnVaults,
  findEarnVaultByPayment,
  findEarnVaultByReceipt,
} from "./catalogue";

const BASE_USDC =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const ETH_USDC =
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";
const SOL = "nep141:sol.omft.near";

const GTUSDCP =
  "nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near";
const KV_GTSOLB =
  "nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near";
const TLO = "nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near";

describe("earnVaults", () => {
  it("lists the three vaults with the asset ids read from /v0/tokens", () => {
    expect(
      earnVaults().map((vault) => ({
        id: vault.id,
        name: vault.name,
        protocol: vault.protocol,
        chain: vault.chain,
        receiptAssetId: vault.receiptAssetId,
        receiptSymbol: vault.receiptSymbol,
        receiptDecimals: vault.receiptDecimals,
        paymentAssetId: vault.paymentAssetId,
        paymentSymbol: vault.paymentSymbol,
        paymentDecimals: vault.paymentDecimals,
      })),
    ).toEqual([
      {
        id: "gtusdcp",
        name: "USDC Prime",
        protocol: "Morpho",
        chain: "base",
        receiptAssetId: GTUSDCP,
        receiptSymbol: "gtUSDCp",
        receiptDecimals: 18,
        paymentAssetId: BASE_USDC,
        paymentSymbol: "USDC",
        paymentDecimals: 6,
      },
      {
        id: "kv-gtsolb",
        name: "SOL Balanced",
        protocol: "Kamino",
        chain: "sol",
        receiptAssetId: KV_GTSOLB,
        receiptSymbol: "kV-gtSOLb",
        receiptDecimals: 9,
        paymentAssetId: SOL,
        paymentSymbol: "SOL",
        paymentDecimals: 9,
      },
      {
        id: "tlo",
        name: "Taler USDC",
        protocol: "Taler",
        chain: "eth",
        receiptAssetId: TLO,
        receiptSymbol: "TLO",
        receiptDecimals: 8,
        paymentAssetId: ETH_USDC,
        paymentSymbol: "USDC",
        paymentDecimals: 6,
      },
    ]);
  });

  it("names the DefiLlama pools it knows and leaves TLO without one", () => {
    const byId = new Map(earnVaults().map((vault) => [vault.id, vault]));

    expect(byId.get("gtusdcp")?.apyPoolId).toBe(
      "e0672197-9f3e-4414-bca5-e6b4c90aa469",
    );
    expect(byId.get("kv-gtsolb")?.apyPoolId).toBe(
      "9a9cfa6c-8ec9-5d09-857e-aa596901f3ee",
    );
    expect(byId.get("gtusdcp")?.apySourceUrl).toBe(
      "https://defillama.com/yields/pool/e0672197-9f3e-4414-bca5-e6b4c90aa469",
    );
    expect(byId.get("kv-gtsolb")?.apySourceUrl).toBe(
      "https://defillama.com/yields/pool/9a9cfa6c-8ec9-5d09-857e-aa596901f3ee",
    );
    expect(byId.get("tlo")?.apyPoolId).toBeUndefined();
  });

  it("hands out copies, so a caller cannot change the catalogue", () => {
    const first = earnVaults()[0];
    first.name = "Changed";
    first.receiptDecimals = 0;

    expect(earnVaults()[0]).toMatchObject({
      name: "USDC Prime",
      receiptDecimals: 18,
    });
  });
});

describe("findEarnVaultByReceipt", () => {
  it("finds each vault by its exact receipt asset id", () => {
    expect(findEarnVaultByReceipt(GTUSDCP)?.id).toBe("gtusdcp");
    expect(findEarnVaultByReceipt(KV_GTSOLB)?.id).toBe("kv-gtsolb");
    expect(findEarnVaultByReceipt(TLO)?.id).toBe("tlo");
  });

  it("returns null for an unknown id", () => {
    expect(findEarnVaultByReceipt("nep141:unknown")).toBeNull();
    expect(findEarnVaultByReceipt("")).toBeNull();
  });
});

describe("findEarnVaultByPayment", () => {
  it("returns every vault funded by that exact asset", () => {
    expect(findEarnVaultByPayment(BASE_USDC).map((vault) => vault.id)).toEqual([
      "gtusdcp",
    ]);
    expect(findEarnVaultByPayment(ETH_USDC).map((vault) => vault.id)).toEqual([
      "tlo",
    ]);
    expect(findEarnVaultByPayment(SOL).map((vault) => vault.id)).toEqual([
      "kv-gtsolb",
    ]);
  });

  it("returns an empty list for an unknown asset", () => {
    expect(findEarnVaultByPayment("nep141:unknown")).toEqual([]);
  });
});
