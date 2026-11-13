import { describe, expect, it } from "vitest";
import type { EvmRpcPort, SolanaRpcPort } from "./rpc";

describe("rpc port shapes", () => {
  it("reads ENS addresses without exposing a client", async () => {
    const stub: EvmRpcPort = {
      async getEnsAddress(_name: string): Promise<`0x${string}` | null> {
        return "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
      },
    };
    expect(await stub.getEnsAddress("vitalik.eth")).toBe(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    );
    const miss: EvmRpcPort = {
      async getEnsAddress(): Promise<`0x${string}` | null> {
        return null;
      },
    };
    expect(await miss.getEnsAddress("unregistered12345.eth")).toBeNull();
  });

  it("reads the configured Solana endpoint without exposing keys", () => {
    const stub: SolanaRpcPort = {
      getEndpoint(): string {
        return "https://example.invalid/";
      },
    };
    expect(stub.getEndpoint()).toBe("https://example.invalid/");
  });
});
