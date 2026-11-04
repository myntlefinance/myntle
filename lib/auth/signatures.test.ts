import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyWalletSignature } from "./signatures";

const MESSAGE = `Approve trade on Myntle\n\nSend: 1000000 nep141:usdc\nReceive at least: 990000 nep141:wrap.near\nTo: 0x3259abcdef12345678901073abcdef12345678\nSlippage: 100 bps\nQuote expires: 2026-10-30T00:30:00.000Z\nRequested: 2026-10-30T00:00:00.000Z`;

describe("verifyWalletSignature (evm)", () => {
  it("accepts a signature from the session address", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signature = await account.signMessage({ message: MESSAGE });
    await expect(
      verifyWalletSignature({
        chain: "evm",
        address: account.address,
        message: MESSAGE,
        signature,
      }),
    ).resolves.toBeUndefined();
  });

  it("reports a wallet change when another account signed", async () => {
    const sessionAccount = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const signature = await other.signMessage({ message: MESSAGE });
    await expect(
      verifyWalletSignature({
        chain: "evm",
        address: sessionAccount.address,
        message: MESSAGE,
        signature,
      }),
    ).rejects.toThrow("evm-mismatch");
  });

  it("rejects a malformed signature", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await expect(
      verifyWalletSignature({
        chain: "evm",
        address: account.address,
        message: MESSAGE,
        signature: "0xdead",
      }),
    ).rejects.toThrow();
  });
});
