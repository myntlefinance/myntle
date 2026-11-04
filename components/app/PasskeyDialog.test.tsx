import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({
    createPasskeyAccount: vi.fn(),
    signInWithPasskey: vi.fn(),
  }),
}));

import { PasskeyDialog } from "./PasskeyDialog";
import { passkeysAvailable } from "@/lib/auth/passkey-client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PasskeyDialog", () => {
  it("renders nothing when the public flag is off", () => {
    // The browser is capable; the flag alone decides. That makes the test
    // fail if visibility ever drifts back to capability-only.
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    vi.stubEnv("NEXT_PUBLIC_PASSKEY_ENABLED", "false");

    expect(passkeysAvailable()).toBe(false);
    const html = ReactDOMServer.renderToStaticMarkup(
      <PasskeyDialog onClose={() => {}} />,
    );
    expect(html).toBe("");
  });
});
