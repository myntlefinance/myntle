import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHoverIntent, HOVER_INTENT_DELAY_MS } from "./hoverIntent";

describe("createHoverIntent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the full dwell before firing", () => {
    const onIntent = vi.fn();
    const hover = createHoverIntent(onIntent);

    hover.enter("chat-1");
    vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS - 1);
    expect(onIntent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith("chat-1");
  });

  it("never fires when the pointer leaves before the dwell", () => {
    const onIntent = vi.fn();
    const hover = createHoverIntent(onIntent);

    hover.enter("chat-1");
    vi.advanceTimersByTime(120);
    hover.leave("chat-1");
    vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS * 2);

    expect(onIntent).not.toHaveBeenCalled();
  });

  it("moves the dwell to the row the pointer settled on", () => {
    const onIntent = vi.fn();
    const hover = createHoverIntent(onIntent);

    hover.enter("chat-1");
    vi.advanceTimersByTime(120);
    hover.enter("chat-2");
    vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS);

    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith("chat-2");
  });

  it("does not restart the dwell when the pointer moves inside one row", () => {
    const onIntent = vi.fn();
    const hover = createHoverIntent(onIntent);

    hover.enter("chat-1");
    vi.advanceTimersByTime(200);
    hover.enter("chat-1");
    vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS - 200);

    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith("chat-1");
  });

  it("ignores touch and pen pointers", () => {
    const onIntent = vi.fn();
    const hover = createHoverIntent(onIntent);

    hover.enter("chat-1", "touch");
    hover.enter("chat-2", "pen");
    vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS * 2);

    expect(onIntent).not.toHaveBeenCalled();
  });

  it("cancels a pending intent on unmount", () => {
    const onIntent = vi.fn();
    const hover = createHoverIntent(onIntent);

    hover.enter("chat-1");
    hover.cancel();
    vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS * 2);

    expect(onIntent).not.toHaveBeenCalled();
  });
});
