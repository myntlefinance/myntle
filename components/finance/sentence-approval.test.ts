import { afterEach, describe, expect, it, vi } from "vitest";
import { PasskeyError } from "@/lib/auth/passkey-client";
import type { PasskeySignedIntent } from "@/lib/auth/passkey-signer";
import {
  depositApproval,
  limitOrderApproval,
  swapApproval,
  withdrawalApproval,
} from "./sentence-approval";

/**
 * The clauses a sentence card runs in place of `/api/approve`.
 *
 * Each adapter is a thin join between the card's `runApproval` contract and
 * one Intents route. The tests pin the route, the body, and the signer, so a
 * passkey swap can never drift back onto the wallet route.
 */

const QUOTE_ID = "8a1f7c2e-0c6c-4a54-9a7a-1c2d3e4f5a6b";
const TRANSACTION_ID = "3e6f2b9a-8f11-4d5c-9a1b-2c3d4e5f6a7b";
const ASSET_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT_ADDRESS =
  "e0240dfbadb1bd03ec5f5e1c93899f59a80f1307354d534bd10563d566897a43";
const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
const PAYLOAD = '{"verifying_contract":"intents.far","intents":[]}';

const SIGNED: PasskeySignedIntent = {
  standard: "webauthn",
  payload: "the-exact-payload",
  public_key: "p256:public-key",
  signature: "p256:signature",
  client_data_json: '{"type":"webauthn.get"}',
  authenticator_data: "auth-data",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bodyOf(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* swap                                                                */
/* ------------------------------------------------------------------ */

describe("swapApproval", () => {
  it("runs the intents routes and never /api/approve", async () => {
    const urls: string[] = [];
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (url === "/api/intents/approve") {
          expect(bodyOf(init)).toMatchObject({
            quoteId: QUOTE_ID,
            approvalId: "aitxt-swap-1",
            action: "swap",
            mode: "confidential-intents",
          });
          return jsonResponse({
            transactionId: TRANSACTION_ID,
            depositAddress: "f".repeat(64),
            intent: { standard: "webauthn", payload: SIGNED.payload },
          });
        }
        if (url === "/api/intents/submit") {
          expect(bodyOf(init).signedData).toEqual(SIGNED);
          return jsonResponse({ transactionId: TRANSACTION_ID, intentHash: "hash" });
        }
        throw new Error(`unexpected request ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchSpy);

    const phases: string[] = [];
    const sign = vi.fn(
      async (intent: {
        standard: string;
        payload: string | Record<string, unknown>;
      }) => {
        expect(intent.standard).toBe("webauthn");
        expect(intent.payload).toBe(SIGNED.payload);
        return { ...SIGNED, payload: intent.payload };
      },
    );
    const run = swapApproval({
      quoteId: QUOTE_ID,
      approvalId: "aitxt-swap-1",
      sign,
    });

    const result = await run({
      onPhase: (phase) => phases.push(phase),
    });

    expect(result).toEqual({
      ok: true,
      transactionId: TRANSACTION_ID,
      depositAddress: "f".repeat(64),
    });
    expect(urls).toEqual(["/api/intents/approve", "/api/intents/submit"]);
    expect(urls).not.toContain("/api/approve");
    expect(phases).toEqual(["signing", "submitting"]);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("refuses to request anything without a stored quote", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await swapApproval({
      quoteId: "",
      sign: async (payload) => ({ ...SIGNED, payload }),
    })({ onPhase: () => {} });

    expect(result).toEqual({
      ok: false,
      message: "The quote is no longer available. Ask for a fresh one.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks an expired quote expired, with no error sentence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "expired" }, 409)),
    );

    const result = await swapApproval({
      quoteId: QUOTE_ID,
      sign: async (payload) => ({ ...SIGNED, payload }),
    })({ onPhase: () => {} });

    expect(result).toEqual({
      ok: false,
      message: "The quote expired. Ask for a new one.",
      expired: true,
    });
  });

  it("passes a cancelled prompt through untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/intents/approve") {
          return jsonResponse({
            transactionId: TRANSACTION_ID,
            depositAddress: "f".repeat(64),
            intent: { standard: "webauthn", payload: SIGNED.payload },
          });
        }
        throw new Error("submit must not be called");
      }),
    );

    const result = await swapApproval({
      quoteId: QUOTE_ID,
      sign: async () => {
        throw new PasskeyError(
          "The passkey prompt was cancelled. Nothing was moved.",
        );
      },
    })({ onPhase: () => {} });

    expect(result).toEqual({
      ok: false,
      message: "The passkey prompt was cancelled. Nothing was moved.",
    });
  });
});

/* ------------------------------------------------------------------ */
/* deposit                                                             */
/* ------------------------------------------------------------------ */

describe("depositApproval", () => {
  it("asks the deposit route for the address and nothing else", async () => {
    const urls: string[] = [];
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        expect(bodyOf(init)).toEqual({
          assetId: ASSET_ID,
          amount: "2000000",
          conversationId: null,
          approvalId: "aitxt-deposit-1",
        });
        return jsonResponse({
          transactionId: TRANSACTION_ID,
          depositAddress: DEPOSIT_ADDRESS,
          depositMemo: "memo-1",
          amountIn: "2",
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      },
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await depositApproval({
      assetId: ASSET_ID,
      amount: "2000000",
      approvalId: "aitxt-deposit-1",
    })({ onPhase: () => {} });

    expect(result).toEqual({
      ok: true,
      transactionId: TRANSACTION_ID,
      depositAddress: DEPOSIT_ADDRESS,
      depositMemo: "memo-1",
      amountIn: "2",
      expiresAt: "2099-01-01T00:00:00.000Z",
      deposit: {
        address: DEPOSIT_ADDRESS,
        memo: "memo-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        amountInRaw: "2",
        tokenContract: null,
        chainId: null,
        chainName: null,
        chainSlug: null,
        decimals: null,
        symbol: null,
      },
    });
    expect(urls).toEqual(["/api/intents/deposit"]);
  });

  it("turns a missing approval into the card's own sentence", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await depositApproval({
      assetId: ASSET_ID,
      amount: "2000000",
    })({ onPhase: () => {} });

    expect(result).toEqual({
      ok: false,
      message: "The deposit cannot be confirmed. Ask for a new one.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* withdrawal                                                          */
/* ------------------------------------------------------------------ */

describe("withdrawalApproval", () => {
  it("signs with the session signer and shows the server's destination", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (url === "/api/intents/approve") {
          expect(bodyOf(init)).toMatchObject({
            quoteId: QUOTE_ID,
            action: "withdraw",
            mode: "confidential-withdrawal",
          });
          return jsonResponse({
            transactionId: TRANSACTION_ID,
            depositAddress: "f".repeat(64),
            destination: DESTINATION,
            intent: { standard: "webauthn", payload: PAYLOAD },
            figures: {
              amountInFormatted: "0.5",
              amountOutFormatted: "0.4894",
              minAmountOut: "0.484506",
              withdrawFeeFormatted: "0.0106",
            },
            expiresAt: "2099-01-01T00:00:00.000Z",
          });
        }
        expect(bodyOf(init).signedData).toMatchObject({ payload: PAYLOAD });
        return jsonResponse({ intentHash: "hash" });
      }),
    );

    const sign = vi.fn(async () => ({
      standard: "webauthn",
      payload: PAYLOAD,
      signature: "p256:signature",
    }));
    const result = await withdrawalApproval({
      quoteId: QUOTE_ID,
      approvalId: "aitxt-withdraw-1",
      sign,
    })({ onPhase: () => {} });

    expect(sign).toHaveBeenCalledWith({
      standard: "webauthn",
      payload: PAYLOAD,
    });
    expect(result).toEqual({
      ok: true,
      transactionId: TRANSACTION_ID,
      depositAddress: "f".repeat(64),
      destination: DESTINATION,
      amountIn: "0.5",
      amountOut: "0.4894",
      minAmountOut: "0.484506",
      fee: "0.0106",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    // The withdrawal route, never the wallet one.
    expect(urls).toEqual(["/api/intents/approve", "/api/intents/submit"]);
  });

  it("refuses to request anything without a stored quote", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await withdrawalApproval({
      quoteId: "",
      sign: async () => ({}),
    })({ onPhase: () => {} });

    expect(result).toEqual({
      ok: false,
      message: "The quote is no longer available. Ask for a fresh one.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* limit order                                                         */
/* ------------------------------------------------------------------ */

describe("limitOrderApproval", () => {
  it("creates the order, signs its intent, and submits it", async () => {
    const urls: string[] = [];
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (url === "/api/orders") {
          expect(bodyOf(init)).toMatchObject({
            quoteId: QUOTE_ID,
            approvalId: "aitxt-limit-1",
          });
          return jsonResponse({
            transactionId: TRANSACTION_ID,
            depositAddress: "f".repeat(64),
            order: { orderId: "order_1" },
            intent: { standard: "webauthn", payload: PAYLOAD },
            deposit: { address: "f".repeat(64) },
          });
        }
        if (url === "/api/intents/submit") {
          expect(bodyOf(init).signedData).toEqual(SIGNED);
          return jsonResponse({ transactionId: TRANSACTION_ID });
        }
        throw new Error(`unexpected request ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchSpy);

    const phases: string[] = [];
    const result = await limitOrderApproval({
      quoteId: QUOTE_ID,
      approvalId: "aitxt-limit-1",
      sign: async () => SIGNED,
    })({ onPhase: (phase) => phases.push(phase) });

    expect(result).toEqual({
      ok: true,
      transactionId: TRANSACTION_ID,
      depositAddress: "f".repeat(64),
      orderId: "order_1",
    });
    expect(urls).toEqual(["/api/orders", "/api/intents/submit"]);
    expect(phases).toEqual(["signing", "submitting"]);
  });

  it("returns the deposit metadata for a wallet-funded order without signing", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/orders") {
        return jsonResponse({
          transactionId: TRANSACTION_ID,
          depositAddress: "f".repeat(64),
          order: { orderId: "order_2" },
          deposit: {
            address: "f".repeat(64),
            amountInRaw: "5000000",
            symbol: "USDC",
          },
        });
      }
      throw new Error(`unexpected request ${input}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const sign = vi.fn();

    const result = await limitOrderApproval({
      quoteId: QUOTE_ID,
      sign,
    })({ onPhase: () => {} });

    expect(result).toMatchObject({
      ok: true,
      transactionId: TRANSACTION_ID,
      orderId: "order_2",
      deposit: { symbol: "USDC" },
    });
    expect(sign).not.toHaveBeenCalled();
  });
});
