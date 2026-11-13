import { describe, expect, it } from "vitest";
import {
  findNamesInText,
  isNameLikeValue,
  nameChainForInput,
  replaceFirstName,
  fetchNamePreview,
} from "./detect";

describe("findNamesInText", () => {
  it("finds a bare .eth name with its chain", () => {
    expect(findNamesInText("vitalik.eth")).toMatchObject([
      { raw: "vitalik.eth", name: "vitalik.eth", chain: "evm" },
    ]);
  });

  it("finds a .sns name mid-sentence", () => {
    const found = findNamesInText("send it to bonfida.sns today");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      raw: "bonfida.sns",
      name: "bonfida.sns",
      chain: "solana",
    });
  });

  it("lowercases the normalized form but keeps the typed slice", () => {
    const found = findNamesInText("Pay Vitalik.Eth now");
    expect(found).toHaveLength(1);
    expect(found[0].raw).toBe("Vitalik.Eth");
    expect(found[0].name).toBe("vitalik.eth");
  });

  it("strips terminal sentence punctuation", () => {
    expect(findNamesInText("Pay vitalik.eth.").map((n) => n.raw)).toEqual([
      "vitalik.eth",
    ]);
    expect(findNamesInText("Pay vitalik.eth, then stop").map((n) => n.raw)).toEqual(
      ["vitalik.eth"],
    );
  });

  it("finds several mentions in order with offsets", () => {
    const text = "vitalik.eth and bonfida.sns";
    const found = findNamesInText(text);
    expect(found).toHaveLength(2);
    expect(text.slice(found[0].start, found[0].end)).toBe("vitalik.eth");
    expect(text.slice(found[1].start, found[1].end)).toBe("bonfida.sns");
  });

  it("ignores .sol, bare words, and near accounts", () => {
    expect(findNamesInText("send to bonfida.sol")).toEqual([]);
    expect(findNamesInText("the beth story")).toEqual([]);
    expect(findNamesInText("pay alice.near today")).toEqual([]);
    expect(findNamesInText("a.ethx is not a name")).toEqual([]);
  });

  it("ignores 0x values and empty input", () => {
    expect(findNamesInText("0xabc.eth")).toEqual([]);
    expect(findNamesInText("")).toEqual([]);
  });
});

describe("nameChainForInput", () => {
  it("scopes .eth to evm and .sns to solana", () => {
    expect(nameChainForInput("vitalik.eth")).toBe("evm");
    expect(nameChainForInput("  Bonfida.SNS ")).toBe("solana");
  });

  it("rejects addresses, other suffixes, and over-length input", () => {
    expect(nameChainForInput("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBeNull();
    expect(nameChainForInput("alice.near")).toBeNull();
    expect(nameChainForInput("bonfida.sol")).toBeNull();
    expect(nameChainForInput("plain")).toBeNull();
    expect(nameChainForInput("")).toBeNull();
    expect(nameChainForInput(null)).toBeNull();
    expect(nameChainForInput(`${"a".repeat(125)}.eth`)).toBeNull();
  });

  it("agrees with isNameLikeValue", () => {
    expect(isNameLikeValue("vitalik.eth")).toBe(true);
    expect(isNameLikeValue("bonfida.sns")).toBe(true);
    expect(isNameLikeValue("0xabc")).toBe(false);
  });
});

describe("replaceFirstName", () => {
  it("swaps the first occurrence only", () => {
    expect(
      replaceFirstName(
        "pay vitalik.eth and vitalik.eth",
        "vitalik.eth",
        "0xd8dA",
      ),
    ).toBe("pay 0xd8dA and vitalik.eth");
  });

  it("leaves the text alone when the name is absent", () => {
    expect(replaceFirstName("pay now", "vitalik.eth", "0x1")).toBe("pay now");
  });
});

describe("fetchNamePreview", () => {
  const body = {
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    name: "vitalik.eth",
    resolvedAt: "2026-11-08T00:00:00.000Z",
  };

  it("returns the address on a 200", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    await expect(fetchNamePreview("vitalik.eth", "evm", fetchImpl)).resolves.toEqual({
      ok: true,
      ...body,
    });
  });

  it("maps status codes without throwing", async () => {
    for (const [status, reason] of [
      [404, "unregistered"],
      [400, "invalid"],
      [503, "unavailable"],
      [401, "unavailable"],
    ] as const) {
      const fetchImpl = (async () =>
        new Response("{}", { status })) as typeof fetch;
      await expect(
        fetchNamePreview("vitalik.eth", "evm", fetchImpl),
      ).resolves.toEqual({ ok: false, reason });
    }
  });

  it("reads a network failure as unavailable", async () => {
    const fetchImpl = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    await expect(
      fetchNamePreview("vitalik.eth", "evm", fetchImpl),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});
