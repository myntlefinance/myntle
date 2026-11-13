import { beforeEach, describe, expect, it, vi } from "vitest";

const { readEarnApysMock } = vi.hoisted(() => ({
  readEarnApysMock: vi.fn(),
}));

vi.mock("@/lib/earn/apy", () => ({
  readEarnApys: readEarnApysMock,
}));

import {
  createEarnOptionsTool,
  GET_EARN_OPTIONS_CAPABILITY,
} from "./options";

type VaultOutput = {
  id: string;
  name: string;
  protocol: string;
  chain: string;
  receiptSymbol: string;
  receiptAssetId: string;
  paymentSymbol: string;
  paymentAssetId: string;
  apy: number | null;
  apySource: "DefiLlama" | null;
  note: string;
};

type OptionsOutput = { vaults: VaultOutput[]; note: string };

const BASE_USDC =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const ETH_USDC =
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";
const GTUSDCP =
  "nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near";

const toolOptions = { toolCallId: "call-earn", messages: [], context: {} };

async function run(input: Record<string, unknown> = {}): Promise<OptionsOutput> {
  const earn = createEarnOptionsTool();
  return (await earn.execute!(
    { ...input },
    toolOptions,
  )) as OptionsOutput;
}

beforeEach(() => {
  readEarnApysMock.mockReset();
  readEarnApysMock.mockResolvedValue(
    new Map<string, number | null>([
      ["gtusdcp", 4.50508],
      ["kv-gtsolb", 4.71609],
      ["tlo", null],
    ]),
  );
});

describe("get_earn_options", () => {
  it("declares a public read that needs no approval", () => {
    expect(GET_EARN_OPTIONS_CAPABILITY).toEqual({
      tool: "get_earn_options",
      tier: "read-public",
      subject: "none",
      approval: "none",
      attribution: "none",
      promptTerms: ["get_earn_options"],
    });
  });

  it("tells the model to list before quoting and never guess", () => {
    const earn = createEarnOptionsTool();

    expect(earn.description).toBe(
      "List the yield vaults the user can deposit into. Each result names the vault, " +
        "the protocol, the chain, the receipt token, the payment token, and the current " +
        "APY when the aggregator reports one. Use this before quoting an earn deposit; " +
        "never guess a vault or an APY.",
    );
  });

  it("returns every vault with its receipt, payment, and APY", async () => {
    const result = await run();

    expect(result.vaults.map((vault) => vault.id)).toEqual([
      "gtusdcp",
      "kv-gtsolb",
      "tlo",
    ]);
    expect(result.vaults[0]).toEqual({
      id: "gtusdcp",
      name: "USDC Prime",
      protocol: "Morpho",
      chain: "base",
      receiptSymbol: "gtUSDCp",
      receiptAssetId: GTUSDCP,
      paymentSymbol: "USDC",
      paymentAssetId: BASE_USDC,
      minimumPaymentFormatted: "20",
      apy: 4.50508,
      apySource: "DefiLlama",
      note: "",
    });
    expect(result.vaults[1]).toMatchObject({
      id: "kv-gtsolb",
      protocol: "Kamino",
      chain: "sol",
      apy: 4.71609,
      apySource: "DefiLlama",
    });
  });

  it("keeps a missing rate null and says why", async () => {
    const result = await run();

    const tlo = result.vaults.find((vault) => vault.id === "tlo");
    expect(tlo).toMatchObject({
      apy: null,
      apySource: null,
      note: "DefiLlama lists no APY for this vault.",
    });
  });

  it("carries a note that names the source and promises nothing", async () => {
    const result = await run();

    expect(result.note).toContain(
      "APY is variable and is set by the protocol, not by Myntle. The APY is read " +
        "from DefiLlama and may be stale.",
    );
    expect(result.note).toContain("minimum deposit");
    expect(result.note.toLowerCase()).not.toMatch(
      /guarantee|guaranteed|principal|risk-free|fixed/,
    );
  });

  it("filters by payment symbol, case and surrounding space included", async () => {
    const result = await run({ asset: "  sol " });

    expect(result.vaults.map((vault) => vault.id)).toEqual(["kv-gtsolb"]);
    const passed = readEarnApysMock.mock.calls[0][0] as VaultOutput[];
    expect(passed.map((vault) => vault.id)).toEqual(["kv-gtsolb"]);
  });

  it("filters by full payment asset id", async () => {
    const base = await run({ asset: BASE_USDC });
    const ethereum = await run({ asset: ETH_USDC });

    expect(base.vaults.map((vault) => vault.id)).toEqual(["gtusdcp"]);
    expect(ethereum.vaults.map((vault) => vault.id)).toEqual(["tlo"]);
  });

  it("returns the whole catalogue when the filter matches nothing", async () => {
    const result = await run({ asset: "DOGE" });

    expect(result.vaults).toHaveLength(3);
  });

  it("asks for the APYs once per call", async () => {
    await run();

    expect(readEarnApysMock).toHaveBeenCalledTimes(1);
  });
});
