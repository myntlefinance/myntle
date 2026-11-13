import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  listToolApprovalsMock,
  listToolApprovalSettlementsMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  listToolApprovalsMock: vi.fn(),
  listToolApprovalSettlementsMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: () => ({ limited: false, retryAfterMs: 0 }),
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/db/tool-approvals", () => ({
  listToolApprovals: listToolApprovalsMock,
}));

vi.mock("@/lib/db/transactions", () => ({
  listToolApprovalSettlements: listToolApprovalSettlementsMock,
}));

import { POST } from "./route";

const session = {
  userId: "user-1",
  accountKind: "wallet" as const,
  chain: "evm" as const,
  address: "0x3259abcdef12345678901073abcdef1234567890",
};

function request(body: unknown) {
  return new Request("http://localhost/api/approvals/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/approvals/state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(session);
    listToolApprovalsMock.mockResolvedValue({
      "aitxt-1": {
        decision: "denied",
        toolName: "prepare_swap",
        decidedAt: "2026-11-01T00:00:00.000Z",
      },
    });
    listToolApprovalSettlementsMock.mockResolvedValue([
      {
        toolApprovalId: "aitxt-2",
        transactionId: "tx-1",
        state: "settled",
        depositAddress: null,
        explorerUrls: [],
        deposit: null,
      },
    ]);
  });

  it("requires a session", async () => {
    requireSessionMock.mockResolvedValue(null);
    const res = await POST(request({ approvalIds: ["aitxt-1"] }));
    expect(res.status).toBe(401);
    expect(listToolApprovalsMock).not.toHaveBeenCalled();
  });

  it("returns both maps for the ids on screen", async () => {
    const res = await POST(request({ approvalIds: ["aitxt-1", "aitxt-2"] }));

    expect(res.status).toBe(200);
    expect(listToolApprovalsMock).toHaveBeenCalledWith("user-1", [
      "aitxt-1",
      "aitxt-2",
    ]);
    expect(await res.json()).toEqual({
      decisions: { "aitxt-1": "denied" },
      settlements: [
        expect.objectContaining({
          toolApprovalId: "aitxt-2",
          transactionId: "tx-1",
          state: "settled",
        }),
      ],
    });
  });

  it("answers an empty set without reading the database", async () => {
    const res = await POST(request({ approvalIds: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decisions: {}, settlements: [] });
    expect(listToolApprovalsMock).not.toHaveBeenCalled();
    expect(listToolApprovalSettlementsMock).not.toHaveBeenCalled();
  });

  it("rejects a body that is not a list of ids", async () => {
    const res = await POST(request({ approvalIds: "aitxt-1" }));
    expect(res.status).toBe(400);
    expect(listToolApprovalsMock).not.toHaveBeenCalled();
  });
});
