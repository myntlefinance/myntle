import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  isSuperContinueMessage,
  lastRealUserMessage,
  unlockResolvedAfter,
  withoutSuperContinueMessages,
} from "./continuation";

function user(id: string, text: string, metadata?: unknown): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
    ...(metadata === undefined ? {} : { metadata }),
  } as UIMessage;
}

function assistant(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text: "reply" }],
  } as UIMessage;
}

const continuation = user("u-continue", "Continue.", { superContinue: true });

describe("super unlock continuation", () => {
  it("recognizes only the marked user turn", () => {
    expect(isSuperContinueMessage(continuation)).toBe(true);
    expect(isSuperContinueMessage(user("u1", "What do I hold?"))).toBe(false);
    expect(
      isSuperContinueMessage({
        ...assistant("a1"),
        metadata: { superContinue: true },
      } as UIMessage),
    ).toBe(false);
    expect(isSuperContinueMessage(undefined)).toBe(false);
  });

  it("removes the synthetic turn without reordering the transcript", () => {
    const messages = [
      user("u1", "What is in my super account?"),
      assistant("a1"),
      continuation,
      assistant("a2"),
    ];

    expect(withoutSuperContinueMessages(messages).map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "a2",
    ]);
  });

  it("keeps the newest message the person actually typed", () => {
    const messages = [
      user("u1", "What is in my super account?"),
      assistant("a1"),
      continuation,
      assistant("a2"),
    ];

    expect(lastRealUserMessage(messages)?.id).toBe("u1");
    expect(lastRealUserMessage([continuation, assistant("a1")])).toBeUndefined();
    expect(lastRealUserMessage([])).toBeUndefined();
  });
});

describe("unlockResolvedAfter", () => {
  it("counts the continuation assistant as the answer", () => {
    const messages = [
      user("u1", "What is in my super account?"),
      assistant("a-card"),
      continuation,
      assistant("a-answer"),
    ];
    const visible = withoutSuperContinueMessages(messages);

    expect(unlockResolvedAfter(visible, 1)).toBe(true);
  });

  it("stays resolved when the user moves on afterwards", () => {
    const messages = [
      user("u1", "What is in my super account?"),
      assistant("a-card"),
      assistant("a-answer"),
      user("u2", "Thanks"),
      assistant("a-thanks"),
    ];

    expect(unlockResolvedAfter(messages, 1)).toBe(true);
  });

  it("does not mark a card the user moved past without unlocking", () => {
    const messages = [
      user("u1", "What is in my super account?"),
      assistant("a-card"),
      user("u2", "Never mind, what do I hold?"),
      assistant("a-answer"),
    ];

    expect(unlockResolvedAfter(messages, 1)).toBe(false);
  });

  it("does not mark the last assistant or a user message", () => {
    expect(unlockResolvedAfter([user("u1", "hi"), assistant("a1")], 1)).toBe(
      false,
    );
    expect(unlockResolvedAfter([user("u1", "hi")], 0)).toBe(false);
    expect(unlockResolvedAfter([], 0)).toBe(false);
  });
});
