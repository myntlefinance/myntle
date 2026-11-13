import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import type { UIMessage, UIMessageChunk } from "ai";
import { sealTurnSecret } from "@/lib/ai/turn-secret";

const {
  nearAI,
  createTools,
  saveNewUIMessages,
  saveUIMessage,
  buildSystemPrompt,
  sanitizeHistoricalToolData,
  convertToModelMessages,
} = vi.hoisted(() => ({
  nearAI: vi.fn(),
  createTools: vi.fn(() => ({})),
  saveNewUIMessages: vi.fn(
    async (_conversationId: string, _messages: UIMessage[]) => {
      void _conversationId;
      void _messages;
    },
  ),
  saveUIMessage: vi.fn(
    async (_conversationId: string, _message: UIMessage) => {
      void _conversationId;
      void _message;
    },
  ),
  buildSystemPrompt: vi.fn(() => "instructions"),
  sanitizeHistoricalToolData: vi.fn((messages: UIMessage[]) => messages),
  convertToModelMessages: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  convertToModelMessages.mockImplementation(actual.convertToModelMessages);
  return { ...actual, convertToModelMessages };
});

vi.mock("@/lib/ai/provider", () => ({
  nearAI,
  DEFAULT_MODEL: "test-default",
}));

vi.mock("@/lib/ai/tools", () => ({
  createTools,
  TOOL_APPROVALS: { prepare_swap: "user-approval" },
}));

vi.mock("@/lib/ai/prompts", () => ({ buildSystemPrompt }));

vi.mock("@/lib/ai/route-intent", () => ({
  routeIntent: () => ({ domains: ["portfolio"], toolDomains: ["portfolio"] }),
}));

vi.mock("@/lib/ai/messages/prune", () => ({
  pruneHistoricalToolOutputs: (messages: UIMessage[]) => messages,
  backfillApprovedSwapOutputs: (messages: UIMessage[]) => messages,
  sanitizeHistoricalToolData,
}));

vi.mock("@/lib/ai/title", () => ({
  generateTitle: vi.fn(async () => null),
  TITLE_MAX_CHARS: 60,
}));

vi.mock("@/lib/db/conversations", () => ({
  saveNewUIMessages,
  saveUIMessage,
  markConversationRunFinished: vi.fn(async () => {}),
}));

vi.mock("@/lib/db/client", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: async () => ({ error: null }),
        is: async () => ({ error: null }),
      }),
    }),
  }),
}));

import { runChatTurnStep } from "./chat-turn";

function textModel(deltas: string[]) {
  const parts: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    ...deltas.map((delta) => ({
      type: "text-delta" as const,
      id: "t1",
      delta,
    })),
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ];

  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }),
    }),
  });
}

const userMessage: UIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "hello" }],
};

const baseInput = {
  messages: [userMessage],
  model: "test-model",
  conversationId: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  accountKind: "wallet" as const,
  intentsAccountId: null,
  accountId: null,
  activeAddress: null,
  activeChain: null,
  superUnlocked: false,
  superJustUnlocked: false,
  titlePrompt: "",
  nameNewChat: false,
  intentsSecret: null,
};

describe("runChatTurnStep", () => {
  beforeEach(() => {
    process.env.TOOL_APPROVAL_SECRET = "test-approval-secret";
    nearAI.mockReset();
    createTools.mockClear();
    saveNewUIMessages.mockClear();
    saveUIMessage.mockClear();
    buildSystemPrompt.mockClear();
    sanitizeHistoricalToolData.mockClear();
    sanitizeHistoricalToolData.mockImplementation(
      (messages: UIMessage[]) => messages,
    );
    convertToModelMessages.mockClear();
  });

  it("writes the whole answer to the run stream and saves it", async () => {
    nearAI.mockReturnValue(textModel(["Hello", " world"]));

    const chunks: UIMessageChunk[] = [];
    const writable = new WritableStream<UIMessageChunk>({
      write(chunk) {
        chunks.push(chunk);
      },
    });

    await runChatTurnStep(baseInput, writable);

    const streamedText = chunks
      .filter(
        (chunk): chunk is Extract<UIMessageChunk, { type: "text-delta" }> =>
          chunk.type === "text-delta",
      )
      .map((chunk) => chunk.delta)
      .join("");

    expect(streamedText).toBe("Hello world");
    expect(chunks.some((chunk) => chunk.type === "finish")).toBe(true);

    // The start chunk carries the message clock once. A metadata chunk per
    // part would double the stream and reset the message's age on every
    // token; see the comment beside `messageMetadata` in chat-turn.ts.
    const start = chunks.find((chunk) => chunk.type === "start");
    expect((start as { messageMetadata?: unknown })?.messageMetadata).toEqual({
      createdAt: expect.any(String),
    });
    expect(chunks.some((chunk) => chunk.type === "message-metadata")).toBe(
      false,
    );

    expect(nearAI).toHaveBeenCalledWith("test-model");
    expect(saveNewUIMessages).toHaveBeenCalledWith(
      baseInput.conversationId,
      expect.any(Array),
    );

    const saved = saveNewUIMessages.mock.calls[0][1] as UIMessage[];
    const assistant = saved.find((message) => message.role === "assistant");
    const savedText = (assistant?.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    expect(savedText).toBe("Hello world");
  });

  it("opens the sealed token only inside the step", async () => {
    nearAI.mockReturnValue(textModel(["ok"]));

    await runChatTurnStep(
      {
        ...baseInput,
        intentsSecret: sealTurnSecret("live-token"),
      },
      new WritableStream<UIMessageChunk>(),
    );

    expect(createTools).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        intentsAccessToken: "live-token",
      }),
      { domains: ["portfolio"] },
    );
  });

  it("sanitises the history before converting it for the model", async () => {
    nearAI.mockReturnValue(textModel(["ok"]));
    const sentinel = [
      {
        id: "sanitized",
        role: "user",
        parts: [{ type: "text", text: "sanitized sentinel" }],
      },
    ] as UIMessage[];
    sanitizeHistoricalToolData.mockReturnValue(sentinel);

    await runChatTurnStep(baseInput, new WritableStream<UIMessageChunk>());

    expect(sanitizeHistoricalToolData).toHaveBeenCalledTimes(1);
    expect(convertToModelMessages).toHaveBeenCalledWith(sentinel);
  });
});
