import { describe, expect, it } from "vitest";
import {
  encodeHistoryCursor,
  parseHistoryCursor,
} from "@/lib/db/transactions";
import { historyStateMeta } from "@/components/app/historyCache";

describe("history cursors", () => {
  it("round-trips a page cursor", () => {
    const cursor = {
      createdAt: "2026-10-31T00:00:00.000Z",
      id: "123e4567-e89b-12d3-a456-426614174000",
    };
    expect(parseHistoryCursor(encodeHistoryCursor(cursor))).toEqual(cursor);
  });

  it("rejects tampered cursors", () => {
    expect(parseHistoryCursor(null)).toBeNull();
    expect(parseHistoryCursor("")).toBeNull();
    expect(parseHistoryCursor("no-separator")).toBeNull();
    expect(parseHistoryCursor("not-a-date|abc")).toBeNull();
    expect(parseHistoryCursor("2026-10-31T00:00:00.000Z|")).toBeNull();
  });
});

describe("historyStateMeta", () => {
  it("paints terminal states", () => {
    expect(historyStateMeta("settled")).toEqual({
      label: "Executed",
      tone: "green",
    });
    expect(historyStateMeta("refunded")).toEqual({
      label: "Refunded",
      tone: "neutral",
    });
    expect(historyStateMeta("failed")).toEqual({
      label: "Failed",
      tone: "red",
    });
    expect(historyStateMeta("incomplete_deposit")).toEqual({
      label: "Failed",
      tone: "red",
    });
    expect(historyStateMeta("needs_reconciliation")).toEqual({
      label: "Needs review",
      tone: "orange",
    });
  });

  it("names live states", () => {
    expect(historyStateMeta("processing")).toEqual({
      label: "Processing",
      tone: "accent",
    });
    expect(historyStateMeta("submitted")).toEqual({
      label: "Submitted",
      tone: "accent",
    });
  });

  it("leaves unknown states readable", () => {
    expect(historyStateMeta("mystery")).toEqual({
      label: "mystery",
      tone: "neutral",
    });
  });
});
