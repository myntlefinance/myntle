import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTurnSecret, sealTurnSecret } from "./turn-secret";

describe("turn secret", () => {
  beforeEach(() => {
    process.env.TOOL_APPROVAL_SECRET = "test-approval-secret";
  });

  afterEach(() => {
    delete process.env.TOOL_APPROVAL_SECRET;
  });

  it("round-trips a token without keeping the plaintext", () => {
    const sealed = sealTurnSecret("live-access-token");
    expect(sealed.v).toBe(1);
    expect(sealed.data).not.toContain("live-access-token");
    expect(openTurnSecret(sealed)).toBe("live-access-token");
  });

  it("rejects a tampered payload", () => {
    const sealed = sealTurnSecret("live-access-token");
    sealed.data = Buffer.from("something else").toString("base64");
    expect(() => openTurnSecret(sealed)).toThrow();
  });

  it("rejects a payload sealed under a different secret", () => {
    const sealed = sealTurnSecret("live-access-token");
    process.env.TOOL_APPROVAL_SECRET = "another-secret";
    expect(() => openTurnSecret(sealed)).toThrow();
  });
});
