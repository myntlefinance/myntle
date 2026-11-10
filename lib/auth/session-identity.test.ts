import { describe, expect, it } from "vitest";
import {
  accountScope,
  canSign,
  resolveSignedIn,
  sameAccount,
  sessionAccountFor,
  type SessionIdentity,
} from "./session-identity";

const evm: SessionIdentity = {
  kind: "wallet",
  chain: "evm",
  address: "0x3259abcdef12345678901073",
  intentsAccountId: "0x3259abcdef12345678901073",
};
const evmAccount = { kind: "evm" as const, address: evm.address };
const solana: SessionIdentity = {
  kind: "wallet",
  chain: "solana",
  address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  intentsAccountId: "aabbccdd",
};
const passkey: SessionIdentity = {
  kind: "passkey",
  chain: "near",
  address: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  accountId: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  intentsAccountId: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
  credentialId: "credential-id",
  publicKey: "p256:public-key",
  rpId: "myntle.xyz",
};

describe("sameAccount", () => {
  it("matches an EVM address whatever case the session stored", () => {
    expect(
      sameAccount("evm", "0x3259ABCDEF12345678901073", evm),
    ).toBe(true);
  });

  it("does not match the same address on another chain", () => {
    expect(sameAccount("solana", evm.address, evm)).toBe(false);
  });

  it("keeps Solana and NEAR addresses case-sensitive", () => {
    expect(sameAccount("solana", solana.address.toLowerCase(), solana)).toBe(
      false,
    );
    expect(sameAccount("solana", solana.address, solana)).toBe(true);
  });

  it("never treats a passkey account as the connected wallet", () => {
    expect(sameAccount("near", passkey.address, passkey)).toBe(false);
  });
});

describe("accountScope", () => {
  it("normalizes EVM casing and keeps other chains exact", () => {
    expect(accountScope("evm", "0x3259ABCDEF12345678901073")).toBe(
      "evm:0x3259abcdef12345678901073",
    );
    expect(accountScope("solana", solana.address)).toBe(
      `solana:${solana.address}`,
    );
    expect(accountScope("near", passkey.address)).toBe(
      `near:${passkey.address}`,
    );
  });
});

describe("resolveSignedIn", () => {
  it("is false until the session check answers", () => {
    expect(
      resolveSignedIn({ status: "unknown", identity: evm, account: evmAccount }),
    ).toBe(false);
  });

  it("is true when the session belongs to the connected wallet", () => {
    expect(
      resolveSignedIn({ status: "signed-in", identity: evm, account: evmAccount }),
    ).toBe(true);
  });

  it("is false when the wallet switched to another account", () => {
    expect(
      resolveSignedIn({
        status: "signed-in",
        identity: evm,
        account: { kind: "evm", address: "0x1111111111111111111111111111111111111111" },
      }),
    ).toBe(false);
  });

  it("is false when no wallet is connected, however valid the cookie is", () => {
    expect(
      resolveSignedIn({ status: "signed-in", identity: evm, account: null }),
    ).toBe(false);
  });

  it("is false once signed out", () => {
    expect(
      resolveSignedIn({ status: "signed-out", identity: null, account: evmAccount }),
    ).toBe(false);
  });

  it("is true for a passkey session with no wallet connected", () => {
    expect(
      resolveSignedIn({ status: "signed-in", identity: passkey, account: null }),
    ).toBe(true);
  });

  it("stays true for a passkey session even if another wallet is connected", () => {
    expect(
      resolveSignedIn({
        status: "signed-in",
        identity: passkey,
        account: evmAccount,
      }),
    ).toBe(true);
  });
});

describe("canSign", () => {
  it("is true for a passkey session without a wallet", () => {
    expect(
      canSign({ status: "signed-in", identity: passkey, account: null }),
    ).toBe(true);
  });

  it("is true for a wallet session while the matching wallet is connected", () => {
    expect(
      canSign({ status: "signed-in", identity: evm, account: evmAccount }),
    ).toBe(true);
  });

  it("is false for a wallet session after the wallet switched accounts", () => {
    expect(
      canSign({
        status: "signed-in",
        identity: evm,
        account: {
          kind: "evm",
          address: "0x1111111111111111111111111111111111111111",
        },
      }),
    ).toBe(false);
  });

  it("is false for a wallet session with no connected wallet", () => {
    expect(canSign({ status: "signed-in", identity: evm, account: null })).toBe(
      false,
    );
  });

  it("is false before the session check and after sign-out", () => {
    expect(canSign({ status: "unknown", identity: evm, account: evmAccount })).toBe(
      false,
    );
    expect(
      canSign({
        status: "signed-out",
        identity: null,
        account: evmAccount,
      }),
    ).toBe(false);
  });
});

describe("sessionAccountFor", () => {
  const actual = {
    kind: "evm" as const,
    standard: "erc191" as const,
    address: evm.address,
    signerId: evm.address,
    publicKey: "",
    walletName: "MetaMask",
    walletIcon: "/wallets/metamask.webp",
  };

  it("keeps the signed-in identity while a different funding wallet is connected", () => {
    const account = sessionAccountFor(evm, {
      ...actual,
      address: "0x1111111111111111111111111111111111111111",
      signerId: "0x1111111111111111111111111111111111111111",
      walletName: "Rabby",
    });

    expect(account).toMatchObject({
      kind: "evm",
      address: evm.address,
      signerId: evm.intentsAccountId,
    });
    expect(account?.walletName).toBeUndefined();
  });

  it("keeps the wallet name when the session wallet is still connected", () => {
    expect(sessionAccountFor(evm, actual)).toMatchObject({
      address: evm.address,
      walletName: "MetaMask",
      walletIcon: "/wallets/metamask.webp",
    });
  });

  it("does not invent an identity without a session", () => {
    expect(sessionAccountFor(null, actual)).toBe(actual);
  });
});
