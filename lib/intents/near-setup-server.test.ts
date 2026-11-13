import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

const {
  getNearBalanceMock,
  isIntentsKeyRegisteredMock,
  isNearFullAccessKeyMock,
  isNearTransactionFinalMock,
  nearSetupFaucetAccountMock,
  getNearSetupGrantMock,
  updateNearSetupGrantMock,
} = vi.hoisted(() => ({
  getNearBalanceMock: vi.fn(),
  isIntentsKeyRegisteredMock: vi.fn(),
  isNearFullAccessKeyMock: vi.fn(),
  isNearTransactionFinalMock: vi.fn(),
  nearSetupFaucetAccountMock: vi.fn(),
  getNearSetupGrantMock: vi.fn(),
  updateNearSetupGrantMock: vi.fn(),
}));

vi.mock("@/lib/near/intents-keys", () => ({
  getNearBalance: getNearBalanceMock,
  isIntentsKeyRegistered: isIntentsKeyRegisteredMock,
  isNearFullAccessKey: isNearFullAccessKeyMock,
  isNearImplicitAccount: (value: string) => /^[0-9a-f]{64}$/i.test(value),
  isNearTransactionFinal: isNearTransactionFinalMock,
  nearSetupFaucetAccount: nearSetupFaucetAccountMock,
  nearSetupGrantYocto: () => "1500000000000000000000",
  nearSetupMinBalanceYocto: () => "1000000000000000000000",
  yoctoToNear: (value: string) =>
    value === "1500000000000000000000" ? "0.0015" : value,
}));

vi.mock("@/lib/db/near-setup", () => ({
  getNearSetupGrant: getNearSetupGrantMock,
  updateNearSetupGrant: updateNearSetupGrantMock,
}));

import {
  getNearSetupState,
  resolveNearSetupKey,
} from "./near-setup-server";

const KEY = "ed25519:C3jXhkGhEx88Gj7XKtUziJKXEBMRaJ67bWFkxJikVxZ2";
const OTHER_KEY = "ed25519:9aqyNsCRrDkq9SceVRCdW1Zs9BmEP8ieJQRJim8iRLF";

const NOW = Date.now();

const SESSION: Session = {
  userId: "user-1",
  accountKind: "wallet",
  walletId: "wallet-1",
  passkeyId: null,
  intentsAccountId: "myntlefinance.near",
  publicKey: KEY,
  chain: "near",
  address: "myntlefinance.near",
  createdAt: NOW - 1000,
  expiresAt: NOW + 60_000,
};

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    userId: "user-1",
    accountId: "myntlefinance.near",
    publicKey: KEY,
    amount: "1500000000000000000000",
    status: "final",
    txHash: "tx-hash",
    error: null,
    createdAt: new Date(NOW - 5_000).toISOString(),
    updatedAt: new Date(NOW - 1_000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  getNearBalanceMock.mockReset().mockResolvedValue(1n);
  isIntentsKeyRegisteredMock.mockReset().mockResolvedValue(false);
  isNearFullAccessKeyMock.mockReset().mockResolvedValue(false);
  isNearTransactionFinalMock.mockReset().mockResolvedValue(false);
  nearSetupFaucetAccountMock.mockReset().mockReturnValue(null);
  getNearSetupGrantMock.mockReset().mockResolvedValue(null);
  updateNearSetupGrantMock.mockReset().mockResolvedValue(undefined);
});

describe("resolveNearSetupKey", () => {
  it("trusts the key that verified at sign-in", async () => {
    await expect(resolveNearSetupKey(SESSION, null)).resolves.toEqual({
      key: KEY,
    });
    expect(isNearFullAccessKeyMock).not.toHaveBeenCalled();
  });

  it("accepts a different full-access key on the same account", async () => {
    isNearFullAccessKeyMock.mockResolvedValue(true);

    await expect(resolveNearSetupKey(SESSION, OTHER_KEY)).resolves.toEqual({
      key: OTHER_KEY,
    });
    expect(isNearFullAccessKeyMock).toHaveBeenCalledWith(
      "myntlefinance.near",
      OTHER_KEY,
    );
  });

  it("rejects a key that is not a full-access key on the account", async () => {
    await expect(resolveNearSetupKey(SESSION, OTHER_KEY)).resolves.toEqual({
      badKey: true,
    });
  });

  it("rejects malformed key material", async () => {
    await expect(resolveNearSetupKey(SESSION, "not-a-key")).resolves.toEqual({
      badKey: true,
    });
  });
});

describe("getNearSetupState", () => {
  it("never asks an EVM or passkey session to set up NEAR", async () => {
    await expect(
      getNearSetupState({ ...SESSION, chain: "evm" }),
    ).resolves.toEqual({ needsSetup: false, registered: false });
    await expect(
      getNearSetupState({ ...SESSION, accountKind: "passkey" }),
    ).resolves.toEqual({ needsSetup: false, registered: false });
  });

  it("skips an implicit NEAR account entirely", async () => {
    await expect(
      getNearSetupState({ ...SESSION, address: "0".repeat(64) }),
    ).resolves.toEqual({
      needsSetup: false,
      registered: false,
      implicit: true,
    });
    expect(isIntentsKeyRegisteredMock).not.toHaveBeenCalled();
  });

  it("closes once the exact key is registered", async () => {
    isIntentsKeyRegisteredMock.mockResolvedValue(true);

    await expect(getNearSetupState(SESSION)).resolves.toEqual({
      needsSetup: false,
      registered: true,
      publicKey: KEY,
    });
    expect(getNearSetupGrantMock).not.toHaveBeenCalled();
  });

  it("offers the grant when the key is unregistered and the balance is low", async () => {
    const state = await getNearSetupState(SESSION);

    expect(state).toMatchObject({
      needsSetup: true,
      registered: false,
      publicKey: KEY,
      amountNear: "0.0015",
      hasGas: false,
      needsFunding: true,
      grant: null,
    });
  });

  it("skips the grant when the account can already pay the fee", async () => {
    getNearBalanceMock.mockResolvedValue(1_200_000_000_000_000_000_000n);

    await expect(getNearSetupState(SESSION)).resolves.toMatchObject({
      needsSetup: true,
      hasGas: true,
      needsFunding: false,
    });
  });

  it("never offers a second grant after a final one, even at zero balance", async () => {
    getNearSetupGrantMock.mockResolvedValue(grant({ status: "final" }));
    getNearBalanceMock.mockResolvedValue(1n);

    const state = await getNearSetupState(SESSION);

    expect(state).toMatchObject({
      needsSetup: true,
      needsFunding: false,
      hasGas: false,
      grant: { status: "final", txHash: "tx-hash" },
    });
  });

  it("never offers a second grant after a failed one", async () => {
    getNearSetupGrantMock.mockResolvedValue(
      grant({ status: "failed", error: "The transfer failed." }),
    );

    await expect(getNearSetupState(SESSION)).resolves.toMatchObject({
      needsSetup: true,
      needsFunding: false,
      grant: { status: "failed" },
    });
  });

  it("resumes a sent grant instead of sending another", async () => {
    getNearSetupGrantMock.mockResolvedValue(grant({ status: "sent" }));
    nearSetupFaucetAccountMock.mockReturnValue("setup.myntle.near");
    isNearTransactionFinalMock.mockResolvedValue(true);

    await expect(getNearSetupState(SESSION)).resolves.toMatchObject({
      needsSetup: true,
      needsFunding: false,
      grant: { status: "final" },
    });
    expect(updateNearSetupGrantMock).toHaveBeenCalledWith("grant-1", {
      status: "final",
    });
  });

  it("marks a stale pending grant failed instead of resending", async () => {
    getNearSetupGrantMock.mockResolvedValue(
      grant({
        status: "pending",
        createdAt: new Date(NOW - 120_000).toISOString(),
      }),
    );

    await expect(getNearSetupState(SESSION)).resolves.toMatchObject({
      needsSetup: true,
      needsFunding: false,
      grant: { status: "failed" },
    });
  });

  it("asks for a key when the session has none and the client sends none", async () => {
    await expect(
      getNearSetupState({ ...SESSION, publicKey: null }),
    ).resolves.toEqual({
      needsSetup: true,
      registered: false,
      needsKey: true,
    });
  });
});
