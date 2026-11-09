import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approvalRecordNeedsRead,
  clearApprovalRecords,
  fetchApprovalRecords,
  pendingApprovalRecordIds,
  readApprovalRecords,
  rememberApprovalDecision,
  rememberApprovalSettlement,
  resetApprovalRecords,
  writeApprovalRecords,
} from "./approvalRecords";

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

const SETTLEMENT = {
  state: "pending",
  transactionId: "tx-1",
  depositAddress: "0xabc",
  deposit: {
    address: "0xabc",
    expiresAt: "2099-01-01T00:00:00.000Z",
    amountInRaw: "1000000",
    tokenContract: "0xusdc",
    chainId: 42161,
    chainName: "Arbitrum One",
    chainSlug: "arb",
    decimals: 6,
    symbol: "USDC",
  },
};

describe("approvalRecords", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    clearApprovalRecords();
    vi.stubGlobal("sessionStorage", fakeStorage());
  });

  it("reads back a decision and a settlement by approval id", () => {
    rememberApprovalDecision("ap-1", "approved");
    rememberApprovalSettlement("ap-2", SETTLEMENT);

    const known = readApprovalRecords(["ap-1", "ap-2", "ap-3"]);
    expect(known.decisions).toEqual({
      "ap-1": "approved",
      "ap-2": "approved",
    });
    expect(known.settlements["ap-2"]).toEqual(SETTLEMENT);
    expect(known.known.has("ap-1")).toBe(true);
    expect(known.known.has("ap-2")).toBe(true);
    expect(known.known.has("ap-3")).toBe(false);
    expect(pendingApprovalRecordIds(["ap-1", "ap-2", "ap-3"])).toEqual(["ap-3"]);
  });

  it("paints a settlement as an approval even without a decision row", () => {
    writeApprovalRecords({
      approvalIds: ["ap-1"],
      settlements: { "ap-1": SETTLEMENT },
    });

    expect(readApprovalRecords(["ap-1"]).decisions["ap-1"]).toBe("approved");
  });

  it("reads only a card whose record can still change", () => {
    // Never read: the card needs its first answer.
    expect(approvalRecordNeedsRead("ap-new")).toBe(true);

    // A denial is final; a card may not be offered again.
    rememberApprovalDecision("ap-denied", "denied");
    expect(approvalRecordNeedsRead("ap-denied")).toBe(false);

    // Approved without a settlement: the card still needs the transaction id
    // and the one-time address before it can poll.
    rememberApprovalDecision("ap-approved", "approved");
    expect(approvalRecordNeedsRead("ap-approved")).toBe(true);

    // A live settlement can still change, and a superseded card does not run
    // the active poll itself, so a visible card asks once.
    rememberApprovalSettlement("ap-approved", SETTLEMENT);
    expect(approvalRecordNeedsRead("ap-approved")).toBe(true);

    // A terminal settlement is final.
    rememberApprovalSettlement("ap-approved", {
      ...SETTLEMENT,
      state: "settled",
    });
    expect(approvalRecordNeedsRead("ap-approved")).toBe(false);
  });

  it("survives a same-tab reload through sessionStorage", () => {
    rememberApprovalDecision("ap-1", "denied");
    rememberApprovalSettlement("ap-2", SETTLEMENT);

    // A reload wipes module memory but keeps the tab's session storage.
    resetApprovalRecords();

    const known = readApprovalRecords(["ap-1", "ap-2"]);
    expect(known.decisions).toEqual({
      "ap-1": "denied",
      "ap-2": "approved",
    });
    expect(known.settlements["ap-2"]).toEqual(SETTLEMENT);
  });

  it("reads one record set and shares the request between callers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            decisions: { "ap-1": "approved" },
            settlements: [
              {
                toolApprovalId: "ap-2",
                state: "pending",
                transactionId: "tx-2",
                depositAddress: "0xdef",
                explorerUrls: ["https://explorer.example/tx/2"],
                statusCheckedAt: "2026-11-02T12:00:00.000Z",
                deposit: null,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    // Two callers for the same ids share one request.
    const first = fetchApprovalRecords(["ap-1", "ap-2"]);
    const second = fetchApprovalRecords(["ap-2", "ap-1"]);
    expect(first).toBe(second);

    const body = await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body?.decisions).toEqual({
      "ap-1": "approved",
      "ap-2": "approved",
    });

    // The answer is cached for the next paint, before any second request.
    expect(readApprovalRecords(["ap-1", "ap-2"]).settlements["ap-2"]).toEqual({
      state: "pending",
      transactionId: "tx-2",
      depositAddress: "0xdef",
      explorerUrls: ["https://explorer.example/tx/2"],
      statusCheckedAt: "2026-11-02T12:00:00.000Z",
      deposit: null,
    });
    expect(pendingApprovalRecordIds(["ap-1", "ap-2"])).toEqual([]);
  });

  it("keeps the last known record when the server read fails", async () => {
    rememberApprovalDecision("ap-1", "approved");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    await expect(fetchApprovalRecords(["ap-1"])).resolves.toBeNull();
    expect(readApprovalRecords(["ap-1"]).decisions["ap-1"]).toBe("approved");
  });

  it("clears both memory and storage on sign-out", () => {
    rememberApprovalDecision("ap-1", "approved");
    clearApprovalRecords();

    resetApprovalRecords();
    expect(readApprovalRecords(["ap-1"]).known.size).toBe(0);
  });
});
