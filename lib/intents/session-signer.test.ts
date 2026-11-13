import { describe, expect, it, vi } from "vitest";
import { signIntentForSession } from "./session-signer";
import { WALLET_NOT_CONNECTED } from "./wallet-signer";

describe("signIntentForSession", () => {
  it("throws the fixed sentence when no wallet is connected", async () => {
    const signer = signIntentForSession({
      identity: null,
      account: null,
      signMessage: vi.fn(),
      signNEP413: vi.fn(),
    });

    await expect(
      signer({ standard: "erc191", payload: "exact-payload" }),
    ).rejects.toThrow(WALLET_NOT_CONNECTED);
    await expect(
      signer({ standard: "erc191", payload: "exact-payload" }),
    ).rejects.toThrow("Connect a wallet first.");
  });
});
