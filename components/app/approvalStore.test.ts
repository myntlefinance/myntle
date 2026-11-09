import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getApprovalOutcome,
  getApprovalTx,
  rememberApprovalOutcome,
  rememberApprovalTx,
  resetApprovalStore,
} from "./approvalStore";

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe("approvalStore", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetApprovalStore();
  });

  it("returns recorded transactions in the session", () => {
    rememberApprovalTx("ap-1", { transactionId: "tx-1", depositAddress: "dep-1" });
    expect(getApprovalTx("ap-1")).toEqual({
      transactionId: "tx-1",
      depositAddress: "dep-1",
    });
    expect(getApprovalTx("missing")).toBeUndefined();
  });

  it("paints a remembered terminal outcome across a reload", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    rememberApprovalTx("ap-3", { transactionId: "tx-3", depositAddress: "dep-3" });
    rememberApprovalOutcome("ap-3", "settled");

    // A reload wipes module memory but keeps storage.
    resetApprovalStore();

    expect(getApprovalTx("ap-3")).toEqual({
      transactionId: "tx-3",
      depositAddress: "dep-3",
    });
    expect(getApprovalOutcome("ap-3")).toBe("settled");
  });

  it("round-trips a remembered expired outcome across a reload", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    rememberApprovalOutcome("ap-exp", "expired");

    // A reload wipes module memory but keeps storage.
    resetApprovalStore();

    expect(getApprovalOutcome("ap-exp")).toBe("expired");
  });

  it("ignores corrupt storage instead of throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "not-json{{{",
      setItem: () => {},
      removeItem: () => {},
    });
    expect(() => getApprovalTx("ap-5")).not.toThrow();
    expect(getApprovalTx("ap-5")).toBeUndefined();
    expect(() => getApprovalOutcome("ap-5")).not.toThrow();
  });
});
