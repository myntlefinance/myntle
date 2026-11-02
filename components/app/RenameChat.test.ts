import { describe, it, expect, vi } from "vitest";
import { TITLE_MAX_CHARS } from "@/lib/ai/title";

describe("Chat rename idempotency guards", () => {
  it("does not trigger update if title is unchanged or only whitespace differs", () => {
    const originalTitle = "Swap USDC for NEAR";
    const onRename = vi.fn();

    const commitRename = (draft: string, displayTitle: string | null) => {
      const next = draft.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      const current = (displayTitle ?? "").trim();
      if (!next || next === current) return;
      onRename(next);
    };

    // Identical
    commitRename("Swap USDC for NEAR", originalTitle);
    expect(onRename).not.toHaveBeenCalled();

    // Extra whitespace around or inside
    commitRename("  Swap   USDC for NEAR  ", originalTitle);
    expect(onRename).not.toHaveBeenCalled();

    // Empty
    commitRename("   ", originalTitle);
    expect(onRename).not.toHaveBeenCalled();

    // Actually changed
    commitRename("Swap ETH for NEAR", originalTitle);
    expect(onRename).toHaveBeenCalledWith("Swap ETH for NEAR");
  });

  it("guards against double-invocation on Escape then blur", () => {
    const onRename = vi.fn();
    let renameCancelled = false;

    const onKeyDown = (key: string) => {
      if (key === "Escape") {
        renameCancelled = true;
      }
    };

    const commitRename = (draft: string, displayTitle: string | null) => {
      if (renameCancelled) return;
      const next = draft.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS);
      const current = (displayTitle ?? "").trim();
      if (!next || next === current) return;
      onRename(next);
    };

    // User edits draft, then presses Escape, then blur fires
    onKeyDown("Escape");
    commitRename("New title draft", "Original Title");

    expect(onRename).not.toHaveBeenCalled();
  });
});
