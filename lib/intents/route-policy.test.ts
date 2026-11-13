import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import type { TxState } from "@/lib/db/transactions";
import {
  actionMatchesMode,
  approveBodySchema,
  decideSubmit,
  GENERIC_VERIFICATION_ERROR,
  isConfidentialStoredMode,
  isSameSubmittedIntent,
  isSignedQuoteMode,
  mapVerificationFailure,
  passkeyWalletRouteGuard,
  PASSKEY_WALLET_ROUTE_ERROR,
  readIntentRefs,
  readStoredQuoteRequest,
  SIGNED_QUOTE_MODES,
  standardForSession,
  submitBodySchema,
} from "./route-policy";
import {
  intentHashForPayload,
  type IntentVerificationReason,
} from "./verify-intent";

const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const TRANSACTION_ID = "33333333-3333-4333-8333-333333333333";
const INTENTS_ACCOUNT = "0x7edf07ede58238026db3f90fc8032633b69b8de5";
const DEPOSIT_ADDRESS =
  "e0240dfbadb1bd03ec5f5e1c93899f59a80f1307354d534bd10563d566897a43";
const ASSET_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e3613a1";
const DEADLINE = "2026-11-05T11:28:18.215Z";
const PAYLOAD = '{"signer_id":"0x7edf07ede58238026db3f90fc8032633b69b8de5"}';

describe("approve body", () => {
  it("accepts the exact body the card sends", () => {
    const parsed = approveBodySchema.safeParse({
      quoteId: QUOTE_ID,
      action: "swap",
      mode: "confidential-intents",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts null and omitted card metadata", () => {
    const parsed = approveBodySchema.safeParse({
      quoteId: QUOTE_ID,
      conversationId: CONVERSATION_ID,
      approvalId: "aitxt-123",
      action: "deposit",
      mode: "confidential-external",
    });
    expect(parsed.success).toBe(true);

    expect(
      approveBodySchema.safeParse({
        quoteId: QUOTE_ID,
        conversationId: null,
        approvalId: null,
        action: "withdraw",
        mode: "confidential-intents",
      }).success,
    ).toBe(true);
  });

  it("rejects the wallet chain mode", () => {
    expect(
      approveBodySchema.safeParse({
        quoteId: QUOTE_ID,
        action: "swap",
        mode: "chain",
      }).success,
    ).toBe(false);
  });

  it("rejects a chain field outright", () => {
    expect(
      approveBodySchema.safeParse({
        quoteId: QUOTE_ID,
        action: "swap",
        mode: "confidential-intents",
        chain: "evm",
      }).success,
    ).toBe(false);
  });

  it("rejects a missing action, an unknown action, and a non-uuid quote", () => {
    expect(
      approveBodySchema.safeParse({
        quoteId: QUOTE_ID,
        mode: "confidential-intents",
      }).success,
    ).toBe(false);
    expect(
      approveBodySchema.safeParse({
        quoteId: QUOTE_ID,
        action: "send",
        mode: "confidential-intents",
      }).success,
    ).toBe(false);
    expect(
      approveBodySchema.safeParse({
        quoteId: "not-a-uuid",
        action: "swap",
        mode: "confidential-intents",
      }).success,
    ).toBe(false);
  });
});

describe("submit body", () => {
  it("accepts a transaction id and an object signedData", () => {
    const parsed = submitBodySchema.safeParse({
      transactionId: TRANSACTION_ID,
      signedData: { standard: "webauthn", payload: PAYLOAD },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing or non-object signedData", () => {
    for (const signedData of [undefined, null, "string", [], 42]) {
      expect(
        submitBodySchema.safeParse({
          transactionId: TRANSACTION_ID,
          signedData,
        }).success,
        String(signedData),
      ).toBe(false);
    }
  });

  it("rejects an unknown field", () => {
    expect(
      submitBodySchema.safeParse({
        transactionId: TRANSACTION_ID,
        signedData: { standard: "webauthn", payload: PAYLOAD },
        amountIn: "999999",
      }).success,
    ).toBe(false);
  });
});

describe("standardForSession", () => {
  it("uses WebAuthn for a passkey account regardless of session chain", () => {
    expect(
      standardForSession({ accountKind: "passkey", chain: "near" }),
    ).toBe("webauthn");
  });

  it("maps each wallet chain to its standard", () => {
    expect(standardForSession({ accountKind: "wallet", chain: "evm" })).toBe(
      "erc191",
    );
    expect(
      standardForSession({ accountKind: "wallet", chain: "solana" }),
    ).toBe("raw_ed25519");
    expect(standardForSession({ accountKind: "wallet", chain: "near" })).toBe(
      "nep413",
    );
  });
});

describe("the wallet direct route guard", () => {
  it("returns a clear 400 body for a passkey session", () => {
    expect(passkeyWalletRouteGuard({ accountKind: "passkey" })).toEqual({
      error: PASSKEY_WALLET_ROUTE_ERROR,
    });
  });

  it("does not interfere with a wallet session", () => {
    expect(passkeyWalletRouteGuard({ accountKind: "wallet" })).toBeNull();
  });
});

const REASONS: IntentVerificationReason[] = [
  "signed-data-malformed",
  "standard-unknown",
  "standard-mismatch",
  "standard-chain-mismatch",
  "account-kind-mismatch",
  "wallet-address-missing",
  "payload-malformed",
  "payload-mismatch",
  "envelope-mismatch",
  "signer-mismatch",
  "contract-mismatch",
  "deadline-mismatch",
  "deadline-expired",
  "intent-shape-mismatch",
  "deposit-mismatch",
  "token-mismatch",
  "amount-mismatch",
  "client-data-malformed",
  "client-data-type",
  "challenge-mismatch",
  "origin-mismatch",
  "cross-origin",
  "authenticator-data-malformed",
  "rp-id-mismatch",
  "user-presence-required",
  "user-verification-required",
  "backup-flags-invalid",
  "signature-malformed",
  "signature-high-s",
  "signature-invalid",
  "public-key-malformed",
  "public-key-mismatch",
  "passkey-key-missing",
];

describe("verification failure mapping", () => {
  it("returns one indistinguishable 401 body for every reason", () => {
    for (const reason of REASONS) {
      const failure = mapVerificationFailure(reason);
      expect(failure.status).toBe(401);
      expect(failure.body).toEqual({ error: GENERIC_VERIFICATION_ERROR });
      expect(failure.logReason).toBe(reason);
      expect(JSON.stringify(failure.body)).not.toContain(reason);
    }
  });
});

describe("idempotent submit decision", () => {
  const cases: Array<{
    state: TxState;
    storedIntentHash: string | null;
    sameIntent: boolean;
    expected: ReturnType<typeof decideSubmit>["kind"];
  }> = [
    {
      state: "awaiting_approval",
      storedIntentHash: null,
      sameIntent: false,
      expected: "proceed",
    },
    {
      state: "awaiting_approval",
      storedIntentHash: "hash",
      sameIntent: false,
      expected: "proceed",
    },
    {
      state: "submitted",
      storedIntentHash: "hash",
      sameIntent: true,
      expected: "idempotent",
    },
    {
      state: "submitted",
      storedIntentHash: "hash",
      sameIntent: false,
      expected: "conflict",
    },
    {
      state: "submitted",
      storedIntentHash: null,
      sameIntent: true,
      expected: "conflict",
    },
    {
      state: "settled",
      storedIntentHash: "hash",
      sameIntent: true,
      expected: "conflict",
    },
    {
      state: "processing",
      storedIntentHash: "hash",
      sameIntent: true,
      expected: "conflict",
    },
    {
      state: "failed",
      storedIntentHash: "hash",
      sameIntent: true,
      expected: "conflict",
    },
  ];

  it("proceeds only while awaiting approval", () => {
    for (const testCase of cases) {
      expect(
        decideSubmit({
          state: testCase.state,
          storedIntentHash: testCase.storedIntentHash,
          sameIntent: testCase.sameIntent,
        }).kind,
        `${testCase.state}/${String(testCase.storedIntentHash)}/${testCase.sameIntent}`,
      ).toBe(testCase.expected);
    }
  });

  it("names the conflict reason", () => {
    expect(
      decideSubmit({
        state: "submitted",
        storedIntentHash: "hash",
        sameIntent: false,
      }),
    ).toEqual({ kind: "conflict", reason: "intent-changed" });
    expect(
      decideSubmit({
        state: "submitted",
        storedIntentHash: null,
        sameIntent: true,
      }),
    ).toEqual({ kind: "conflict", reason: "not-submittable" });
  });
});

describe("same submitted intent", () => {
  it("compares a string payload by its exact intent hash", () => {
    const hash = intentHashForPayload(PAYLOAD);
    expect(
      isSameSubmittedIntent({
        signedData: { standard: "webauthn", payload: PAYLOAD },
        storedPayload: PAYLOAD,
        storedIntentHash: hash,
      }),
    ).toBe(true);
    expect(
      isSameSubmittedIntent({
        signedData: { standard: "webauthn", payload: `${PAYLOAD} ` },
        storedPayload: PAYLOAD,
        storedIntentHash: hash,
      }),
    ).toBe(false);
    expect(
      isSameSubmittedIntent({
        signedData: { standard: "webauthn", payload: PAYLOAD },
        storedPayload: PAYLOAD,
        storedIntentHash: null,
      }),
    ).toBe(false);
  });

  it("compares a NEP-413 envelope on the fields the verifier binds", () => {
    const stored = {
      message: "{\"signer_id\":\"x\"}",
      recipient: "intents.near",
      nonce: "bm9uY2U=",
    };
    expect(
      isSameSubmittedIntent({
        signedData: {
          standard: "nep413",
          payload: { ...stored, extra: "ignored by the verifier" },
        },
        storedPayload: stored,
        storedIntentHash: "hash",
      }),
    ).toBe(true);
    expect(
      isSameSubmittedIntent({
        signedData: {
          standard: "nep413",
          payload: { ...stored, recipient: "intents.far" },
        },
        storedPayload: stored,
        storedIntentHash: "hash",
      }),
    ).toBe(false);
  });

  it("rejects a missing or non-object payload", () => {
    expect(
      isSameSubmittedIntent({
        signedData: null,
        storedPayload: PAYLOAD,
        storedIntentHash: "hash",
      }),
    ).toBe(false);
    expect(
      isSameSubmittedIntent({
        signedData: { payload: ["array"] },
        storedPayload: PAYLOAD,
        storedIntentHash: "hash",
      }),
    ).toBe(false);
  });
});

describe("stored intent refs", () => {
  const refs = {
    dryQuoteId: QUOTE_ID,
    wetQuoteId: "44444444-4444-4444-8444-444444444444",
    mode: "confidential-intents",
    standard: "webauthn",
    signerId: INTENTS_ACCOUNT,
    intentPayload: PAYLOAD,
    intentDepositAddress: DEPOSIT_ADDRESS,
    amountInRaw: "500000",
    deadline: DEADLINE,
    assetId: ASSET_ID,
    toolApprovalId: "aitxt-123",
    conversationId: CONVERSATION_ID,
  };

  it("reads the stored signed path", () => {
    expect(readIntentRefs(refs)).toEqual({
      ok: true,
      refs: {
        mode: "confidential-intents",
        standard: "webauthn",
        signerId: INTENTS_ACCOUNT,
        intentPayload: PAYLOAD,
        intentDepositAddress: DEPOSIT_ADDRESS,
        amountInRaw: "500000",
        deadline: DEADLINE,
        assetId: ASSET_ID,
        destination: null,
        intentHash: null,
        toolApprovalId: "aitxt-123",
        toolName: null,
        conversationId: CONVERSATION_ID,
        dryQuoteId: QUOTE_ID,
      },
    });
  });

  it("rejects the external deposit mode", () => {
    expect(
      readIntentRefs({ ...refs, mode: "confidential-external" }),
    ).toEqual({ ok: false, reason: "mode-mismatch" });
    expect(readIntentRefs({ ...refs, mode: "chain" })).toEqual({
      ok: false,
      reason: "mode-mismatch",
    });
  });

  it("rejects a refs row without the signed material", () => {
    expect(readIntentRefs({ ...refs, intentPayload: undefined })).toEqual({
      ok: false,
      reason: "refs-malformed",
    });
    expect(readIntentRefs({ ...refs, standard: "unknown" })).toEqual({
      ok: false,
      reason: "refs-malformed",
    });
    expect(readIntentRefs({ ...refs, signerId: "" })).toEqual({
      ok: false,
      reason: "refs-malformed",
    });
    expect(readIntentRefs(null)).toEqual({
      ok: false,
      reason: "refs-malformed",
    });
  });

  it("keeps a recorded intent hash for the idempotent path", () => {
    const parsed = readIntentRefs({ ...refs, intentHash: "base58hash" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.refs.intentHash).toBe("base58hash");
  });
});

describe("the withdrawal mode policy", () => {
  const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";

  it("accepts the withdrawal body and rejects a client-supplied destination", () => {
    expect(
      approveBodySchema.safeParse({
        quoteId: QUOTE_ID,
        action: "withdraw",
        mode: "confidential-withdrawal",
      }).success,
    ).toBe(true);

    for (const extra of [
      { destination: DESTINATION },
      { recipient: DESTINATION },
      { recipientType: "DESTINATION_CHAIN" },
      { refundType: "CONFIDENTIAL_INTENTS" },
      { refundTo: DESTINATION },
    ]) {
      expect(
        approveBodySchema.safeParse({
          quoteId: QUOTE_ID,
          action: "withdraw",
          mode: "confidential-withdrawal",
          ...extra,
        }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it("pairs each action with the mode it can move money for", () => {
    expect(actionMatchesMode("confidential-withdrawal", "withdraw")).toBe(true);
    expect(actionMatchesMode("confidential-withdrawal", "swap")).toBe(false);
    expect(actionMatchesMode("confidential-withdrawal", "deposit")).toBe(false);

    expect(actionMatchesMode("confidential-intents", "swap")).toBe(true);
    expect(actionMatchesMode("confidential-intents", "withdraw")).toBe(false);
    expect(actionMatchesMode("confidential-intents", "deposit")).toBe(false);

    expect(actionMatchesMode("confidential-external", "deposit")).toBe(true);
    expect(actionMatchesMode("confidential-external", "swap")).toBe(false);
    expect(actionMatchesMode("confidential-external", "withdraw")).toBe(false);
  });

  it("names the two signed modes and the three confidential stored modes", () => {
    expect(SIGNED_QUOTE_MODES).toEqual([
      "confidential-intents",
      "confidential-withdrawal",
    ]);
    expect(isSignedQuoteMode("confidential-intents")).toBe(true);
    expect(isSignedQuoteMode("confidential-withdrawal")).toBe(true);
    expect(isSignedQuoteMode("confidential-external")).toBe(false);
    expect(isSignedQuoteMode("chain")).toBe(false);
    expect(isSignedQuoteMode(null)).toBe(false);

    for (const mode of [
      "confidential-intents",
      "confidential-external",
      "confidential-withdrawal",
    ]) {
      expect(isConfidentialStoredMode(mode), mode).toBe(true);
    }
    for (const mode of ["chain", "", null, undefined, 42, "other"]) {
      expect(isConfidentialStoredMode(mode), String(mode)).toBe(false);
    }
  });
});

describe("stored withdrawal quote request", () => {
  const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
  const withdrawal = {
    fromAssetId: ASSET_ID,
    toAssetId: ASSET_ID,
    amount: "500000",
    recipient: DESTINATION,
    refundTo: INTENTS_ACCOUNT,
    slippageBps: 100,
    confidentiality: "basic",
    mode: "confidential-withdrawal",
    recipientType: "DESTINATION_CHAIN",
    refundType: "CONFIDENTIAL_INTENTS",
    destination: DESTINATION,
    accountKind: "passkey",
    intentsAccountId: INTENTS_ACCOUNT,
  };
  const expected = {
    mode: "confidential-withdrawal" as const,
    accountKind: "passkey" as const,
    intentsAccountId: INTENTS_ACCOUNT,
  };

  it("accepts a same-asset withdrawal and normalises the destination", () => {
    const parsed = readStoredQuoteRequest(
      { ...withdrawal, recipient: DESTINATION.toLowerCase() },
      expected,
    );
    expect(parsed).toEqual({
      ok: true,
      params: {
        fromAssetId: ASSET_ID,
        toAssetId: ASSET_ID,
        amount: "500000",
        recipient: DESTINATION,
        refundTo: INTENTS_ACCOUNT,
        slippageBps: 100,
        confidentiality: "basic",
        mode: "confidential-withdrawal",
      },
    });
  });

  it("accepts a stored destination that matches the recipient", () => {
    expect(readStoredQuoteRequest(withdrawal, expected).ok).toBe(true);
  });

  it("refuses same-asset for every other mode", () => {
    for (const mode of [
      "confidential-intents",
      "confidential-external",
    ] as const) {
      expect(
        readStoredQuoteRequest(
          {
            fromAssetId: ASSET_ID,
            toAssetId: ASSET_ID,
            amount: "500000",
            recipient: INTENTS_ACCOUNT,
            refundTo: INTENTS_ACCOUNT,
            slippageBps: 100,
            confidentiality: "basic",
            mode,
            accountKind: "passkey",
            intentsAccountId: INTENTS_ACCOUNT,
          },
          { ...expected, mode },
        ),
      ).toEqual({ ok: false, reason: "quote-malformed" });
    }
  });

  it("refuses a stored row that does not name the withdrawal mode", () => {
    expect(
      readStoredQuoteRequest({ ...withdrawal, mode: undefined }, expected),
    ).toEqual({ ok: false, reason: "mode-mismatch" });
    expect(
      readStoredQuoteRequest(
        { ...withdrawal, mode: "confidential-intents" },
        expected,
      ),
    ).toEqual({ ok: false, reason: "mode-mismatch" });
  });

  it("refuses a recipient type that would park the funds at an account", () => {
    for (const recipientType of [
      "CONFIDENTIAL_INTENTS",
      "INTENTS",
      "ORIGIN_CHAIN",
      42,
    ]) {
      expect(
        readStoredQuoteRequest({ ...withdrawal, recipientType }, expected),
        String(recipientType),
      ).toEqual({ ok: false, reason: "quote-malformed" });
    }
  });

  it("refuses a public or origin-chain refund", () => {
    for (const refundType of [
      "DESTINATION_CHAIN",
      "ORIGIN_CHAIN",
      "INTENTS",
      42,
    ]) {
      expect(
        readStoredQuoteRequest({ ...withdrawal, refundType }, expected),
        String(refundType),
      ).toEqual({ ok: false, reason: "quote-malformed" });
    }
  });

  it("refuses a refund that is not the session account", () => {
    expect(
      readStoredQuoteRequest(
        { ...withdrawal, refundTo: DESTINATION },
        expected,
      ),
    ).toEqual({ ok: false, reason: "account-mismatch" });
    expect(
      readStoredQuoteRequest({ ...withdrawal, refundTo: "" }, expected),
    ).toEqual({ ok: false, reason: "account-mismatch" });
  });

  it("refuses a destination that is not an EVM address", () => {
    for (const recipient of [
      "not-an-address",
      "0x1234",
      "0xc8aECa3431542a1340D7Ef0EEb4684311b5A3148",
      "0x" + "f".repeat(64),
    ]) {
      expect(
        readStoredQuoteRequest({ ...withdrawal, recipient }, expected).ok,
        recipient,
      ).toBe(false);
    }
  });

  it("refuses a stored destination that disagrees with the recipient", () => {
    expect(
      readStoredQuoteRequest(
        { ...withdrawal, destination: "0x0000000000000000000000000000000000000001" },
        expected,
      ),
    ).toEqual({ ok: false, reason: "quote-malformed" });
  });

  it("allows the account's own address as the withdrawal destination", () => {
    // The plan keeps the own-wallet case valid; the type is still
    // DESTINATION_CHAIN, so the chain pays an address rather than an account
    // id.
    const parsed = readStoredQuoteRequest(
      {
        ...withdrawal,
        recipient: INTENTS_ACCOUNT,
        destination: INTENTS_ACCOUNT,
      },
      expected,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.params.recipient).toBe(getAddress(INTENTS_ACCOUNT));
    }
  });

  it("keeps the other confidential modes pinned to the account", () => {
    const params = {
      fromAssetId: ASSET_ID,
      toAssetId: "nep141:wrap.near",
      amount: "500000",
      recipient: INTENTS_ACCOUNT,
      refundTo: INTENTS_ACCOUNT,
      slippageBps: 100,
      confidentiality: "basic",
      mode: "confidential-intents",
    };
    expect(
      readStoredQuoteRequest(
        { ...params, recipient: "0x0000000000000000000000000000000000000001" },
        { ...expected, mode: "confidential-intents" },
      ),
    ).toEqual({ ok: false, reason: "account-mismatch" });
    expect(
      readStoredQuoteRequest(params, {
        ...expected,
        mode: "confidential-intents",
      }).ok,
    ).toBe(true);
  });
});

describe("stored withdrawal intent refs", () => {
  const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
  const refs = {
    dryQuoteId: QUOTE_ID,
    wetQuoteId: "44444444-4444-4444-8444-444444444444",
    mode: "confidential-withdrawal",
    standard: "webauthn",
    signerId: INTENTS_ACCOUNT,
    intentPayload: PAYLOAD,
    intentDepositAddress: DEPOSIT_ADDRESS,
    amountInRaw: "500000",
    deadline: DEADLINE,
    assetId: ASSET_ID,
    destination: DESTINATION,
  };

  it("reads the signed withdrawal refs and their bound destination", () => {
    const parsed = readIntentRefs(refs);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.refs.mode).toBe("confidential-withdrawal");
    expect(parsed.refs.destination).toBe(DESTINATION);
  });

  it("refuses a withdrawal without a bound destination", () => {
    expect(readIntentRefs({ ...refs, destination: undefined })).toEqual({
      ok: false,
      reason: "refs-malformed",
    });
    expect(readIntentRefs({ ...refs, destination: "nope" })).toEqual({
      ok: false,
      reason: "refs-malformed",
    });
  });

  it("refuses the external deposit and the chain mode", () => {
    for (const mode of ["confidential-external", "chain", undefined]) {
      expect(readIntentRefs({ ...refs, mode }), String(mode)).toEqual({
        ok: false,
        reason: "mode-mismatch",
      });
    }
  });
});

describe("stored quote request", () => {
  const request = {
    fromAssetId: ASSET_ID,
    toAssetId: "nep141:wrap.near",
    amount: "500000",
    recipient: INTENTS_ACCOUNT,
    refundTo: INTENTS_ACCOUNT,
    slippageBps: 100,
    confidentiality: "basic",
    mode: "confidential-intents",
    accountKind: "passkey",
    intentsAccountId: INTENTS_ACCOUNT,
  };

  const expected = {
    mode: "confidential-intents" as const,
    accountKind: "passkey" as const,
    intentsAccountId: INTENTS_ACCOUNT,
  };

  it("rebuilds every priced parameter from the stored row", () => {
    expect(readStoredQuoteRequest(request, expected)).toEqual({
      ok: true,
      params: {
        fromAssetId: ASSET_ID,
        toAssetId: "nep141:wrap.near",
        amount: "500000",
        recipient: INTENTS_ACCOUNT,
        refundTo: INTENTS_ACCOUNT,
        slippageBps: 100,
        confidentiality: "basic",
        mode: "confidential-intents",
      },
    });
  });

  it("rejects the wallet chain route and a different confidential mode", () => {
    expect(
      readStoredQuoteRequest({ ...request, mode: "chain" }, expected),
    ).toEqual({ ok: false, reason: "mode-mismatch" });
    expect(
      readStoredQuoteRequest(
        { ...request, mode: "confidential-external" },
        expected,
      ),
    ).toEqual({ ok: false, reason: "mode-mismatch" });
    expect(readStoredQuoteRequest({ ...request, mode: 42 }, expected)).toEqual({
      ok: false,
      reason: "mode-mismatch",
    });
  });

  it("rejects a quote priced for another account", () => {
    expect(
      readStoredQuoteRequest(
        { ...request, accountKind: "wallet" },
        expected,
      ),
    ).toEqual({ ok: false, reason: "account-mismatch" });
    expect(
      readStoredQuoteRequest(
        { ...request, intentsAccountId: "0xanother" },
        expected,
      ),
    ).toEqual({ ok: false, reason: "account-mismatch" });
    expect(
      readStoredQuoteRequest({ ...request, accountKind: "other" }, expected),
    ).toEqual({ ok: false, reason: "quote-malformed" });
  });

  it("rejects a malformed stored request", () => {
    for (const missing of [
      { ...request, fromAssetId: "" },
      { ...request, toAssetId: "" },
      { ...request, amount: "" },
      { ...request, recipient: "" },
      { ...request, toAssetId: ASSET_ID },
    ]) {
      expect(readStoredQuoteRequest(missing, expected)).toEqual({
        ok: false,
        reason: "quote-malformed",
      });
    }
    expect(readStoredQuoteRequest(null, expected)).toEqual({
      ok: false,
      reason: "quote-malformed",
    });
  });

  it("defaults the refund to the recipient and never sends public", () => {
    const parsed = readStoredQuoteRequest(
      {
        ...request,
        refundTo: "",
        confidentiality: "public",
        mode: undefined,
        accountKind: undefined,
        intentsAccountId: undefined,
      },
      expected,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.params.refundTo).toBe(INTENTS_ACCOUNT);
    expect(parsed.params.confidentiality).toBe("basic");
    expect(parsed.params.mode).toBeNull();
  });

  it("keeps advanced confidentiality and clamps an invalid slippage", () => {
    const advanced = readStoredQuoteRequest(
      { ...request, confidentiality: "advanced", slippageBps: 300 },
      expected,
    );
    expect(advanced.ok).toBe(true);
    if (advanced.ok) {
      expect(advanced.params.confidentiality).toBe("advanced");
      expect(advanced.params.slippageBps).toBe(300);
    }

    for (const slippageBps of [0, -1, 301, 1.5, "100"]) {
      const parsed = readStoredQuoteRequest(
        { ...request, slippageBps },
        expected,
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.params.slippageBps).toBe(100);
    }
  });
});
