import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";

const { getRunMock, requireSessionMock, getConversationRunMock } = vi.hoisted(
  () => ({
    getRunMock: vi.fn(),
    requireSessionMock: vi.fn(),
    getConversationRunMock: vi.fn(),
  }),
);

vi.mock("workflow/api", () => ({ getRun: getRunMock }));
vi.mock("@/lib/auth/session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/db/conversations", () => ({
  getConversationRun: getConversationRunMock,
}));

import { GET } from "./route";

function runReadable(tailIndex = 7) {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.close();
    },
  });
  return Object.assign(stream, {
    getTailIndex: async () => tailIndex,
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/chat/[id]/stream", () => {
  beforeEach(() => {
    getRunMock.mockReset();
    requireSessionMock.mockReset();
    getConversationRunMock.mockReset();

    requireSessionMock.mockResolvedValue({ userId: "user-1" });
    getConversationRunMock.mockResolvedValue({
      id: "conv-1",
      activeRunId: "run-1",
    });
    getRunMock.mockReturnValue({
      status: Promise.resolve("running"),
      getReadable: vi.fn(() => runReadable()),
    });
  });

  it("replays the chat's run from the requested chunk", async () => {
    const response = await GET(
      new Request("http://localhost/api/chat/slug-1/stream?startIndex=4"),
      params("slug-1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-workflow-run-id")).toBe("run-1");
    expect(response.headers.get("x-workflow-stream-tail-index")).toBe("7");
    expect(getConversationRunMock).toHaveBeenCalledWith("user-1", "slug-1");
    expect(getRunMock).toHaveBeenCalledWith("run-1");
    expect(getRunMock.mock.results[0].value.getReadable).toHaveBeenCalledWith({
      startIndex: 4,
    });
  });

  it("rejects a request without a session", async () => {
    requireSessionMock.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/chat/slug-1/stream?startIndex=0"),
      params("slug-1"),
    );

    expect(response.status).toBe(401);
    expect(getRunMock).not.toHaveBeenCalled();
  });

  it("does not read a run that the chat does not own", async () => {
    getConversationRunMock.mockResolvedValue({
      id: "conv-1",
      activeRunId: null,
    });

    const response = await GET(
      new Request("http://localhost/api/chat/slug-1/stream?startIndex=0"),
      params("slug-1"),
    );

    expect(response.status).toBe(404);
    expect(getRunMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed cursor", async () => {
    const response = await GET(
      new Request("http://localhost/api/chat/slug-1/stream?startIndex=abc"),
      params("slug-1"),
    );

    expect(response.status).toBe(400);
    expect(getRunMock).not.toHaveBeenCalled();
  });
});
