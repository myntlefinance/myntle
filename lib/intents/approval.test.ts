import { describe, expect, it, vi } from "vitest";
import { PasskeyError } from "@/lib/auth/passkey-client";
import type { PasskeySignedIntent } from "@/lib/auth/passkey-signer";
import {
  approveIntentsTrade,
  approveIntentsWithdrawal,
  createIntentsDeposit,
  formatRawAmount,
} from "./approval";
import { WALLET_NOT_CONNECTED } from "./wallet-signer";

/**
 * The three approval journeys, without a card.
 *
 * Each one is a plain function over `fetch`: it either asks the server for a
 * deposit address, or runs approve → sign → submit. The cards that call them
 * are presentation only, so these tests hold the request sequence and the
 * sentences the server's answers turn into.
 */

const QUOTE_ID = "8a1f7c2e-0c6c-4a54-9a7a-1c2d3e4f5a6b";
const TRANSACTION_ID = "3e6f2b9a-8f11-4d5c-9a1b-2c3d4e5f6a7b";
const ASSET_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT_ADDRESS =
  "e0240dfbadb1bd03ec5f5e1c93899f59a80f1307354d534bd10563d566897a43";
const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
const OTHER_DESTINATION = "0x0000000000000000000000000000000000000001";
const PAYLOAD = '{"verifying_contract":"intents.far","intents":[]}';

const SIGNED: PasskeySignedIntent = {
  standard: "webauthn",
  payload: "the-exact-payload",
  public_key: "p256:public-key",
  signature: "p256:signature",
  client_data_json: '{"type":"webauthn.get"}',
  authenticator_data: "auth-data",
};

const SIGNED_WITHDRAWAL = {
  standard: "webauthn",
  payload: PAYLOAD,
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

function prepared(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: TRANSACTION_ID,
    depositAddress: "f".repeat(64),
    destination: DESTINATION,
    intent: { standard: "webauthn", payload: PAYLOAD },
    figures: {
      amountIn: "500000",
      amountInFormatted: "0.5",
      amountOut: "489400",
      amountOutFormatted: "0.4894",
      minAmountOut: "0.484506",
      withdrawFee: "10600",
      withdrawFeeFormatted: "0.0106",
    },
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* the swap                                                            */
/* ------------------------------------------------------------------ */

/** A fetch double that records the order of the calls the swap makes. */
function swapFetch(
  order: string[],
  submit: (body: Record<string, unknown>) => Response,
  preparedBody: Record<string, unknown> = {
    transactionId: TRANSACTION_ID,
    depositAddress: "0xdeposit",
    intent: { standard: "webauthn", payload: SIGNED.payload },
  },
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = bodyOf(init);
    if (url === "/api/intents/approve") {
      order.push("approve");
      return jsonResponse(preparedBody);
    }
    if (url === "/api/intents/submit") {
      order.push("submit");
      expect(body.transactionId).toBe(TRANSACTION_ID);
      return submit(body);
    }
    throw new Error(`unexpected request ${url}`);
  }) as unknown as typeof fetch;
}

describe("approveIntentsTrade", () => {
  it("approves, signs the returned payload, submits, then reports the trade", async () => {
    const order: string[] = [];
    const sign = vi.fn(
      async (intent: {
        standard: string;
        payload: string | Record<string, unknown>;
      }) => {
        order.push("sign");
        expect(intent).toEqual({
          standard: "webauthn",
          payload: SIGNED.payload,
        });
        return { ...SIGNED, payload: intent.payload };
      },
    );
    const onSubmitted = vi.fn(() => order.push("onApprove"));
    const fetchImpl = swapFetch(order, (body) => {
      expect(body.signedData).toEqual(SIGNED);
      return jsonResponse({
        transactionId: TRANSACTION_ID,
        intentHash: "hash",
      });
    });

    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      conversationId: null,
      approvalId: "aitxt-1",
      sign,
      onSubmitted,
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      transactionId: TRANSACTION_ID,
      depositAddress: "0xdeposit",
      intentHash: "hash",
    });
    // The order is the contract: prepare, sign, submit, continue the turn.
    expect(order).toEqual(["approve", "sign", "submit", "onApprove"]);
    expect(onSubmitted).toHaveBeenCalledWith({
      transactionId: TRANSACTION_ID,
      depositAddress: "0xdeposit",
    });
  });

  it("sends only the stored-quote reference and the confidential mode", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/intents/approve") {
          sent = bodyOf(init);
          return jsonResponse({
            transactionId: TRANSACTION_ID,
            depositAddress: "0xdeposit",
            intent: { standard: "webauthn", payload: SIGNED.payload },
          });
        }
        return jsonResponse({ intentHash: "hash" });
      },
    ) as unknown as typeof fetch;

    await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign: async (payload) => ({ ...SIGNED, payload }),
      fetchImpl,
    });

    expect(sent).toEqual({
      quoteId: QUOTE_ID,
      conversationId: null,
      approvalId: null,
      action: "swap",
      mode: "confidential-intents",
    });
  });

  it("leaves the card retryable when the server rejects the signature", async () => {
    const order: string[] = [];
    const sign = vi.fn(
      async (intent: {
        standard: string;
        payload: string | Record<string, unknown>;
      }) => ({ ...SIGNED, payload: intent.payload }),
    );
    const onSubmitted = vi.fn();

    const rejected = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign,
      onSubmitted,
      fetchImpl: swapFetch(order, () =>
        jsonResponse({ error: "An error occurred." }, 401),
      ),
    });

    expect(rejected).toEqual({
      ok: false,
      reason: "signature",
      message: "Nothing was moved. The signature was not accepted.",
    });
    expect(onSubmitted).not.toHaveBeenCalled();

    // The same card can try again: the stored payload is still the one to
    // sign, and a fresh assertion is accepted.
    const retried = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign,
      onSubmitted,
      fetchImpl: swapFetch(order, () =>
        jsonResponse({ intentHash: "hash" }),
      ),
    });
    expect(retried.ok).toBe(true);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it("reports a cancelled prompt and submits nothing", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/intents/approve") {
        return jsonResponse({
          transactionId: TRANSACTION_ID,
          depositAddress: "0xdeposit",
          intent: { standard: "webauthn", payload: SIGNED.payload },
        });
      }
      throw new Error("submit must not be called");
    }) as unknown as typeof fetch;

    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign: async () => {
        throw new PasskeyError(
          "The passkey prompt was cancelled. Nothing was moved.",
        );
      },
      fetchImpl,
    });

    expect(result).toEqual({
      ok: false,
      reason: "signature",
      message: "The passkey prompt was cancelled. Nothing was moved.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("turns an expired stored quote into a plain sentence", async () => {
    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign: async (payload) => ({ ...SIGNED, payload }),
      fetchImpl: vi.fn(async () =>
        jsonResponse({ error: "expired", message: "x" }, 409),
      ) as unknown as typeof fetch,
    });
    expect(result).toEqual({
      ok: false,
      reason: "expired",
      message: "The quote expired. Ask for a new one.",
    });
  });

  it("refuses a payload that differs from the one the server stored", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/intents/approve") {
        return jsonResponse({
          transactionId: TRANSACTION_ID,
          depositAddress: "0xdeposit",
          intent: { standard: "webauthn", payload: SIGNED.payload },
        });
      }
      throw new Error("submit must not be called");
    }) as unknown as typeof fetch;

    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign: async () => ({ ...SIGNED, payload: "re-stringified" }),
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      reason: "signature",
      message: "Nothing was moved. The signature was not accepted.",
    });
  });

  it("accepts the ERC-191 standard a wallet session receives", async () => {
    const payload = "the-exact-erc191-payload";
    const signed = {
      standard: "erc191",
      payload,
      signature: "secp256k1:signature",
    };
    const sign = vi.fn(
      async (intent: {
        standard: string;
        payload: string | Record<string, unknown>;
      }) => {
        expect(intent).toEqual({ standard: "erc191", payload });
        return signed;
      },
    );
    const order: string[] = [];

    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign,
      fetchImpl: swapFetch(
        order,
        (body) => {
          expect(body.signedData).toEqual(signed);
          return jsonResponse({ intentHash: "hash" });
        },
        {
          transactionId: TRANSACTION_ID,
          depositAddress: "0xdeposit",
          intent: { standard: "erc191", payload },
        },
      ),
    });

    expect(result).toEqual({
      ok: true,
      transactionId: TRANSACTION_ID,
      depositAddress: "0xdeposit",
      intentHash: "hash",
    });
    expect(order).toEqual(["approve", "submit"]);
  });

  it("signs a NEP-413 envelope as an object and submits it", async () => {
    const envelope = {
      message: PAYLOAD,
      recipient: "intents.far",
      nonce: "stored-nonce",
    };
    const signed = {
      standard: "nep413",
      payload: envelope,
      signature: "ed25519:signature",
      public_key: "ed25519:key",
    };
    const sign = vi.fn(
      async (intent: {
        standard: string;
        payload: string | Record<string, unknown>;
      }) => {
        expect(intent).toEqual({ standard: "nep413", payload: envelope });
        return signed;
      },
    );

    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign,
      fetchImpl: swapFetch(
        [],
        (body) => {
          expect(body.signedData).toEqual(signed);
          return jsonResponse({ intentHash: "hash" });
        },
        {
          transactionId: TRANSACTION_ID,
          depositAddress: "0xdeposit",
          intent: { standard: "nep413", payload: envelope },
        },
      ),
    });

    expect(result.ok).toBe(true);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("refuses a NEP-413 envelope whose field changed before submit", async () => {
    const envelope = {
      message: PAYLOAD,
      recipient: "intents.far",
      nonce: "stored-nonce",
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/intents/approve") {
        return jsonResponse({
          transactionId: TRANSACTION_ID,
          depositAddress: "0xdeposit",
          intent: { standard: "nep413", payload: envelope },
        });
      }
      throw new Error("submit must not be called");
    }) as unknown as typeof fetch;

    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign: async () => ({
        standard: "nep413",
        payload: { ...envelope, recipient: "someone-else.near" },
        signature: "ed25519:signature",
        public_key: "ed25519:key",
      }),
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "signature",
      message: "Nothing was moved. The signature was not accepted.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces only the wallet's own rejection sentence", async () => {
    const rejected = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign: async () => {
        throw new Error(
          "The wallet did not sign this transfer. Nothing was moved.",
        );
      },
      fetchImpl: swapFetch([], () => {
        throw new Error("submit must not be called");
      }),
    });
    expect(rejected).toEqual({
      ok: false,
      reason: "signature",
      message: "The wallet did not sign this transfer. Nothing was moved.",
    });

    const opaque = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign: async () => {
        throw new Error("provider stack text");
      },
      fetchImpl: swapFetch([], () => {
        throw new Error("submit must not be called");
      }),
    });
    expect(opaque).toEqual({
      ok: false,
      reason: "signature",
      message: "Nothing was moved. The signature was not accepted.",
    });
  });

  it("tells the reader to connect a wallet instead of blaming the signature", async () => {
    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign: async () => {
        throw new Error(WALLET_NOT_CONNECTED);
      },
      fetchImpl: swapFetch([], () => {
        throw new Error("submit must not be called");
      }),
    });

    expect(result).toEqual({
      ok: false,
      reason: "signature",
      message: "Connect a wallet first.",
    });
  });

  it("accepts the raw Ed25519 standard a Solana session receives", async () => {
    const payload = "the-exact-ed25519-payload";
    const signed = {
      standard: "raw_ed25519",
      payload,
      signature: "ed25519:signature",
      public_key: "ed25519:key",
    };
    const sign = vi.fn(
      async (intent: {
        standard: string;
        payload: string | Record<string, unknown>;
      }) => {
        expect(intent).toEqual({ standard: "raw_ed25519", payload });
        return signed;
      },
    );

    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign,
      fetchImpl: swapFetch(
        [],
        (body) => {
          expect(body.signedData).toEqual(signed);
          return jsonResponse({ intentHash: "hash" });
        },
        {
          transactionId: TRANSACTION_ID,
          depositAddress: "0xdeposit",
          intent: { standard: "raw_ed25519", payload },
        },
      ),
    });

    expect(result).toMatchObject({ ok: true, intentHash: "hash" });
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("refuses a NEP-413 envelope whose message changed before submit", async () => {
    const envelope = {
      message: PAYLOAD,
      recipient: "intents.far",
      nonce: "stored-nonce",
    };
    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign: async () => ({
        standard: "nep413",
        payload: { ...envelope, message: PAYLOAD + "tampered" },
        signature: "ed25519:signature",
        public_key: "ed25519:key",
      }),
      fetchImpl: swapFetch(
        [],
        () => {
          throw new Error("submit must not be called");
        },
        {
          transactionId: TRANSACTION_ID,
          depositAddress: "0xdeposit",
          intent: { standard: "nep413", payload: envelope },
        },
      ),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "signature",
      message: "Nothing was moved. The signature was not accepted.",
    });
  });

  it.each([
    ["an empty string", ""],
    ["an empty envelope", {}],
  ])("refuses %s before asking the signer", async (_label, payload) => {
    const sign = vi.fn(async () => ({ payload }));
    const result = await approveIntentsTrade({
      quoteId: QUOTE_ID,
      sign,
      fetchImpl: swapFetch(
        [],
        () => {
          throw new Error("submit must not be called");
        },
        {
          transactionId: TRANSACTION_ID,
          depositAddress: "0xdeposit",
          intent: { standard: "webauthn", payload },
        },
      ),
    });

    expect(result).toEqual({
      ok: false,
      reason: "unavailable",
      message: "The trade could not be prepared. Nothing was moved.",
    });
    expect(sign).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* the withdrawal                                                      */
/* ------------------------------------------------------------------ */

/** A fetch double that records the order of the calls the helper makes. */
function withdrawFetch(
  order: string[],
  submit: (body: Record<string, unknown>) => Response,
  preparedBody: Record<string, unknown> = prepared(),
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/intents/approve") {
      order.push("approve");
      return jsonResponse(preparedBody);
    }
    if (url === "/api/intents/submit") {
      order.push("submit");
      const body = bodyOf(init);
      expect(body.signedData).toEqual(SIGNED_WITHDRAWAL);
      return submit(body);
    }
    throw new Error(`unexpected request ${url}`);
  }) as unknown as typeof fetch;
}

describe("approveIntentsWithdrawal", () => {
  it("approves, signs the returned payload, submits, and reports the server destination", async () => {
    const order: string[] = [];
    const sign = vi.fn(async (intent: { standard: string; payload: unknown }) => {
      order.push("sign");
      expect(intent.standard).toBe("webauthn");
      expect(intent.payload).toBe(PAYLOAD);
      return SIGNED_WITHDRAWAL;
    });
    const onSubmitted = vi.fn(() => order.push("onApprove"));
    const fetchImpl = withdrawFetch(order, () =>
      jsonResponse({ transactionId: TRANSACTION_ID, intentHash: "hash" }),
    );

    const result = await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      approvalId: "aitxt-withdraw",
      sign,
      onSubmitted,
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: true,
      transactionId: TRANSACTION_ID,
      destination: DESTINATION,
      intentHash: "hash",
      figures: {
        amountIn: "0.5",
        amountOut: "0.4894",
        minAmountOut: "0.484506",
        fee: "0.0106",
      },
    });
    expect(order).toEqual(["approve", "sign", "submit", "onApprove"]);
    expect(onSubmitted).toHaveBeenCalledWith({
      transactionId: TRANSACTION_ID,
      destination: DESTINATION,
    });
  });

  it("sends only the stored-quote reference, the action, and the mode", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/intents/approve") {
          sent = bodyOf(init);
          return jsonResponse(prepared());
        }
        return jsonResponse({ intentHash: "hash" });
      },
    ) as unknown as typeof fetch;

    await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      approvalId: "aitxt-withdraw",
      sign: async () => SIGNED_WITHDRAWAL,
      fetchImpl,
    });

    expect(sent).toEqual({
      quoteId: QUOTE_ID,
      conversationId: null,
      approvalId: "aitxt-withdraw",
      action: "withdraw",
      mode: "confidential-withdrawal",
    });
  });

  it("uses the destination the server rebuilt, not the one the card showed", async () => {
    const result = await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      sign: async () => SIGNED_WITHDRAWAL,
      fetchImpl: withdrawFetch(
        [],
        () => jsonResponse({ intentHash: "hash" }),
        prepared({ destination: OTHER_DESTINATION }),
      ),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.destination).toBe(OTHER_DESTINATION);
  });

  it("leaves the card retryable when the server rejects the signature", async () => {
    const onSubmitted = vi.fn();
    const result = await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      sign: async () => SIGNED_WITHDRAWAL,
      onSubmitted,
      fetchImpl: withdrawFetch([], () =>
        jsonResponse({ error: "An error occurred." }, 401),
      ),
    });

    expect(result).toEqual({
      ok: false,
      reason: "signature",
      message: "Nothing was moved. The signature was not accepted.",
    });
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("turns an expired stored quote into a plain sentence", async () => {
    const result = await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      sign: async () => SIGNED_WITHDRAWAL,
      fetchImpl: vi.fn(async () =>
        jsonResponse({ error: "expired", message: "x" }, 409),
      ) as unknown as typeof fetch,
    });
    expect(result).toEqual({
      ok: false,
      reason: "expired",
      message: "The quote expired. Ask for a new one.",
    });
  });

  it("turns a missing stored quote into the fresh-quote sentence", async () => {
    const result = await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      sign: async () => SIGNED_WITHDRAWAL,
      fetchImpl: vi.fn(async () =>
        jsonResponse({ error: "stale", message: "x" }, 400),
      ) as unknown as typeof fetch,
    });
    expect(result).toEqual({
      ok: false,
      reason: "quote",
      message: "The quote is no longer available. Ask for a fresh one.",
    });
  });

  it.each([
    ["an empty string", ""],
    ["an empty envelope", {}],
  ])("refuses %s before asking the signer", async (_label, payload) => {
    const sign = vi.fn(async () => ({ payload }));
    const result = await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      sign,
      fetchImpl: withdrawFetch(
        [],
        () => {
          throw new Error("submit must not be called");
        },
        prepared({ intent: { standard: "webauthn", payload } }),
      ),
    });

    expect(result).toEqual({
      ok: false,
      reason: "unavailable",
      message: "The withdrawal could not be prepared. Nothing was moved.",
    });
    expect(sign).not.toHaveBeenCalled();
  });

  it("tells the reader to connect a wallet instead of blaming the signature", async () => {
    const result = await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      sign: async () => {
        throw new Error(WALLET_NOT_CONNECTED);
      },
      fetchImpl: withdrawFetch([], () => {
        throw new Error("submit must not be called");
      }),
    });

    expect(result).toEqual({
      ok: false,
      reason: "signature",
      message: "Connect a wallet first.",
    });
  });

  it("refuses a payload that differs from the one the server stored", async () => {
    const result = await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      sign: async () => ({ ...SIGNED_WITHDRAWAL, payload: "re-stringified" }),
      fetchImpl: withdrawFetch([], () => {
        throw new Error("submit must not be called");
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "signature",
      message: "Nothing was moved. The signature was not accepted.",
    });
  });

  it("refuses a NEP-413 envelope whose nonce changed", async () => {
    const stored = {
      message: PAYLOAD,
      recipient: "intents.far",
      nonce: "stored-nonce",
    };
    const result = await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      sign: async () => ({
        standard: "nep413",
        payload: { ...stored, nonce: "other-nonce" },
        signature: "ed25519:signature",
        public_key: "ed25519:key",
      }),
      fetchImpl: withdrawFetch(
        [],
        () => {
          throw new Error("submit must not be called");
        },
        prepared({ intent: { standard: "nep413", payload: stored } }),
      ),
    });

    expect(result).toMatchObject({ ok: false, reason: "signature" });
  });

  it("reports a cancelled passkey prompt and submits nothing", async () => {
    const fetchImpl = withdrawFetch([], () => {
      throw new Error("submit must not be called");
    });

    const result = await approveIntentsWithdrawal({
      quoteId: QUOTE_ID,
      sign: async () => {
        throw new PasskeyError(
          "The passkey prompt was cancelled. Nothing was moved.",
        );
      },
      fetchImpl,
    });

    expect(result).toEqual({
      ok: false,
      reason: "signature",
      message: "The passkey prompt was cancelled. Nothing was moved.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* the deposit                                                         */
/* ------------------------------------------------------------------ */

describe("createIntentsDeposit", () => {
  it("sends the asset, amount, and approval id, then returns the address", async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("/api/intents/deposit");
        expect(init?.method).toBe("POST");
        expect(bodyOf(init)).toEqual({
          assetId: ASSET_ID,
          amount: "1000000",
          conversationId: null,
          approvalId: "aitxt-1",
        });
        return jsonResponse({
          transactionId: TRANSACTION_ID,
          depositAddress: DEPOSIT_ADDRESS,
          depositMemo: "memo-1",
          amountIn: "1000000",
          expiresAt: "2099-01-01T00:00:00.000Z",
          runId: "run-1",
        });
      },
    ) as unknown as typeof fetch;

    const result = await createIntentsDeposit({
      assetId: ASSET_ID,
      amount: "1000000",
      approvalId: "aitxt-1",
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      transactionId: TRANSACTION_ID,
      depositAddress: DEPOSIT_ADDRESS,
      depositMemo: "memo-1",
      amountIn: "1000000",
      expiresAt: "2099-01-01T00:00:00.000Z",
      deposit: {
        address: DEPOSIT_ADDRESS,
        memo: "memo-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        amountInRaw: "1000000",
        tokenContract: null,
        chainId: null,
        chainName: null,
        chainSlug: null,
        decimals: null,
        symbol: null,
      },
      runId: "run-1",
    });
  });

  it("never calls the server without the approval id", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await createIntentsDeposit({
      assetId: ASSET_ID,
      amount: "1000000",
      fetchImpl,
    });

    expect(result).toEqual({
      ok: false,
      reason: "approval",
      message: "The deposit cannot be confirmed. Ask for a new one.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns a rejected request into a plain sentence", async () => {
    const result = await createIntentsDeposit({
      assetId: ASSET_ID,
      amount: "1000000",
      approvalId: "aitxt-1",
      fetchImpl: vi.fn(async () =>
        jsonResponse({ error: "An error occurred." }, 400),
      ) as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: false,
      reason: "rejected",
      message: "The deposit could not be prepared. Nothing was moved.",
    });
  });

  it("reports a signed-out session instead of a broken address", async () => {
    const result = await createIntentsDeposit({
      assetId: ASSET_ID,
      amount: "1000000",
      approvalId: "aitxt-1",
      fetchImpl: vi.fn(async () =>
        jsonResponse({ error: "Not signed in." }, 401),
      ) as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: false,
      reason: "sign-in",
      message: "Sign in to deposit.",
    });
  });
});

/* ------------------------------------------------------------------ */
/* display                                                             */
/* ------------------------------------------------------------------ */

describe("formatRawAmount", () => {
  it("shows a smallest-unit amount as whole units without rounding up", () => {
    expect(formatRawAmount("1000000", 6)).toBe("1");
    expect(formatRawAmount("1500000", 6)).toBe("1.5");
    expect(formatRawAmount("1234567", 6)).toBe("1.234567");
    expect(formatRawAmount("999999", 6)).toBe("0.999999");
    expect(formatRawAmount("1", 0)).toBe("1");
    expect(formatRawAmount("abc", 6)).toBe("abc");
  });
});
