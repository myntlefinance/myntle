import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getIntentsLedgerBalances,
  intentsAccountId,
} from "./balances";

afterEach(() => {
  vi.unstubAllGlobals();
});

function rpcOk(payload: unknown) {
  return {
    ok: true,
    json: async () => ({
      jsonrpc: "2.0",
      id: "intents-ledger",
      result: {
        result: Array.from(Buffer.from(JSON.stringify(payload))),
      },
    }),
  };
}

describe("intentsAccountId", () => {
  it("keeps named NEAR accounts as-is", () => {
    expect(intentsAccountId("near", "alice.near")).toBe("alice.near");
  });

  it("lowercases EVM addresses", () => {
    expect(
      intentsAccountId("evm", "0x3259ABCDEF12345678901073ABCDEF1234567890"),
    ).toBe("0x3259abcdef12345678901073abcdef1234567890");
  });

  it("hex-encodes Solana addresses to the implicit account", () => {
    // bs58 of 32 zero-bytes is 32 ones; hex is 64 zeros.
    expect(intentsAccountId("solana", "11111111111111111111111111111111")).toBe(
      "0".repeat(64),
    );
  });

  it("returns null for unparseable addresses", () => {
    expect(intentsAccountId("solana", "not-an-address")).toBeNull();
    expect(intentsAccountId("unknown", "0xabc")).toBeNull();
  });
});

describe("getIntentsLedgerBalances", () => {
  it("enumerates then reads the ledger through public views", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/v0/tokens")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                assetId: "nep141:wrap.near",
                symbol: "wNEAR",
                decimals: 24,
                blockchain: "near",
                price: 2,
                contractAddress: "wrap.near",
              },
            ],
          }),
        };
      }
      const body = JSON.parse(String(init?.body));
      seen.push(body.params.method_name);
      if (body.params.method_name === "mt_tokens_for_owner") {
        return rpcOk([{ token_id: "nep141:wrap.near" }]);
      }
      return rpcOk(["2000000000000000000000000"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await getIntentsLedgerBalances("alice.near", "near");
    expect(seen).toEqual(["mt_tokens_for_owner", "mt_batch_balance_of"]);
    expect(res.status).toBe("settled");
    expect(res.balances).toHaveLength(1);
    expect(res.balances[0]).toMatchObject({
      assetId: "nep141:wrap.near",
      symbol: "wNEAR",
      balance: "2",
    });
    expect(res.totalValueUsd).toBe(4);
  });

  it("costs one call for an empty ledger", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/v0/tokens")) {
        return { ok: true, json: async () => ({ data: [] }) };
      }
      return rpcOk([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await getIntentsLedgerBalances("alice.near", "near");
    expect(res.status).toBe("empty");
    // Enumeration only; no catalogue fetch and no balance batch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
