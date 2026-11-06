import { beforeEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./builder";

describe("buildSystemPrompt account kind", () => {
  beforeEach(() => {
    // The override replaces the assembled sections; every test here reads
    // the assembled prompt instead.
    delete process.env.SYSTEM_INSTRUCTIONS;
  });

  it("describes a passkey account as a NEAR Intents account with no wallet", () => {
    const prompt = buildSystemPrompt({
      accountKind: "passkey",
      accountId: "0x4f3a000000000000000000000000000000000001",
      activeAddress: "0x4f3a000000000000000000000000000000000001",
      activeChain: "near",
    });

    expect(prompt).toContain("Passkey account:");
    expect(prompt).toContain("0x4f3a000000000000000000000000000000000001");
    expect(prompt).toContain("NEAR Intents account signed with a passkey");
    expect(prompt).toContain("Never ask the user to connect a wallet");
    expect(prompt).toContain("The balance is confidential");
    expect(prompt).toContain("get_wallet_balances");
    expect(prompt).toContain("get_super_balances");
    expect(prompt).toContain(
      "Never say the account has no funds from the public ledger alone",
    );
    expect(prompt).toContain("propose a deposit");
    expect(prompt).toContain("You never sign");

    // The wallet context would claim a connected wallet at the account
    // address, which a passkey account does not have.
    expect(prompt).not.toContain("Connected wallet:");
  });

  it("leaves the wallet prompt unchanged", () => {
    const address = "0x32596df10ff2ac5acde8406e6adcc8d047921073";

    const implicit = buildSystemPrompt({
      activeAddress: address,
      activeChain: "evm",
    });
    const wallet = buildSystemPrompt({
      accountKind: "wallet",
      activeAddress: address,
      activeChain: "evm",
    });

    expect(wallet).toBe(implicit);
    expect(wallet).toContain("Connected wallet:");
    expect(wallet).toContain(address);
    expect(wallet).not.toContain("Passkey account:");
    // No passkey language leaks into the wallet prompt at all.
    expect(wallet.toLowerCase()).not.toContain("passkey");
  });

  it("keeps the passkey section out when the account kind is unknown", () => {
    const prompt = buildSystemPrompt({
      activeAddress: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
      activeChain: "evm",
    });

    expect(prompt).not.toContain("Passkey account:");
  });
});
