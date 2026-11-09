import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createExecutionQuote,
  generateIntent,
  quote,
  submitIntent,
} from "./service";

/**
 * These tests cover the wire contract only. Every fixture is synthetic:
 * the key, the payload, the assertion, and the hash are placeholders, and
 * no request leaves the process. A secret never appears in a fixture.
 */

const PARTNER_KEY = "test-partner-key";
const FROM = "nep141:usdc.fixture";
const TO = "nep141:wrap.near";
const RECIPIENT = "0x7edf07ede58238026db3f90fc8032633b69b8de5";
const DEPOSIT_ADDRESS = "f".repeat(64);
const SERVER_DEADLINE = "2026-11-05T11:28:18.215Z";

// Deliberately irregular whitespace: a parse/re-stringify would change it.
const WEB_AUTHN_PAYLOAD =
  '{"verifying_contract":"intents.far", "signer_id":"0x7edf07ede58238026db3f90fc8032633b69b8de5",\n"deadline":"2026-11-05T11:28:18.215Z","nonce":"fixture","intents":[]}';

type CapturedRequest = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 201) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function installFetch(
  respond: (url: string, init?: RequestInit) => unknown | Promise<unknown>,
  catalogue: Array<Record<string, unknown>> = [
    {
      assetId: TO,
      symbol: "WNEAR",
      decimals: 24,
      blockchain: "near",
      price: 2,
      contractAddress: "wrap.near",
    },
  ],
) {
  const requests: CapturedRequest[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("/v0/tokens")) {
      return jsonResponse({ data: catalogue }, 200);
    }
    return respond(url, init);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, requests };
}

function requestBody(
  requests: CapturedRequest[],
  path: string,
): Record<string, unknown> {
  const call = requests.find((r) => r.url.includes(path));
  if (!call) throw new Error(`No request was made to ${path}`);
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

function quoteResponse() {
  return jsonResponse({
    quote: {
      amountIn: "1000000",
      amountInFormatted: "1",
      amountOut: "2000000000000000000000000",
      amountOutFormatted: "2",
      minAmountOut: "1980000000000000000000000",
      amountOutUsd: "2",
      depositAddress: DEPOSIT_ADDRESS,
      deadline: SERVER_DEADLINE,
    },
  });
}

const QUOTE_PARAMS = {
  fromAssetId: FROM,
  toAssetId: TO,
  amount: "1000000",
  recipient: RECIPIENT,
  refundTo: RECIPIENT,
};

const GENERATE_PARAMS = {
  type: "swap_transfer" as const,
  standard: "webauthn" as const,
  signerId: RECIPIENT,
  depositAddress: DEPOSIT_ADDRESS,
};

const SIGNED_DATA = {
  standard: "webauthn",
  payload: WEB_AUTHN_PAYLOAD,
  public_key: "p256:fixture-public-key",
  signature: "p256:fixture-signature",
  client_data_json:
    '{"type":"webauthn.get","challenge":"fixture","origin":"http://localhost:3000"}',
  authenticator_data: "fixture-authenticator-data",
};

beforeEach(() => {
  vi.stubEnv("ONE_CLICK_API_KEY", PARTNER_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("quote modes", () => {
  it("keeps the chain mode as the default for the existing wallet callers", async () => {
    const { requests } = installFetch(() => quoteResponse());

    await quote(QUOTE_PARAMS);

    const body = requestBody(requests, "/v0/quote");
    // The four mode fields, byte for byte as they are today.
    expect({
      depositType: body.depositType,
      recipientType: body.recipientType,
      refundType: body.refundType,
      confidentiality: body.confidentiality,
    }).toEqual({
      depositType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
      confidentiality: "basic",
    });
    expect(body).toMatchObject({ dry: true, swapType: "EXACT_INPUT" });
  });

  it("keeps the chain mode as the default for a wet wallet quote", async () => {
    const { requests } = installFetch(() => quoteResponse());

    const execution = await createExecutionQuote(QUOTE_PARAMS);

    expect(execution.depositAddress).toBe(DEPOSIT_ADDRESS);
    expect(requestBody(requests, "/v0/quote")).toMatchObject({
      dry: false,
      depositType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
    });
  });

  it("sends CONFIDENTIAL_INTENTS for deposit, recipient, and refund", async () => {
    const { requests } = installFetch(() => quoteResponse());

    await quote({ ...QUOTE_PARAMS, mode: "confidential-intents" });

    const body = requestBody(requests, "/v0/quote");
    expect({
      depositType: body.depositType,
      recipientType: body.recipientType,
      refundType: body.refundType,
    }).toEqual({
      depositType: "CONFIDENTIAL_INTENTS",
      recipientType: "CONFIDENTIAL_INTENTS",
      refundType: "CONFIDENTIAL_INTENTS",
    });
    // Confidentiality is a separate request field, not a substitute.
    expect(body.confidentiality).toBe("basic");
  });

  it("sends an origin-chain deposit with confidential recipient and refund", async () => {
    const { requests } = installFetch(() => quoteResponse());

    await createExecutionQuote({
      ...QUOTE_PARAMS,
      mode: "confidential-external",
    });

    const body = requestBody(requests, "/v0/quote");
    expect({
      dry: body.dry,
      depositType: body.depositType,
      recipientType: body.recipientType,
      refundType: body.refundType,
      recipient: body.recipient,
      refundTo: body.refundTo,
    }).toEqual({
      dry: false,
      depositType: "ORIGIN_CHAIN",
      recipientType: "CONFIDENTIAL_INTENTS",
      refundType: "CONFIDENTIAL_INTENTS",
      recipient: RECIPIENT,
      refundTo: RECIPIENT,
    });
  });

  it("passes an explicit swap type through and keeps exact input as the default", async () => {
    const { requests } = installFetch(() => quoteResponse());

    await quote({
      ...QUOTE_PARAMS,
      mode: "confidential-external",
      swapType: "FLEX_INPUT",
    });

    expect(requestBody(requests, "/v0/quote").swapType).toBe("FLEX_INPUT");
  });

  it("keeps the local fallback for a dry quote and the server deadline for a wet one", async () => {
    const { requests } = installFetch(() => quoteResponse());

    const preview = await quote({
      ...QUOTE_PARAMS,
      mode: "confidential-intents",
    });
    const execution = await createExecutionQuote({
      ...QUOTE_PARAMS,
      mode: "confidential-intents",
    });

    expect(preview.expiresAt).not.toBe(SERVER_DEADLINE);
    expect(execution.expiresAt).toBe(SERVER_DEADLINE);
    expect(execution.amountOutFormatted).toBe("2");
    expect(execution.minAmountOut).toBe("1.98");
    expect(requests.filter((r) => r.url.includes("/v0/quote"))).toHaveLength(2);
  });
});

describe("confidential withdrawal", () => {
  const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";

  function withdrawalParams(
    overrides: Partial<{ refundTo: string | undefined }> = {},
  ) {
    return {
      fromAssetId: FROM,
      toAssetId: FROM,
      amount: "500000",
      recipient: DESTINATION,
      refundTo: RECIPIENT,
      mode: "confidential-withdrawal" as const,
      ...overrides,
    };
  }

  function feeResponse(fee?: string) {
    return jsonResponse({
      quote: {
        amountIn: "500000",
        amountInFormatted: "0.5",
        amountOut: "489400",
        amountOutFormatted: "0.4894",
        minAmountOut: "484506",
        amountOutUsd: "0.49",
        depositAddress: DEPOSIT_ADDRESS,
        deadline: SERVER_DEADLINE,
        ...(fee ? { withdrawFee: fee } : {}),
      },
    });
  }

  it("sends the measured withdrawal shape and allows the same asset", async () => {
    const { requests } = installFetch(() => feeResponse("10600"));

    await quote(withdrawalParams());

    const body = requestBody(requests, "/v0/quote");
    expect({
      depositType: body.depositType,
      recipientType: body.recipientType,
      refundType: body.refundType,
      recipient: body.recipient,
      refundTo: body.refundTo,
      swapType: body.swapType,
      confidentiality: body.confidentiality,
    }).toEqual({
      depositType: "CONFIDENTIAL_INTENTS",
      recipientType: "DESTINATION_CHAIN",
      refundType: "CONFIDENTIAL_INTENTS",
      recipient: DESTINATION,
      refundTo: RECIPIENT,
      swapType: "EXACT_INPUT",
      confidentiality: "basic",
    });
  });

  it("refuses a withdrawal with no explicit private refund", async () => {
    const { mock } = installFetch(() => feeResponse());

    await expect(
      quote(withdrawalParams({ refundTo: undefined })),
    ).rejects.toThrow("A withdrawal needs an explicit refund address.");
    expect(mock).not.toHaveBeenCalled();
  });

  it("keeps the other modes' refund default unchanged", async () => {
    const { requests } = installFetch(() => feeResponse());

    await quote({
      fromAssetId: FROM,
      toAssetId: TO,
      amount: "1000000",
      recipient: RECIPIENT,
      mode: "confidential-intents",
    });

    expect(requestBody(requests, "/v0/quote").refundTo).toBe(RECIPIENT);
  });
});
describe("generateIntent", () => {
  it("returns the exact webauthn payload and sends the four request fields", async () => {
    const { requests } = installFetch(() =>
      jsonResponse({
        intent: { standard: "webauthn", payload: WEB_AUTHN_PAYLOAD },
        correlationId: "fixture-generate-correlation",
      }),
    );

    const result = await generateIntent(GENERATE_PARAMS);

    expect(result.standard).toBe("webauthn");
    expect(typeof result.payload).toBe("string");
    expect(result.payload).toBe(WEB_AUTHN_PAYLOAD);

    const call = requests.find((r) => r.url.includes("/v0/generate-intent"));
    expect(call?.init?.method).toBe("POST");
    expect(
      (call?.init?.headers as Record<string, string> | undefined)?.["X-API-Key"],
    ).toBe(PARTNER_KEY);
    expect(requestBody(requests, "/v0/generate-intent")).toEqual({
      type: "swap_transfer",
      standard: "webauthn",
      signerId: RECIPIENT,
      depositAddress: DEPOSIT_ADDRESS,
    });
  });

  it("refuses a payload whose returned standard differs from the request", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installFetch(() =>
      jsonResponse({
        intent: { standard: "erc191", payload: WEB_AUTHN_PAYLOAD },
      }),
    );

    await expect(generateIntent(GENERATE_PARAMS)).rejects.toThrow(
      "Unable to prepare the transaction. Please try again.",
    );
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("submitIntent", () => {
  it("returns the intent hash and sends type and signedData unchanged", async () => {
    const { requests } = installFetch(() =>
      jsonResponse({
        intentHash: "fixture-intent-hash",
        correlationId: "fixture-submit-correlation",
      }),
    );

    const result = await submitIntent({
      type: "swap_transfer",
      signedData: SIGNED_DATA,
    });

    expect(result).toEqual({
      intentHash: "fixture-intent-hash",
      correlationId: "fixture-submit-correlation",
    });
    const call = requests.find((r) => r.url.includes("/v0/submit-intent"));
    expect(call?.init?.method).toBe("POST");
    expect(
      (call?.init?.headers as Record<string, string> | undefined)?.["X-API-Key"],
    ).toBe(PARTNER_KEY);
    expect(requestBody(requests, "/v0/submit-intent")).toEqual({
      type: "swap_transfer",
      signedData: SIGNED_DATA,
    });
  });

  it("does not read a missing intent hash as acceptance", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installFetch(() =>
      jsonResponse({ correlationId: "fixture-submit-correlation" }),
    );

    await expect(
      submitIntent({ type: "swap_transfer", signedData: SIGNED_DATA }),
    ).rejects.toThrow("Unable to submit the transaction. Please try again.");
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("intent failures", () => {
  it("masks a generate-intent failure and logs no key or payload", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installFetch(() =>
      jsonResponse(
        {
          error: "Bad Request",
          message: `Validation failed for ${PARTNER_KEY}: ${WEB_AUTHN_PAYLOAD}`,
        },
        400,
      ),
    );

    const error = await generateIntent(GENERATE_PARAMS).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toBe(
      "Unable to prepare the transaction. Please try again.",
    );
    expect(message).not.toContain(PARTNER_KEY);
    expect(message).not.toContain(WEB_AUTHN_PAYLOAD);

    const logged = errorSpy.mock.calls
      .map((call) =>
        call
          .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" "),
      )
      .join("\n");
    expect(logged).toContain("400");
    expect(logged).toContain("Bad Request");
    expect(logged).not.toContain(PARTNER_KEY);
    expect(logged).not.toContain(WEB_AUTHN_PAYLOAD);
  });

  it("masks a submit-intent failure and logs no key or signed data", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installFetch(() =>
      jsonResponse(
        {
          error: "Unauthorized",
          message: `Invalid token ${PARTNER_KEY} for ${SIGNED_DATA.signature}`,
        },
        401,
      ),
    );

    const error = await submitIntent({
      type: "swap_transfer",
      signedData: SIGNED_DATA,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Unable to submit the transaction. Please try again.",
    );

    const logged = errorSpy.mock.calls
      .map((call) =>
        call
          .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" "),
      )
      .join("\n");
    expect(logged).toContain("401");
    expect(logged).not.toContain(PARTNER_KEY);
    expect(logged).not.toContain(SIGNED_DATA.signature);
  });
});
