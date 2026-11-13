import { beforeEach, describe, expect, it, vi } from "vitest";
import { asSchema } from "ai";
import { nameError } from "@/lib/ports/names";
import {
  createResolveEnsNameTool,
  createResolveSnsNameTool,
} from "./resolve";

const { resolveNameMock } = vi.hoisted(() => ({ resolveNameMock: vi.fn() }));

vi.mock("@/lib/adapters/registry", () => ({
  getNameResolverPort: () => ({ resolveName: resolveNameMock }),
}));

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const BONFIDA = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
const RESOLVED_AT = "2026-11-10T00:00:00.000Z";

const ens = createResolveEnsNameTool();
const sns = createResolveSnsNameTool();

type NameTool = typeof ens | typeof sns;

async function run(tool: NameTool, input: { name: string }) {
  return (await tool.execute(input, {
    toolCallId: "call-name",
    messages: [],
    context: {},
  })) as Record<string, unknown>;
}

beforeEach(() => {
  resolveNameMock.mockReset();
});

describe("resolve_ens_name", () => {
  it("returns the normalized name, public EVM address, chain, and timestamp", async () => {
    resolveNameMock.mockResolvedValue({
      address: VITALIK,
      name: "vitalik.eth",
      resolvedAt: RESOLVED_AT,
    });

    const result = await run(ens, { name: " Vitalik.ETH " });

    expect(resolveNameMock).toHaveBeenCalledWith("evm", "Vitalik.ETH");
    expect(result).toEqual({
      status: "resolved",
      name: "vitalik.eth",
      address: VITALIK,
      chain: "evm",
      resolvedAt: RESOLVED_AT,
    });
  });

  it("rejects a .sns input as invalid without calling the resolver", async () => {
    const result = await run(ens, { name: "bonfida.sns" });

    expect(result).toEqual({
      status: "invalid",
      name: "bonfida.sns",
      chain: "evm",
      message: "That name is not valid. Check the ending and try again.",
    });
    expect(resolveNameMock).not.toHaveBeenCalled();
  });
});

describe("resolve_sns_name", () => {
  it("returns the normalized name, public Solana address, chain, and timestamp", async () => {
    resolveNameMock.mockResolvedValue({
      address: BONFIDA,
      name: "bonfida.sns",
      resolvedAt: RESOLVED_AT,
    });

    const result = await run(sns, { name: " Bonfida.SNS " });

    expect(resolveNameMock).toHaveBeenCalledWith("solana", "Bonfida.SNS");
    expect(result).toEqual({
      status: "resolved",
      name: "bonfida.sns",
      address: BONFIDA,
      chain: "solana",
      resolvedAt: RESOLVED_AT,
    });
  });

  it("rejects a .eth input as invalid without calling the resolver", async () => {
    const result = await run(sns, { name: "vitalik.eth" });

    expect(result).toEqual({
      status: "invalid",
      name: "vitalik.eth",
      chain: "solana",
      message: "That name is not valid. Check the ending and try again.",
    });
    expect(resolveNameMock).not.toHaveBeenCalled();
  });

  it("keeps .sol unavailable without enabling it", async () => {
    const result = await run(sns, { name: "bonfida.sol" });

    expect(result).toEqual({
      status: "unavailable",
      name: "bonfida.sol",
      chain: "solana",
      message: "Name lookup is unavailable. Try again shortly.",
    });
    expect(resolveNameMock).not.toHaveBeenCalled();
  });
});

describe("name lookup failures", () => {
  it("maps an unregistered name to its exact sentence", async () => {
    resolveNameMock.mockResolvedValue(null);

    const result = await run(ens, { name: "nobody.eth" });

    expect(result).toEqual({
      status: "unregistered",
      name: "nobody.eth",
      chain: "evm",
      message: "That name is not registered.",
    });
  });

  it("maps a resolver outage to unavailable", async () => {
    resolveNameMock.mockRejectedValue(
      nameError("unavailable", "ens_rpc", "down"),
    );

    const result = await run(ens, { name: "vitalik.eth" });

    expect(result).toEqual({
      status: "unavailable",
      name: "vitalik.eth",
      chain: "evm",
      message: "Name lookup is unavailable. Try again shortly.",
    });
  });

  it("rethrows an unexpected resolver failure", async () => {
    resolveNameMock.mockRejectedValue(new Error("boom"));

    await expect(run(ens, { name: "vitalik.eth" })).rejects.toThrow("boom");
  });
});

describe("name tool inputs", () => {
  it("declares only a name field and never accepts an address field", async () => {
    for (const tool of [ens, sns]) {
      const schema = await asSchema(tool.inputSchema).jsonSchema;
      const properties =
        (schema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(properties)).toEqual(["name"]);
    }
  });

  it("treats a raw address in the name field as invalid", async () => {
    for (const [tool, chain] of [
      [ens, "evm"],
      [sns, "solana"],
    ] as const) {
      const result = await run(tool, { name: VITALIK });

      expect(result).toMatchObject({ status: "invalid", name: VITALIK, chain });
    }
    expect(resolveNameMock).not.toHaveBeenCalled();
  });
});
