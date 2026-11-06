import { beforeEach, describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  collectApprovalAssetIds,
  collectApprovals,
  collectWithdrawals,
  settlementCardState,
} from "./approvals";
import { rememberApprovalTx, resetApprovalStore } from "./approvalStore";

const INPUT = {
  fromAssetId: "nep141:usdc.near",
  toAssetId: "nep141:wrap.near",
  amount: "14000000",
  recipient: "0x3259",
  slippageBps: 100,
};

function quotePart() {
  return {
    type: "tool-get_quote",
    state: "output-available",
    input: INPUT,
    output: {
      amountIn: "14.0",
      amountOut: "13.99",
      minAmountOut: "13.85",
      minAmountOutRaw: "13850000",
      expiresAt: "2026-10-29T00:00:00.000Z",
    },
  };
}

function swapPart(state: string, approval: unknown) {
  return {
    type: "tool-prepare_swap",
    state,
    input: INPUT,
    approval,
  };
}

function collect(
  parts: unknown[],
  createdAt = "2026-10-29T00:00:00.000Z",
  meta: Record<string, { symbol: string; chain?: string; priceUsd?: number }> = {},
  activeAddress?: string | null,
  tickers: [string, string][] = [],
) {
  return collectApprovals(
    {
      id: "msg-1",
      role: "assistant",
      parts: parts as unknown as UIMessage["parts"],
      metadata: { createdAt },
    } as UIMessage,
    new Map(tickers),
    new Map(Object.entries(meta)),
    activeAddress,
  );
}

function catalogueMeta() {
  return {
    "nep141:usdc.near": { symbol: "USDC", chain: "near", priceUsd: 1 },
    "nep141:wrap.near": { symbol: "NEAR", chain: "near", priceUsd: 5.33 },
  };
}

describe("collectApprovals", () => {
  beforeEach(() => {
    resetApprovalStore();
  });

  it("leaves a quote-less approval without signable figures", () => {
    // prepare_swap ran with no get_quote in the turn: the card must not
    // invent figures, so the approval carries inputs only and the card asks
    // for a fresh quote instead of signing blind.
    const [info] = collect([swapPart("approval-requested", { id: "ap-0" })]);
    expect(info?.status).toBe("awaiting");
    expect(info?.minAmountOutRaw).toBeUndefined();
    expect(info?.expiresAt).toBeUndefined();
    expect(info?.swapInput).toMatchObject({
      fromAssetId: INPUT.fromAssetId,
      amount: INPUT.amount,
    });
  });

  it("leaves a requested approval awaiting with its inputs", () => {
    const [info] = collect([quotePart(), swapPart("approval-requested", { id: "ap-1" })]);
    expect(info.status).toBe("awaiting");
    expect(info.swapInput).toMatchObject({ amount: "14000000" });
    expect(info.amountOut).toBe("13.99");
    expect(info.transactionId).toBeUndefined();
  });

  it("carries the stored quote id and refund into the signable input", () => {
    const quoted = quotePart();
    (quoted.output as Record<string, unknown>).quoteId = "11111111-2222-4333-8444-555555555555";
    const [info] = collect([quoted, swapPart("approval-requested", { id: "ap-9" })]);
    expect(info.swapInput).toMatchObject({
      quoteId: "11111111-2222-4333-8444-555555555555",
    });
  });

  it("marks an approved response approved without inputs", () => {
    const [info] = collect([
      quotePart(),
      swapPart("approval-responded", { id: "ap-2", approved: true }),
    ]);
    expect(info.status).toBe("approved");
    expect(info.swapInput).toBeUndefined();
  });

  it("marks a denied response denied without inputs", () => {
    const [info] = collect([
      quotePart(),
      swapPart("approval-responded", { id: "ap-3", approved: false }),
    ]);
    expect(info.status).toBe("denied");
    expect(info.swapInput).toBeUndefined();
  });

  it("prefers a stored transaction over a stale requested snapshot", () => {
    // Decision landed and was recorded, but the saved parts still read requested.
    const requested = swapPart("approval-requested", { id: "ap-4" });
    expect(collect([quotePart(), requested])[0]?.status).toBe("awaiting");
    rememberApprovalTx("ap-4", { transactionId: "tx-4", depositAddress: "dep-4" });
    const [info] = collect([quotePart(), requested]);
    expect(info.status).toBe("approved");
    expect(info.transactionId).toBe("tx-4");
    expect(info.swapInput).toBeUndefined();
  });

  it("carries the message creation time as the card birth", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-5" })],
      "2026-10-29T00:01:00.000Z",
    );
    expect(info.requestedAt).toBe("2026-10-29T00:01:00.000Z");
  });

  it("defaults the action to swap and reads chains and dollars", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-6" })],
      "2026-10-29T00:00:00.000Z",
      catalogueMeta(),
    );
    expect(info.action).toBe("swap");
    expect(info.fromChain).toBe("near");
    expect(info.toChain).toBe("near");
    expect(info.amountInUsd).toBe("$14.00");
    expect(info.amountOutUsd).toBeUndefined();
  });

  it("passes a deposit action through", () => {
    const part = swapPart("approval-requested", { id: "ap-7" }) as {
      input: Record<string, unknown>;
    };
    part.input = { ...INPUT, action: "deposit" };
    const [info] = collect(
      [quotePart(), part],
      "2026-10-29T00:00:00.000Z",
      catalogueMeta(),
    );
    expect(info.action).toBe("deposit");
  });

  it("carries the raw asset ids for server-side resolution", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-8" })],
      "2026-10-29T00:00:00.000Z",
      catalogueMeta(),
    );
    expect(info.fromAssetId).toBe("nep141:usdc.near");
    expect(info.toAssetId).toBe("nep141:wrap.near");
  });

  it("signs bare engine dollar figures", () => {
    const bare = quotePart() as { output: Record<string, unknown> };
    bare.output = { ...bare.output, amountOutUsd: "1.993178630534" };
    const [info] = collect(
      [bare, swapPart("approval-requested", { id: "ap-9" })],
      "2026-10-29T00:00:00.000Z",
      catalogueMeta(),
    );
    expect(info.amountOutUsd).toBe("$1.99");
  });

  it("collects touched asset ids for resolution", () => {
    expect(
      collectApprovalAssetIds([
        quotePart(),
        swapPart("approval-requested", { id: "ap-10" }),
      ] as unknown as UIMessage["parts"]),
    ).toEqual(["nep141:usdc.near", "nep141:wrap.near"]);
  });

  it("carries slippage for the details section", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-11" })],
      "2026-10-29T00:00:00.000Z",
      catalogueMeta(),
    );
    expect(info.slippageBps).toBe(100);
  });

  it("carries unit prices for the token popups", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-13" })],
      "2026-10-29T00:00:00.000Z",
      catalogueMeta(),
    );
    expect(info.fromPriceUsd).toBe("$1.00");
    expect(info.toPriceUsd).toBe("$5.33");
  });

  it("leaves unit prices out when the catalogue never priced the asset", () => {
    const [info] = collect([
      quotePart(),
      swapPart("approval-requested", { id: "ap-14" }),
    ]);
    expect(info.fromPriceUsd).toBeUndefined();
    expect(info.toPriceUsd).toBeUndefined();
  });

  it("calls a same-ticker return to self a deposit no matter the label", () => {
    const part = swapPart("approval-requested", { id: "ap-15" }) as {
      input: Record<string, unknown>;
    };
    part.input = {
      ...INPUT,
      action: "swap",
      fromAssetId: "arb:usdc",
      toAssetId: "nep141:usdc-intents",
      recipient: "0x3259aBcDeF12345678901073",
    };
    const [info] = collect(
      [quotePart(), part],
      "2026-10-29T00:00:00.000Z",
      {
        "arb:usdc": { symbol: "USDC", chain: "arb" },
        "nep141:usdc-intents": { symbol: "USDC", chain: "near" },
      },
      "0x3259aBcDeF12345678901073",
      [
        ["arb:usdc", "USDC"],
        ["nep141:usdc-intents", "USDC"],
      ],
    );
    expect(info.action).toBe("deposit");
  });

  it("keeps the model label when the same ticker goes elsewhere", () => {
    const part = swapPart("approval-requested", { id: "ap-16" }) as {
      input: Record<string, unknown>;
    };
    part.input = {
      ...INPUT,
      action: "swap",
      fromAssetId: "arb:usdc",
      toAssetId: "nep141:usdc-intents",
      recipient: "0x9999aBcDeF12345678901073",
    };
    const [info] = collect(
      [quotePart(), part],
      "2026-10-29T00:00:00.000Z",
      {
        "arb:usdc": { symbol: "USDC", chain: "arb" },
        "nep141:usdc-intents": { symbol: "USDC", chain: "near" },
      },
      "0x3259aBcDeF12345678901073",
      [
        ["arb:usdc", "USDC"],
        ["nep141:usdc-intents", "USDC"],
      ],
    );
    expect(info.action).toBe("swap");
  });

  it("keeps the model label with no connected wallet to compare", () => {
    const part = swapPart("approval-requested", { id: "ap-17" }) as {
      input: Record<string, unknown>;
    };
    part.input = {
      ...INPUT,
      action: "swap",
      fromAssetId: "arb:usdc",
      toAssetId: "nep141:usdc-intents",
      recipient: "0x3259aBcDeF12345678901073",
    };
    const [info] = collect(
      [quotePart(), part],
      "2026-10-29T00:00:00.000Z",
      {
        "arb:usdc": { symbol: "USDC", chain: "arb" },
        "nep141:usdc-intents": { symbol: "USDC", chain: "near" },
      },
      undefined,
      [
        ["arb:usdc", "USDC"],
        ["nep141:usdc-intents", "USDC"],
      ],
    );
    expect(info.action).toBe("swap");
  });

  it("truncates wild amounts for display only", () => {
    const wild = quotePart() as { output: Record<string, unknown> };
    wild.output = {
      ...wild.output,
      amountIn: "14000000.123456789",
      amountOut: "1993997.123456789",
      minAmountOut: "1.974121987654321",
    };
    const [info] = collect(
      [wild, swapPart("approval-requested", { id: "ap-12" })],
      "2026-10-29T00:00:00.000Z",
      catalogueMeta(),
    );
    expect(info.amountOut).toBe("1,993,997.12");
    expect(info.minAmountOut).toBe("1.974122");
    // Dollar math still runs on the raw figure (rounded past thousands).
    expect(info.amountInUsd).toBe("$14,000,000");
  });
});

describe("collectWithdrawals", () => {
  const ASSET = "arb:usdc";
  const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";
  const INPUT = {
    fromAssetId: ASSET,
    toAssetId: ASSET,
    amount: "500000",
    destinationAddress: DESTINATION.toLowerCase(),
  };

  function quotePart(withQuote = true) {
    return {
      type: "tool-get_withdrawal_quote",
      state: "output-available",
      input: INPUT,
      output: {
        mode: "confidential-withdrawal",
        quoteId: withQuote
          ? "11111111-2222-4333-8444-555555555555"
          : null,
        fromAssetId: ASSET,
        toAssetId: ASSET,
        amountIn: "0.5",
        amountOut: "0.4894",
        minAmountOut: "0.484506",
        withdrawFeeFormatted: "0.0106",
        destination: DESTINATION,
        destinationChain: "arb",
        expiresAt: "2026-11-05T00:00:00.000Z",
      },
    };
  }

  function withdrawalPart(state: string, approval: unknown) {
    return {
      type: "tool-prepare_withdrawal",
      state,
      input: INPUT,
      approval,
    };
  }

  function collect(parts: unknown[]) {
    return collectWithdrawals(
      {
        id: "msg-w",
        role: "assistant",
        parts: parts as unknown as UIMessage["parts"],
        metadata: { createdAt: "2026-11-02T12:00:00.000Z" },
      } as UIMessage,
      new Map([["arb:usdc", "USDC"]]),
      new Map([
        [ASSET, { symbol: "USDC", chain: "arb", priceUsd: 1 }],
      ]),
    );
  }

  it("takes the destination from the stored quote, never the tool input", () => {
    const [withdrawal] = collect([
      quotePart(),
      withdrawalPart("approval-requested", { id: "ap-w1" }),
    ]);

    expect(withdrawal).toMatchObject({
      approvalId: "ap-w1",
      status: "awaiting",
      fromAssetId: ASSET,
      toAssetId: ASSET,
      fromSymbol: "USDC",
      toSymbol: "USDC",
      destination: DESTINATION,
      destinationChain: "arb",
      quoteId: "11111111-2222-4333-8444-555555555555",
      amountIn: "0.5",
      amountOut: "0.4894",
      minAmountOut: "0.484506",
      fee: "0.0106",
      amount: "500000",
    });
  });

  it("keeps a proposal without a quote and leaves the quote id out", () => {
    const [withdrawal] = collect([
      quotePart(false),
      withdrawalPart("approval-requested", { id: "ap-w2" }),
    ]);

    expect(withdrawal.quoteId).toBeUndefined();
    expect(withdrawal.destination).toBeUndefined();
  });

  it("paints an executed proposal as approved", () => {
    const [withdrawal] = collect([
      quotePart(),
      withdrawalPart("output-available", {
        id: "ap-w3",
        approved: true,
      }),
    ]);

    expect(withdrawal.status).toBe("approved");
  });

  it("paints a rejected proposal as denied", () => {
    const [withdrawal] = collect([
      quotePart(),
      withdrawalPart("approval-responded", {
        id: "ap-w4",
        approved: false,
      }),
    ]);

    expect(withdrawal.status).toBe("denied");
  });

  it("takes the assets from the stored quote, not the tool input", () => {
    const part = withdrawalPart("approval-requested", { id: "ap-w6" }) as {
      input: Record<string, unknown>;
    };
    part.input = {
      ...part.input,
      fromAssetId: "arb:other",
      toAssetId: "arb:other",
    };

    const [withdrawal] = collect([quotePart(), part]);

    expect(withdrawal.fromAssetId).toBe(ASSET);
    expect(withdrawal.toAssetId).toBe(ASSET);
    expect(withdrawal.fromSymbol).toBe("USDC");
  });

  it("collects both withdrawal tools' assets for metadata resolution", () => {
    expect(
      collectApprovalAssetIds([
        quotePart(),
        withdrawalPart("approval-requested", { id: "ap-w5" }),
      ] as unknown as UIMessage["parts"]),
    ).toEqual([ASSET]);
  });
});

describe("settlementCardState", () => {
  // Failed vs refunded is the distinction the card must never blur: one
  // means the money may be gone, the other means it is coming back.
  it.each([
    ["failed", "failed"],
    ["incomplete_deposit", "failed"],
    ["needs_reconciliation", "failed"],
    ["refunded", "refunded"],
    ["settled", "settled"],
  ])("paints %s as %s", (state, painted) => {
    expect(settlementCardState(state)).toBe(painted);
  });

  it("leaves live states to the poll", () => {
    for (const state of ["pending", "confirming", "processing", "submitted"]) {
      expect(settlementCardState(state)).toBeNull();
    }
  });
});
