import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionIdentity } from "@/lib/auth/session-identity";
import { chatRequestHeaders, chatSuperUnlocked } from "./chatTransport";

const { tokenMock, unlockedMock } = vi.hoisted(() => ({
  tokenMock: vi.fn(),
  unlockedMock: vi.fn(),
}));

vi.mock("@/lib/intents/user-session", () => ({
  getValidAccessToken: tokenMock,
  isSuperUnlocked: unlockedMock,
}));

const passkeyIdentity: SessionIdentity = {
  kind: "passkey",
  chain: "near",
  address: "0x4f3a000000000000000000000000000000000001",
  accountId: "0x4f3a000000000000000000000000000000000001",
  intentsAccountId: "0x4f3a000000000000000000000000000000000001",
  credentialId: "credential-1",
  publicKey: "p256:test",
  rpId: "myntle.xyz",
};

const walletIdentity: SessionIdentity = {
  kind: "wallet",
  chain: "evm",
  address: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  intentsAccountId: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
};

const account = {
  kind: "evm",
  address: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
};

beforeEach(() => {
  tokenMock.mockReset();
  unlockedMock.mockReset();
});

describe("chatRequestHeaders", () => {
  it("reads a passkey account's token from the passkey key", async () => {
    tokenMock.mockResolvedValue("passkey-token");

    const headers = await chatRequestHeaders({
      identity: passkeyIdentity,
      // A wallet may also be connected; it must not choose the token key.
      account,
    });

    expect(tokenMock).toHaveBeenCalledExactlyOnceWith(
      "passkey",
      passkeyIdentity.accountId,
    );
    expect(headers).toEqual({ "x-intents-access-token": "passkey-token" });
  });

  it("sends no header when a passkey session has no live token", async () => {
    tokenMock.mockResolvedValue(null);

    await expect(
      chatRequestHeaders({ identity: passkeyIdentity, account }),
    ).resolves.toEqual({});
  });

  it("keeps the wallet keyed by the connected wallet", async () => {
    tokenMock.mockResolvedValue("wallet-token");

    const headers = await chatRequestHeaders({
      identity: walletIdentity,
      account,
    });

    expect(tokenMock).toHaveBeenCalledExactlyOnceWith("evm", account.address);
    expect(headers).toEqual({ "x-intents-access-token": "wallet-token" });
  });

  it("keeps a logged-out transport empty", async () => {
    await expect(
      chatRequestHeaders({ identity: null, account: null }),
    ).resolves.toEqual({});
    expect(tokenMock).not.toHaveBeenCalled();
  });
});

describe("chatSuperUnlocked", () => {
  it("asks the passkey key for a passkey session", () => {
    unlockedMock.mockReturnValue(true);

    expect(
      chatSuperUnlocked({ identity: passkeyIdentity, account }),
    ).toBe(true);
    expect(unlockedMock).toHaveBeenCalledExactlyOnceWith(
      "passkey",
      passkeyIdentity.accountId,
    );
  });

  it("keeps the wallet path on the connected wallet", () => {
    unlockedMock.mockReturnValue(false);

    expect(
      chatSuperUnlocked({ identity: walletIdentity, account }),
    ).toBe(false);
    expect(unlockedMock).toHaveBeenCalledExactlyOnceWith("evm", account.address);
  });

  it("stays locked when nothing is signed in", () => {
    unlockedMock.mockReturnValue(false);

    expect(chatSuperUnlocked({ identity: null, account: null })).toBe(false);
  });
});
