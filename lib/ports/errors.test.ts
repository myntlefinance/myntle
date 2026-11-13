import { describe, expect, it } from "vitest";
import {
  InvalidInput,
  isPortError,
  isRetryablePortError,
  NotFound,
  ProviderNotConfigured,
  ProviderUnavailable,
} from "./errors";

describe("port error taxonomy", () => {
  it("uses the exact names from the frozen contract", () => {
    expect(new InvalidInput("x").name).toBe("InvalidInput");
    expect(new ProviderUnavailable("x").name).toBe("ProviderUnavailable");
    expect(new NotFound("x").name).toBe("NotFound");
    expect(new ProviderNotConfigured("alchemy").name).toBe(
      "ProviderNotConfigured",
    );
  });

  it("are real Errors with codes", () => {
    expect(new InvalidInput("bad").code).toBe("InvalidInput");
    expect(new ProviderUnavailable("down").code).toBe("ProviderUnavailable");
    expect(new NotFound("gone").code).toBe("NotFound");
    expect(new ProviderNotConfigured("alchemy").code).toBe(
      "ProviderNotConfigured",
    );
    for (const err of [
      new InvalidInput("a"),
      new ProviderUnavailable("b"),
      new NotFound("c"),
      new ProviderNotConfigured("d"),
    ]) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("retries only transient provider failures", () => {
    expect(isRetryablePortError(new ProviderUnavailable("down"))).toBe(true);
    expect(isRetryablePortError(new InvalidInput("bad"))).toBe(false);
    expect(isRetryablePortError(new NotFound("gone"))).toBe(false);
    // A missing key is final until someone configures it, not a retry.
    expect(isRetryablePortError(new ProviderNotConfigured("x"))).toBe(false);
    expect(isRetryablePortError(new Error("other"))).toBe(false);
  });

  it("recognizes every taxonomy member", () => {
    expect(isPortError(new InvalidInput("a"))).toBe(true);
    expect(isPortError(new ProviderUnavailable("b"))).toBe(true);
    expect(isPortError(new NotFound("c"))).toBe(true);
    expect(isPortError(new ProviderNotConfigured("d"))).toBe(true);
    expect(isPortError(new Error("plain"))).toBe(false);
    expect(isPortError(null)).toBe(false);
  });

  it("carries the configured provider and server-side detail", () => {
    const err = new ProviderNotConfigured("alchemy", "ALCHEMY_API_KEY unset");
    expect(err.provider).toBe("alchemy");
    expect(err.detail).toBe("ALCHEMY_API_KEY unset");
    // The message itself stays generic: no provider names reach callers.
    expect(err.message).not.toMatch(/alchemy/i);
  });

  it("keeps provider names out of messages", () => {
    const samples = [
      new InvalidInput("That name is not valid. Check it and try again."),
      new ProviderUnavailable("Balances are unavailable. Try again shortly."),
      new NotFound("No record matches that request."),
      new ProviderNotConfigured("alchemy"),
    ];
    for (const err of samples) {
      expect(err.message).not.toMatch(/alchemy/i);
      expect(err.message).not.toMatch(/fastnear/i);
      expect(err.message).not.toMatch(/bonfida|sns\.id/i);
    }
  });
});
