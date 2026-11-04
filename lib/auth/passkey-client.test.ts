import { afterEach, describe, expect, it, vi } from "vitest";
import {
  friendlyPasskeyError,
  PasskeyError,
  passkeysAvailable,
  passkeyUiEnabled,
} from "./passkey-client";

function namedError(name: string, message = ""): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("passkey flags", () => {
  it("is off unless the public value is exactly true", () => {
    vi.stubEnv("NEXT_PUBLIC_PASSKEY_ENABLED", "");
    expect(passkeyUiEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_PASSKEY_ENABLED", "1");
    expect(passkeyUiEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_PASSKEY_ENABLED", "true");
    expect(passkeyUiEnabled()).toBe(true);
  });

  it("hides the entry when the browser has no WebAuthn", () => {
    vi.stubEnv("NEXT_PUBLIC_PASSKEY_ENABLED", "true");
    expect(passkeysAvailable()).toBe(false);
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    expect(passkeysAvailable()).toBe(true);
  });
});

describe("friendlyPasskeyError", () => {
  it("keeps the sentence already written for the user", () => {
    expect(friendlyPasskeyError(new PasskeyError("Sign in instead."))).toBe(
      "Sign in instead.",
    );
  });

  it("turns a cancelled prompt into a plain cancellation", () => {
    expect(friendlyPasskeyError(namedError("NotAllowedError"))).toBe(
      "The passkey prompt was cancelled. Your account was not changed.",
    );
    expect(friendlyPasskeyError(namedError("AbortError"))).toBe(
      "The passkey prompt was cancelled. Your account was not changed.",
    );
  });

  it("explains a credential that is already registered", () => {
    expect(friendlyPasskeyError(namedError("InvalidStateError"))).toBe(
      "This passkey already has an account. Sign in instead.",
    );
  });

  it("explains a passkey created for another site", () => {
    expect(friendlyPasskeyError(namedError("SecurityError"))).toBe(
      "This passkey belongs to a different site. Use the site where you created it.",
    );
    expect(
      friendlyPasskeyError(
        Object.assign(new Error("wrong origin"), {
          code: "ERROR_INVALID_DOMAIN",
        }),
      ),
    ).toBe(
      "This passkey belongs to a different site. Use the site where you created it.",
    );
  });

  it("falls back to one actionable sentence for anything else", () => {
    expect(friendlyPasskeyError(new Error("boom"))).toBe(
      "That passkey did not work. Try again or use a wallet.",
    );
    expect(friendlyPasskeyError("not an error")).toBe(
      "That passkey did not work. Try again or use a wallet.",
    );
  });
});
