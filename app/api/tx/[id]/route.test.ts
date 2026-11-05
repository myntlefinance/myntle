import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  getTransactionMock,
  setTransactionStateMock,
  getStatusMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  getTransactionMock: vi.fn(),
  setTransactionStateMock: vi.fn(),
  getStatusMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/db/transactions", () => ({
  getTransaction: getTransactionMock,
  setTransactionState: setTransactionStateMock,
}));

vi.mock("@/lib/intents/service", () => ({
  getStatus: getStatusMock,
}));

import { GET } from "./route";

/**
 * The deposit revisit check.
 *
 * `?refresh=1` is the only path from a card to 1Click, and it makes exactly
 * one check. These tests pin the one-request rule, the restore of a timed-out
 * record while its quote is valid, and the promise that an unavailable check
 * never rewrites the settlement.
 */

const TX = "33333333-3333-4333-8333-333333333333";
const USER = "user-1";
const ACCOUNT = "0x7edf07ede58238026db3f90fc8032633b69b8de5";
const DEPOSIT = "0x1111111111111111111111111111111111111111";
const TOKEN = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ASSET = `nep141:arb-${TOKEN.toLowerCase()}.omft.near`;
const FUTURE = new Date(Date.now() + 60 * 60_000).toISOString();
const PAST = new Date(Date.now() - 60 * 60_000).toISOString();

const session = {
  userId: USER,
  accountKind: "passkey" as const,
  walletId: null,
  passkeyId: "passkey-1",
  intentsAccountId: ACCOUNT,
  chain: "near" as const,
  address: ACCOUNT,
  createdAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
};

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: TX,
    user_id: USER,
    approval_id: "approval-1",
    conversation_id: null,
    state: "needs_reconciliation",
    deposit_address: DEPOSIT,
    workflow_run_id: "run-1",
    recipient: ACCOUNT,
    refund_to: ACCOUNT,
    origin_asset: ASSET,
    destination_asset: ASSET,
    amount_in: "2",
    expected_out: "2",
    refs: {
      mode: "confidential-external",
      assetId: ASSET,
      amount: "2000000",
      toolApprovalId: "aitxt-1",
      depositAddress: DEPOSIT,
      depositMemo: null,
      expiresAt: FUTURE,
      amountInRaw: "2000000",
      tokenContract: TOKEN,
      chainId: 42161,
      chainName: "Arbitrum One",
      chainSlug: "arb",
      decimals: 6,
      symbol: "USDC",
    } as Record<string, unknown>,
    outcome: {},
    created_at: "2026-11-03T12:00:00.000Z",
    updated_at: "2026-11-03T12:00:00.000Z",
    ...overrides,
  };
}

function request(query = ""): Request {
  return new Request(`http://localhost/api/tx/${TX}${query}`);
}

function params() {
  return { params: Promise.resolve({ id: TX }) };
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    state: "pending",
    status: "PENDING_DEPOSIT",
    amountOut: undefined,
    depositAddress: DEPOSIT,
    explorerUrls: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue(session);
  getTransactionMock.mockResolvedValue({ tx: transaction(), events: [] });
  getStatusMock.mockResolvedValue(status());
});

describe("GET /api/tx/[id]?refresh=1", () => {
  it("makes exactly one 1Click check and restores pending from needs_reconciliation", async () => {
    const res = await GET(request("?refresh=1"), params());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(getStatusMock).toHaveBeenCalledTimes(1);
    expect(getStatusMock).toHaveBeenCalledWith(DEPOSIT, null);
    // The quote is still valid, so a timed-out workflow is repaired, not
    // reported as a failed deposit.
    expect(setTransactionStateMock).toHaveBeenCalledTimes(1);
    expect(setTransactionStateMock).toHaveBeenCalledWith(TX, "pending", {});
    expect(body.state).toBe("pending");
    expect(body.statusCheck).toBe("ok");
    expect(body.deposit).toMatchObject({
      address: DEPOSIT,
      amountInRaw: "2000000",
      tokenContract: TOKEN,
      chainId: 42161,
      chainName: "Arbitrum One",
      decimals: 6,
    });
  });

  it("passes a memo-bearing address its memo to the status check", async () => {
    const tx = transaction();
    tx.refs = { ...tx.refs, depositMemo: "memo-1" };
    getTransactionMock.mockResolvedValue({ tx, events: [] });

    await GET(request("?refresh=1"), params());

    expect(getStatusMock).toHaveBeenCalledWith(DEPOSIT, "memo-1");
  });

  it("does not check anything without the refresh flag", async () => {
    const res = await GET(request(), params());
    const body = (await res.json()) as Record<string, unknown>;

    expect(getStatusMock).not.toHaveBeenCalled();
    expect(setTransactionStateMock).not.toHaveBeenCalled();
    expect(body.state).toBe("needs_reconciliation");
    expect(body.statusCheck).toBe("skipped");
  });

  it("keeps the last known state when the check is unavailable", async () => {
    getStatusMock.mockRejectedValue(new Error("1Click is down"));

    const res = await GET(request("?refresh=1"), params());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.state).toBe("needs_reconciliation");
    expect(body.statusCheck).toBe("unavailable");
    // An unavailable check is never written as a settlement outcome.
    expect(setTransactionStateMock).not.toHaveBeenCalled();
  });

  it("writes Expired when PENDING_DEPOSIT is past the stored deadline", async () => {
    const tx = transaction();
    tx.refs = { ...tx.refs, expiresAt: PAST };
    getTransactionMock.mockResolvedValue({ tx, events: [] });

    const body = (await (
      await GET(request("?refresh=1"), params())
    ).json()) as Record<string, unknown>;

    expect(body.state).toBe("expired");
    expect(setTransactionStateMock).toHaveBeenCalledWith(TX, "expired", {});
  });

  it("lets a detected or settled status win over the stored deadline", async () => {
    const tx = transaction();
    tx.refs = { ...tx.refs, expiresAt: PAST };
    getTransactionMock.mockResolvedValue({ tx, events: [] });
    getStatusMock.mockResolvedValue(
      status({
        state: "settled",
        status: "SUCCESS",
        amountOut: "2",
        explorerUrls: ["https://explorer.example/tx/1"],
      }),
    );

    const body = (await (
      await GET(request("?refresh=1"), params())
    ).json()) as Record<string, unknown>;

    expect(body.state).toBe("settled");
    expect(setTransactionStateMock).toHaveBeenCalledWith(TX, "settled", {
      explorerUrls: ["https://explorer.example/tx/1"],
    });
  });

  it("maps a known deposit transaction to a detected record", async () => {
    getStatusMock.mockResolvedValue(
      status({ state: "pending", status: "KNOWN_DEPOSIT_TX" }),
    );

    const body = (await (
      await GET(request("?refresh=1"), params())
    ).json()) as Record<string, unknown>;

    expect(body.state).toBe("confirming");
    expect(setTransactionStateMock).toHaveBeenCalledWith(TX, "confirming", {});
  });

  it("does not refresh a terminal record", async () => {
    getTransactionMock.mockResolvedValue({
      tx: transaction({ state: "settled" }),
      events: [],
    });

    await GET(request("?refresh=1"), params());

    expect(getStatusMock).not.toHaveBeenCalled();
    expect(setTransactionStateMock).not.toHaveBeenCalled();
  });

  it("does not refresh a trade that is not a deposit", async () => {
    const tx = transaction();
    tx.refs = { ...tx.refs, mode: "chain" };
    getTransactionMock.mockResolvedValue({ tx, events: [] });

    await GET(request("?refresh=1"), params());

    expect(getStatusMock).not.toHaveBeenCalled();
    expect(setTransactionStateMock).not.toHaveBeenCalled();
  });
});
