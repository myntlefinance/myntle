import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  conversationIdForUserMock,
  getQuoteMock,
  recordToolApprovalMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  conversationIdForUserMock: vi.fn(),
  getQuoteMock: vi.fn(),
  recordToolApprovalMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: () => ({ limited: false, retryAfterMs: 0 }),
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/db/conversations", () => ({
  conversationIdForUser: conversationIdForUserMock,
}));

vi.mock("@/lib/db/transactions", () => ({
  getQuote: getQuoteMock,
}));

vi.mock("@/lib/db/tool-approvals", () => ({
  TOOL_APPROVAL_NAMES: [
    "prepare_swap",
    "prepare_deposit",
    "prepare_withdrawal",
  ],
  recordToolApproval: recordToolApprovalMock,
}));

import { POST } from "./route";

const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const QUOTE_ID = "11111111-1111-4111-8111-111111111111";

const session = {
  userId: "user-1",
  accountKind: "passkey" as const,
  chain: "near" as const,
  address: "0x7edf07ede58238026db3f90fc8032633b69b8de5",
};

function request(body: unknown) {
  return new Request("http://localhost/api/approvals/deny", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const denialBody = {
  approvalId: "aitxt-1",
  toolName: "prepare_swap" as const,
  conversationId: CONVERSATION_ID,
  quoteId: QUOTE_ID,
  requestedAt: new Date().toISOString(),
};

describe("/api/approvals/deny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(session);
    conversationIdForUserMock.mockResolvedValue(CONVERSATION_ID);
    getQuoteMock.mockResolvedValue({ id: QUOTE_ID });
    recordToolApprovalMock.mockResolvedValue({
      decision: "denied",
      toolName: "prepare_swap",
      decidedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("requires a session", async () => {
    requireSessionMock.mockResolvedValue(null);
    const res = await POST(request(denialBody));
    expect(res.status).toBe(401);
    expect(recordToolApprovalMock).not.toHaveBeenCalled();
  });

  it("writes the refusal against the session and the resolved chat", async () => {
    const res = await POST(request(denialBody));

    expect(res.status).toBe(200);
    expect(recordToolApprovalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        toolApprovalId: "aitxt-1",
        toolName: "prepare_swap",
        decision: "denied",
        conversationId: CONVERSATION_ID,
        quoteId: QUOTE_ID,
      }),
    );
    expect(await res.json()).toEqual({
      approvalId: "aitxt-1",
      decision: "denied",
      decidedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("drops a chat and a quote that are not the user's instead of failing", async () => {
    conversationIdForUserMock.mockResolvedValue(null);
    getQuoteMock.mockResolvedValue(null);

    const res = await POST(request(denialBody));

    expect(res.status).toBe(200);
    expect(recordToolApprovalMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null, quoteId: null }),
    );
  });

  it("returns the decision that is actually on record", async () => {
    // The first writer approved it elsewhere; the refusal must not overwrite.
    recordToolApprovalMock.mockResolvedValue({
      decision: "approved",
      toolName: "prepare_swap",
      decidedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await POST(request(denialBody));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({ decision: "approved" }),
    );
  });

  it("rejects a tool that is not a money proposal", async () => {
    const res = await POST(
      request({ ...denialBody, toolName: "get_wallet_balances" }),
    );
    expect(res.status).toBe(400);
    expect(recordToolApprovalMock).not.toHaveBeenCalled();
  });
});
