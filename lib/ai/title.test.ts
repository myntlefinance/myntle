import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));

vi.mock("ai", () => ({ generateText }));
vi.mock("@/lib/ai/provider", () => ({ nearAI: () => "near-model" }));

import { cleanTitle, generateTitle, TITLE_MAX_CHARS, titleProblem } from "./title";

describe("cleanTitle", () => {
  it("keeps a title that already fits", () => {
    expect(cleanTitle("Swap USDC for NEAR")).toBe("Swap USDC for NEAR");
  });

  it("strips wrappers, collapses whitespace, and drops a trailing period", () => {
    expect(cleanTitle("  “Check   NEAR balance.”  ")).toBe("Check NEAR balance");
  });

  it("rejects a title over the word limit instead of cutting it", () => {
    expect(cleanTitle("Check NEAR balance and holdings")).toBeNull();
  });

  it("rejects a title over the character limit instead of cutting it", () => {
    expect(cleanTitle("a".repeat(TITLE_MAX_CHARS + 1))).toBeNull();
  });

  it("rejects a title that ends on a conjunction", () => {
    expect(cleanTitle("Check NEAR balance and")).toBeNull();
    expect(cleanTitle("Top Blue-Chip Assets and")).toBeNull();
  });

  it("rejects an empty answer", () => {
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle('""')).toBeNull();
  });

  it("accepts exactly the word limit", () => {
    expect(cleanTitle("Swap one two three")).toBe("Swap one two three");
  });

  it("accepts exactly the character limit", () => {
    const title = "a".repeat(TITLE_MAX_CHARS);
    expect(cleanTitle(title)).toBe(title);
  });
});

describe("titleProblem", () => {
  it("names the rule the model broke so it can rewrite", () => {
    expect(titleProblem("Check NEAR balance and holdings")).toContain("5 words");
    expect(titleProblem("Check NEAR balance and")).toContain('ends on "and"');
    expect(titleProblem("a".repeat(TITLE_MAX_CHARS + 1))).toContain("characters");
    expect(titleProblem("   ")).toBe("the answer was empty");
    expect(titleProblem("Check NEAR balance")).toBeNull();
  });
});

describe("generateTitle", () => {
  beforeEach(() => {
    vi.stubEnv("NEAR_AI_CLOUD_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    generateText.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps a compliant first answer without asking again", async () => {
    generateText.mockResolvedValueOnce({ text: "Check NEAR balance" });
    await expect(generateTitle("Check NEAR balance")).resolves.toBe(
      "Check NEAR balance",
    );
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("sends a broken title back with the violation instead of cutting it", async () => {
    generateText
      .mockResolvedValueOnce({ text: "Check NEAR balance and holdings" })
      .mockResolvedValueOnce({ text: "Check NEAR balance" });
    await expect(
      generateTitle("Check NEAR balance and holdings"),
    ).resolves.toBe("Check NEAR balance");
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(generateText.mock.calls[1][0].prompt).toContain("5 words");
    expect(generateText.mock.calls[1][0].prompt).toContain(
      "Check NEAR balance and holdings",
    );
  });

  it("leaves the chat untitled when the correction also breaks a rule", async () => {
    generateText.mockResolvedValue({ text: "Check NEAR balance and" });
    await expect(generateTitle("Check NEAR balance")).resolves.toBeNull();
    expect(generateText).toHaveBeenCalledTimes(2);
  });
});
