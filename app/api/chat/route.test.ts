import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

const {
  startMock,
  getSessionMock,
  checkRateLimitMock,
  ensureConversationMock,
  saveUIMessageMock,
  setConversationRunMock,
} = vi.hoisted(() => ({
  startMock: vi.fn(),
  getSessionMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  ensureConversationMock: vi.fn(),
  saveUIMessageMock: vi.fn(async () => {}),
  setConversationRunMock: vi.fn(async () => {}),
}));

vi.mock("workflow/api", () => ({ start: startMock }));
vi.mock("@/workflows/chat-turn", () => ({
  chatTurn: async function chatTurn() {},
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: getSessionMock,
  SESSION_COOKIE: "myntle_session",
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  clientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/db/conversations", () => ({
  ensureConversation: ensureConversationMock,
  saveUIMessage: saveUIMessageMock,
  setConversationRun: setConversationRunMock,
}));

vi.mock("@/lib/ai/provider", () => ({
  DEFAULT_MODEL: "default-model",
}));

vi.mock("@/lib/ai/title", () => ({
  TITLE_MAX_CHARS: 60,
}));

import { POST } from "./route";

const userMessage: UIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "hello" }],
};

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "myntle_session=session-1",
      ...headers,
    },
    body: JSON.stringify({
      messages: [userMessage],
      model: "model-x",
      conversationId: "slug-1",
      title: null,
    }),
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    process.env.NEAR_AI_CLOUD_API_KEY = "near-key";
    process.env.TOOL_APPROVAL_SECRET = "approval-secret";
    startMock.mockReset();
    getSessionMock.mockReset();
    checkRateLimitMock.mockReset();
    ensureConversationMock.mockReset();
    saveUIMessageMock.mockClear();
    setConversationRunMock.mockClear();

    getSessionMock.mockResolvedValue({
      userId: "user-1",
      address: "0xabc",
      chain: "evm",
      accountKind: "wallet",
      intentsAccountId: "acct-1",
    });
    checkRateLimitMock.mockReturnValue({ limited: false });
    ensureConversationMock.mockResolvedValue({
      id: "conv-1",
      slug: "slug-1",
    });
    startMock.mockResolvedValue({
      runId: "run-1",
      readable: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    });
  });

  it("starts a run and records it on the conversation", async () => {
    const response = await POST(request());

    expect(response.headers.get("x-workflow-run-id")).toBe("run-1");
    expect(response.headers.get("x-conversation-id")).toBe("conv-1");
    expect(response.headers.get("x-conversation-slug")).toBe("slug-1");
    expect(setConversationRunMock).toHaveBeenCalledWith(
      "user-1",
      "conv-1",
      "run-1",
    );

    const [workflow, args] = startMock.mock.calls[0];
    expect(typeof workflow).toBe("function");
    const input = args[0];
    expect(input).toMatchObject({
      conversationId: "conv-1",
      userId: "user-1",
      model: "model-x",
      activeAddress: "0xabc",
      activeChain: "evm",
      intentsSecret: null,
    });
  });

  it("seals the access token before it crosses into the run", async () => {
    await POST(request({ "x-intents-access-token": "live-access-token" }));

    const input = startMock.mock.calls[0][1][0];
    expect(input.superUnlocked).toBe(true);
    expect(input.intentsSecret).toMatchObject({ v: 1 });
    expect(JSON.stringify(input)).not.toContain("live-access-token");
  });

  it("refuses a conversation without a session", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(startMock).not.toHaveBeenCalled();
  });
});
