import { describe, expect, it } from "vitest";
import type { ConnectedWallet } from "@/lib/wallet/types";
import {
  addressIdentity,
  addressLabel,
  isSelfAddress,
  shortAddr,
  walletKindForChain,
} from "./identity";

describe("walletKindForChain", () => {
  it("maps catalogue chain ids to wallet kinds", () => {
    expect(walletKindForChain("eth")).toBe("evm");
    expect(walletKindForChain("arb")).toBe("evm");
    expect(walletKindForChain("base-mainnet")).toBe("evm");
    expect(walletKindForChain("sol")).toBe("solana");
    expect(walletKindForChain("near")).toBe("near");
  });

  it("never claims an unknown chain", () => {
    expect(walletKindForChain("bitcoin")).toBeNull();
    expect(walletKindForChain("")).toBeNull();
    expect(walletKindForChain(undefined)).toBeNull();
  });
});

describe("isSelfAddress", () => {
  const evm: ConnectedWallet = {
    kind: "evm",
    standard: "erc191",
    address: "0x3259aBcDeF12345678901073",
    signerId: "0x3259aBcDeF12345678901073",
    publicKey: "",
  };

  it("matches across EVM chains regardless of hex casing", () => {
    expect(
      isSelfAddress(evm, "0x3259abcdef12345678901073", "arb"),
    ).toBe(true);
  });

  it("rejects a different address on the same chain", () => {
    expect(isSelfAddress(evm, "0x9999abcdef12345678901073", "eth")).toBe(
      false,
    );
  });

  it("rejects the same string on a foreign chain family", () => {
    expect(isSelfAddress(evm, "0x3259aBcDeF12345678901073", "sol")).toBe(
      false,
    );
  });

  it("rejects unknown chains and missing accounts", () => {
    expect(isSelfAddress(evm, "0x3259abcdef12345678901073", "bitcoin")).toBe(
      false,
    );
    expect(isSelfAddress(null, "0x3259abcdef12345678901073", "eth")).toBe(
      false,
    );
    expect(isSelfAddress(evm, undefined, "eth")).toBe(false);
  });
});

describe("shortAddr", () => {
  it("passes short ids through", () => {
    expect(shortAddr("alice.near")).toBe("alice.near");
  });

  it("truncates long addresses to head and tail", () => {
    expect(shortAddr("0x3259aBcDeF12345678901073")).toBe("0x3259…1073");
  });
});

describe("addressLabel", () => {
  const named: ConnectedWallet = {
    kind: "near",
    standard: "nep413",
    address: "verylongaccountname.near",
    signerId: "verylongaccountname.near",
    publicKey: "",
  };

  it("prefers the wallet app name for the connected wallet", () => {
    const withName: ConnectedWallet = { ...named, walletName: "Meteor" };
    expect(addressLabel(withName, "verylongaccountname.near")).toBe("Meteor");
  });

  it("ignores the wallet name for other addresses", () => {
    const withName: ConnectedWallet = { ...named, walletName: "Meteor" };
    expect(addressLabel(withName, "0x3259abcdef12345678901073")).toBe(
      "0x3259…1073",
    );
  });

  it("shows readable account ids in full", () => {
    expect(addressLabel(named, "verylongaccountname.near")).toBe(
      "verylongaccountname.near",
    );
  });

  it("shortens hex, implicit, and base58 addresses", () => {
    expect(addressLabel(null, "0x3259aBcDeF12345678901073")).toBe(
      "0x3259…1073",
    );
    expect(addressLabel(null, "a".repeat(64))).toBe("aaaaaa…aaaa");
    expect(
      addressLabel(null, "HkU7QmR9vT2wXyZ4pL8sDfG6jK3nB5vC7xY9zA2b"),
    ).toBe("HkU7Qm…zA2b");
  });

  it("shortens 0x ids of any length", () => {
    expect(addressLabel(null, "0x3259abcdef12345")).toBe("0x3259…2345");
  });
});

describe("addressIdentity", () => {
  const wallet: ConnectedWallet = {
    kind: "evm",
    standard: "erc191",
    address: "0x3259aBcDeF12345678901073",
    signerId: "0x3259aBcDeF12345678901073",
    publicKey: "",
    walletName: "MetaMask",
    walletIcon: "https://example.com/mm.png",
  };

  it("bundles name, mark, and selfhood for the connected wallet", () => {
    expect(
      addressIdentity(wallet, "0x3259aBcDeF12345678901073", "arb"),
    ).toEqual({
      address: "0x3259aBcDeF12345678901073",
      label: "MetaMask",
      icon: "https://example.com/mm.png",
      isSelf: true,
    });
  });

  it("withholds name and mark from other addresses", () => {
    expect(
      addressIdentity(wallet, "0x9999aBcDeF12345678901073", "eth"),
    ).toEqual({
      address: "0x9999aBcDeF12345678901073",
      label: "0x9999…1073",
      icon: undefined,
      isSelf: false,
    });
  });
});
