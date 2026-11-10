import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import type {
  PasskeySessionIdentity,
  WalletSessionIdentity,
} from "@/lib/auth/session-identity";
import { PasskeyError } from "@/lib/auth/passkey-client";

const ACCOUNT = "0x4f3a7c1d2e5b8a9c0d1e2f3a4b5c6d7e8f901234";

const state = vi.hoisted(() => ({
  identity: null as unknown,
  built: {
    standard: "webauthn" as const,
    payload:
      '{"signer_id":"0x4f3a","verifying_contract":"intents.near","deadline":"2026-11-02T12:05:00.000Z","nonce":"AA==","intents":[]}',
    nonceBytes: new Uint8Array([0, 0]),
    signerId: "0x4f3a",
    deadline: new Date("2026-11-02T12:05:00.000Z"),
  },
  signed: {
    standard: "webauthn" as const,
    payload:
      '{"signer_id":"0x4f3a","verifying_contract":"intents.near","deadline":"2026-11-02T12:05:00.000Z","nonce":"AA==","intents":[]}',
    public_key: "p256:public-key",
    signature: "p256:signature",
    client_data_json: '{"type":"webauthn.get"}',
    authenticator_data: "authenticator-data",
  },
  buildPasskey: vi.fn(),
  sign: vi.fn(),
  save: vi.fn(),
  notify: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ identity: state.identity }),
}));

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({
    account: null,
    signMessage: vi.fn(),
    signNEP413: vi.fn(),
  }),
}));

vi.mock("@/lib/intents/empty-intent", () => ({
  buildPasskeyEmptyIntent: state.buildPasskey,
  buildEmptyIntent: vi.fn(),
  encodeSignedData: vi.fn(),
}));

vi.mock("@/lib/auth/passkey-signer", () => ({
  signIntentWithPasskey: state.sign,
}));

vi.mock("@/lib/intents/user-session", () => ({
  saveIntentsSession: state.save,
  notifySuperUnlock: state.notify,
  notifySuperClosed: vi.fn(),
  SUPER_UNLOCK_EVENT: "myntle:super-unlock",
  SUPER_CLOSED_EVENT: "myntle:super-closed",
  SUPER_CANCEL_EVENT: "myntle:super-cancel",
  SUPER_CONTINUE_EVENT: "myntle:super-continue",
}));

vi.mock("@/components/app/DialogShell", () => ({
  DialogShell: ({
    title,
    subtitle,
    children,
  }: {
    title?: string;
    subtitle?: string;
    children?: React.ReactNode;
  }) => (
    <div>
      <p>{title}</p>
      <p>{subtitle}</p>
      {children}
    </div>
  ),
}));

import {
  SuperUnlockDialog,
  unlockPrivateBalanceWithPasskey,
} from "./SuperUnlockDialog";

const passkeyIdentity = {
  kind: "passkey",
  chain: "near",
  address: ACCOUNT,
  accountId: ACCOUNT,
  intentsAccountId: ACCOUNT,
  credentialId: "credential-id",
  publicKey: "p256:public-key",
  rpId: "myntle.xyz",
} as PasskeySessionIdentity;

const walletIdentity = {
  kind: "wallet",
  chain: "evm",
  address: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  intentsAccountId: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
} as WalletSessionIdentity;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  state.identity = passkeyIdentity;
  state.buildPasskey.mockReset().mockResolvedValue(state.built);
  state.sign.mockReset().mockResolvedValue(state.signed);
  state.save.mockReset();
  state.notify.mockReset();
  state.fetch
    .mockReset()
    .mockResolvedValue(
      jsonResponse(
        {
          accessToken: "access",
          refreshToken: "refresh",
          expiresIn: 900,
          refreshExpiresIn: 604800,
        },
        201,
      ),
    );
  vi.stubGlobal("fetch", state.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("passkey unlock copy", () => {
  it("names the private balance and never asks for a wallet", () => {
    state.identity = passkeyIdentity;
    const html = ReactDOMServer.renderToStaticMarkup(
      <SuperUnlockDialog onClose={() => {}} />,
    );

    expect(html).toContain("Unlock your private balance");
    expect(html).toContain(
      "Your private balance is read with your passkey. Nothing moves.",
    );
    expect(html.toLowerCase()).not.toContain("wallet");
    expect(html.toLowerCase()).not.toContain("connect");
    expect(html).not.toContain("super account");
  });

  it("keeps the wallet copy for a wallet session", () => {
    state.identity = walletIdentity;
    const html = ReactDOMServer.renderToStaticMarkup(
      <SuperUnlockDialog onClose={() => {}} />,
    );

    expect(html).toContain("Unlock your super account");
    expect(html).toContain(
      "Your private balance inside Myntle. Fund it once, then trade in one signature.",
    );
  });
});

describe("unlockPrivateBalanceWithPasskey", () => {
  it("signs the empty intent, exchanges it, and stores the passkey session", async () => {
    const phases: string[] = [];
    await unlockPrivateBalanceWithPasskey(passkeyIdentity, (phase) =>
      phases.push(phase),
    );

    expect(state.buildPasskey).toHaveBeenCalledWith(ACCOUNT);
    expect(state.sign).toHaveBeenCalledWith(
      state.built.payload,
      passkeyIdentity,
    );
    expect(phases).toEqual(["signing", "authenticating"]);

    expect(state.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = state.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v0/auth/authenticate");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      signedData: state.signed,
    });

    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.save).toHaveBeenCalledWith({
      chain: "passkey",
      address: ACCOUNT,
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 900,
      refreshExpiresIn: 604800,
    });
    expect(state.notify).toHaveBeenCalledTimes(1);
  });

  it("succeeds with no connected wallet", async () => {
    // The mocked `useWallet` above has `account: null`; the flow still runs.
    await expect(
      unlockPrivateBalanceWithPasskey(passkeyIdentity),
    ).resolves.toBeUndefined();
    expect(state.save).toHaveBeenCalledTimes(1);
  });

  it("stores nothing when the auth endpoint refuses the proof", async () => {
    state.fetch.mockResolvedValue(
      jsonResponse({ message: "signature verification failed" }, 401),
    );

    await expect(
      unlockPrivateBalanceWithPasskey(passkeyIdentity),
    ).rejects.toThrow(
      "The private balance could not be unlocked. Please try again.",
    );
    expect(state.save).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("stores nothing for a 201 without both tokens", async () => {
    state.fetch.mockResolvedValue(
      jsonResponse({ accessToken: "access" }, 201),
    );

    await expect(
      unlockPrivateBalanceWithPasskey(passkeyIdentity),
    ).rejects.toThrow(
      "The private balance could not be unlocked. Please try again.",
    );
    expect(state.save).not.toHaveBeenCalled();
  });

  it("reports a service outage when the request fails at the network", async () => {
    state.fetch.mockRejectedValue(new Error("Failed to fetch"));

    await expect(
      unlockPrivateBalanceWithPasskey(passkeyIdentity),
    ).rejects.toThrow(
      "The private balance service is unavailable. Try again later.",
    );
    expect(state.save).not.toHaveBeenCalled();
  });

  it("reports a service outage for a 521 maintenance response", async () => {
    state.fetch.mockResolvedValue(jsonResponse({}, 521));

    await expect(
      unlockPrivateBalanceWithPasskey(passkeyIdentity),
    ).rejects.toThrow(
      "The private balance service is unavailable. Try again later.",
    );
    expect(state.save).not.toHaveBeenCalled();
  });

  it("never calls the auth endpoint after a cancelled prompt", async () => {
    state.sign.mockRejectedValue(
      new PasskeyError("The passkey prompt was cancelled. Nothing was moved."),
    );

    await expect(
      unlockPrivateBalanceWithPasskey(passkeyIdentity),
    ).rejects.toThrow("The passkey prompt was cancelled.");
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
  });
});
