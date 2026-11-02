import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getApprovalTx,
  isApprovalDenied,
  rememberApprovalDenied,
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

  it("records denials", () => {
    expect(isApprovalDenied("ap-2")).toBe(false);
    rememberApprovalDenied("ap-2");
    expect(isApprovalDenied("ap-2")).toBe(true);
  });

  it("survives a reload through localStorage", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    rememberApprovalTx("ap-3", { transactionId: "tx-3", depositAddress: "dep-3" });
    rememberApprovalDenied("ap-4");

    // A reload wipes module memory but keeps storage.
    resetApprovalStore();

    expect(getApprovalTx("ap-3")).toEqual({
      transactionId: "tx-3",
      depositAddress: "dep-3",
    });
    expect(isApprovalDenied("ap-4")).toBe(true);
  });

  it("ignores corrupt storage instead of throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "not-json{{{",
      setItem: () => {},
      removeItem: () => {},
    });
    expect(() => getApprovalTx("ap-5")).not.toThrow();
    expect(getApprovalTx("ap-5")).toBeUndefined();
  });
});
