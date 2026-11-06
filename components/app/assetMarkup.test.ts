import { describe, it, expect } from "vitest";
import { stripAssetMarkup } from "@/components/app/assetMarkup";

describe("stripAssetMarkup", () => {
  it("removes the tag from prose and keeps the ticker", () => {
    expect(
      stripAssetMarkup("Your private balance is 4 <asset>USDC</asset>."),
    ).toBe("Your private balance is 4 USDC.");
  });

  it("falls back to the symbol attribute when the label is empty", () => {
    expect(stripAssetMarkup('<asset symbol="USDC"></asset>')).toBe("USDC");
    expect(stripAssetMarkup('<asset symbol="USDC" />')).toBe("USDC");
  });

  it("keeps an unclosed tag's text", () => {
    expect(stripAssetMarkup("Your balance is <asset>USDC after")).toBe(
      "Your balance is USDC after",
    );
  });

  it("leaves code spans and fences untouched", () => {
    expect(stripAssetMarkup("`<asset>USDC</asset>`")).toBe(
      "`<asset>USDC</asset>`",
    );
    const fenced = "```text\n<asset>**USDC** [x]</asset>\n```";
    expect(stripAssetMarkup(fenced)).toBe(fenced);
  });

  it("removes the tag around prose that also contains inline code", () => {
    const input =
      "The balance is <asset>USDC</asset> and the address is `0xabc`.";
    expect(stripAssetMarkup(input)).toBe(
      "The balance is USDC and the address is `0xabc`.",
    );
  });
});
