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
      expiresAt: "2026-11-02T00:00:00.000Z",
      quoteId: "quote-default",
      route: "wallet",
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
  createdAt = "2026-11-02T00:00:00.000Z",
  meta: Record<string, { symbol: string; chain?: string; priceUsd?: number }> = {},
  activeAddress?: string | null,
  tickers: [string, string][] = [],
  decisions?: Record<string, "approved" | "denied"> | null,
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
    decisions,
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
      "2026-11-02T00:01:00.000Z",
    );
    expect(info.requestedAt).toBe("2026-11-02T00:01:00.000Z");
  });

  it("defaults the action to swap and reads chains and dollars", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-6" })],
      "2026-11-02T00:00:00.000Z",
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
      "2026-11-02T00:00:00.000Z",
      catalogueMeta(),
    );
    expect(info.action).toBe("deposit");
  });

  it("carries the quote's route so the card can pick its approval path", () => {
    const [info] = collect([
      quotePart(),
      swapPart("approval-requested", { id: "ap-route-1" }),
    ]);
    expect(info.route).toBe("wallet");
  });

  it("routes an account-funded quote, even from a wallet session", () => {
    const quoted = quotePart() as { output: Record<string, unknown> };
    quoted.output = { ...quoted.output, route: "account" };
    const [info] = collect([
      quoted,
      swapPart("approval-requested", { id: "ap-route-2" }),
    ]);
    expect(info.route).toBe("account");
    // The internal mode never becomes the interface's route.
    expect(info.route).not.toBe("confidential-intents");
  });

  it("reads the route from a stored mode on messages saved before it", () => {
    const account = quotePart() as { output: Record<string, unknown> };
    delete account.output.route;
    account.output.mode = "confidential-intents";
    const [accountInfo] = collect([
      account,
      swapPart("approval-requested", { id: "ap-route-3" }),
    ]);
    expect(accountInfo.route).toBe("account");

    const wallet = quotePart() as { output: Record<string, unknown> };
    delete wallet.output.route;
    wallet.output.mode = "chain";
    const [walletInfo] = collect([
      wallet,
      swapPart("approval-requested", { id: "ap-route-4" }),
    ]);
    expect(walletInfo.route).toBe("wallet");
  });

  it("leaves the route unset when the quote named neither", () => {
    const legacy = quotePart() as { output: Record<string, unknown> };
    delete legacy.output.route;
    const [info] = collect([
      legacy,
      swapPart("approval-requested", { id: "ap-route-5" }),
    ]);
    expect(info.route).toBeUndefined();
  });

  it("gives each swap its own quote in a two-quote turn", () => {
    const OTHER_FROM = "nep141:usdt";
    const OTHER_TO = "nep141:eth";
    const quoteA = {
      type: "tool-get_quote",
      state: "output-available",
      input: {
        fromAssetId: INPUT.fromAssetId,
        toAssetId: INPUT.toAssetId,
        amount: INPUT.amount,
        recipient: INPUT.recipient,
        slippageBps: 100,
      },
      output: {
        amountIn: "14.0",
        amountOut: "13.99",
        minAmountOut: "13.85",
        minAmountOutRaw: "13850000",
        expiresAt: "2026-11-02T00:00:00.000Z",
        quoteId: "quote-a",
        route: "wallet",
      },
    };
    const quoteB = {
      type: "tool-get_quote",
      state: "output-available",
      input: {
        fromAssetId: OTHER_FROM,
        toAssetId: OTHER_TO,
        amount: "20000000",
        recipient: INPUT.recipient,
        slippageBps: 100,
      },
      output: {
        amountIn: "20.0",
        amountOut: "0.5",
        minAmountOut: "0.49",
        minAmountOutRaw: "490000000000000000",
        expiresAt: "2026-11-02T01:00:00.000Z",
        quoteId: "quote-b",
        route: "account",
      },
    };
    const swapB = {
      type: "tool-prepare_swap",
      state: "approval-requested",
      input: {
        ...INPUT,
        fromAssetId: OTHER_FROM,
        toAssetId: OTHER_TO,
        amount: "20000000",
      },
      approval: { id: "ap-b" },
    };

    const infos = collect([
      quoteA,
      swapPart("approval-requested", { id: "ap-a" }),
      quoteB,
      swapB,
    ]);

    expect(
      infos.map((info) => ({
        id: info.approvalId,
        quoteId: info.swapInput?.quoteId,
        amountIn: info.amountIn,
        amountOut: info.amountOut,
        route: info.route,
      })),
    ).toEqual([
      {
        id: "ap-a",
        quoteId: "quote-a",
        amountIn: "14",
        amountOut: "13.99",
        route: "wallet",
      },
      {
        id: "ap-b",
        quoteId: "quote-b",
        amountIn: "20",
        amountOut: "0.5",
        route: "account",
      },
    ]);
  });

  it("gives a swap no quote when the turn's quote priced another pair", () => {
    const other = swapPart("approval-requested", { id: "ap-nomatch" }) as {
      input: Record<string, unknown>;
    };
    other.input = {
      ...other.input,
      fromAssetId: "nep141:usdt",
      toAssetId: "nep141:eth",
      amount: "20000000",
    };

    const [info] = collect([quotePart(), other]);

    expect(info.swapInput?.quoteId).toBeUndefined();
    expect(info.amountIn).toBe("—");
    expect(info.amountOut).toBe("—");
    expect(info.minAmountOutRaw).toBeUndefined();
    expect(info.expiresAt).toBeUndefined();
    expect(info.route).toBeUndefined();
  });

  it("assigns duplicate same-pair quotes one to each card", () => {
    const first = quotePart() as { output: Record<string, unknown> };
    first.output = { ...first.output, quoteId: "quote-1", amountOut: "13.99" };
    const second = quotePart() as { output: Record<string, unknown> };
    second.output = { ...second.output, quoteId: "quote-2", amountOut: "14.01" };

    const infos = collect([
      first,
      second,
      swapPart("approval-requested", { id: "ap-dup-1" }),
      swapPart("approval-requested", { id: "ap-dup-2" }),
    ]);

    expect(infos.map((info) => info.swapInput?.quoteId)).toEqual([
      "quote-2",
      "quote-1",
    ]);
    expect(infos.map((info) => info.amountOut)).toEqual(["14.01", "13.99"]);
  });

  it("gives one quote to only one of two identical proposals", () => {
    const infos = collect([
      quotePart(),
      swapPart("approval-requested", { id: "ap-one-1" }),
      swapPart("approval-requested", { id: "ap-one-2" }),
    ]);

    expect(infos[0].swapInput?.quoteId).toBe("quote-default");
    expect(infos[0].amountIn).toBe("14");
    expect(infos[1].swapInput?.quoteId).toBeUndefined();
    expect(infos[1].amountIn).toBe("—");
    expect(infos[1].amountOut).toBe("—");
    expect(infos[1].route).toBeUndefined();
  });

  it("never lets an approved card consume the quote a waiting card needs", () => {
    const infos = collect([
      quotePart(),
      swapPart("approval-responded", { id: "ap-done-a", approved: true }),
      swapPart("approval-requested", { id: "ap-wait-b" }),
    ]);

    expect(infos[0].status).toBe("approved");
    expect(infos[0].amountIn).toBe("14");
    expect(infos[0].amountOut).toBe("13.99");
    expect(infos[0].route).toBe("wallet");
    expect(infos[1].status).toBe("awaiting");
    expect(infos[1].swapInput?.quoteId).toBe("quote-default");
    expect(infos[1].amountIn).toBe("14");
  });

  it("never lets a denied card consume the quote a waiting card needs", () => {
    const infos = collect([
      quotePart(),
      swapPart("approval-responded", { id: "ap-done-c", approved: false }),
      swapPart("approval-requested", { id: "ap-wait-d" }),
    ]);

    expect(infos[0].status).toBe("denied");
    expect(infos[0].amountIn).toBe("14");
    expect(infos[0].amountOut).toBe("13.99");
    expect(infos[1].status).toBe("awaiting");
    expect(infos[1].swapInput?.quoteId).toBe("quote-default");
  });

  it("keeps a duplicate quote id from being shared by waiting cards", () => {
    const first = quotePart() as { output: Record<string, unknown> };
    first.output = { ...first.output, quoteId: "same-id" };
    const second = quotePart() as { output: Record<string, unknown> };
    second.output = { ...second.output, quoteId: "same-id" };

    const infos = collect([
      first,
      second,
      swapPart("approval-requested", { id: "ap-same-1" }),
      swapPart("approval-requested", { id: "ap-same-2" }),
    ]);

    // The first card takes the latest row; the second cannot reuse the id.
    expect(infos[0].swapInput?.quoteId).toBe("same-id");
    expect(infos[1].swapInput?.quoteId).toBeUndefined();
    expect(infos[1].amountIn).toBe("—");
  });

  it("ignores a quote output with no stored row", () => {
    const preview = quotePart() as { output: Record<string, unknown> };
    preview.output = {
      ...preview.output,
      quoteId: null,
      route: "account",
    };

    const [info] = collect([
      preview,
      swapPart("approval-requested", { id: "ap-preview" }),
    ]);

    expect(info.swapInput?.quoteId).toBeUndefined();
    expect(info.amountIn).toBe("—");
    expect(info.amountOut).toBe("—");
    expect(info.minAmountOutRaw).toBeUndefined();
    expect(info.route).toBeUndefined();
  });

  function recipientVariant(
    quoteRecipient: string,
    proposalRecipient: string,
  ) {
    const quote = quotePart() as { input: Record<string, unknown> };
    quote.input = { ...quote.input, recipient: quoteRecipient };
    const proposal = swapPart("approval-requested", {
      id: "ap-recipient-variant",
    }) as { input: Record<string, unknown> };
    proposal.input = { ...proposal.input, recipient: proposalRecipient };
    return collect([quote, proposal])[0];
  }

  it("matches a lower-case EVM recipient against its checksummed form", () => {
    const checksummed = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    expect(
      recipientVariant(checksummed.toLowerCase(), checksummed).swapInput
        ?.quoteId,
    ).toBe("quote-default");
  });

  it("matches a checksummed EVM recipient against its lower-case form", () => {
    const checksummed = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    expect(
      recipientVariant(checksummed, checksummed.toLowerCase()).swapInput
        ?.quoteId,
    ).toBe("quote-default");
  });

  it("does not case-fold a non-EVM recipient", () => {
    const solana = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
    const info = recipientVariant(solana, solana.toLowerCase());
    expect(info.swapInput?.quoteId).toBeUndefined();
    expect(info.amountIn).toBe("—");
  });

  it("matches two names that differ only in case", () => {
    const info = recipientVariant("Vitalik.eth", "vitalik.eth");
    expect(info.swapInput?.quoteId).toBe("quote-default");
  });

  it("requires the signed recipient to match on a wallet quote", () => {
    const quote = quotePart() as {
      input: Record<string, unknown>;
    };
    quote.input = {
      ...quote.input,
      recipient: "0x0000000000000000000000000000000000000001",
    };
    const proposal = swapPart("approval-requested", {
      id: "ap-recipient-mismatch",
    }) as { input: Record<string, unknown> };
    proposal.input = {
      ...proposal.input,
      recipient: "0x0000000000000000000000000000000000000002",
    };

    const [info] = collect([quote, proposal]);

    expect(info.swapInput?.quoteId).toBeUndefined();
    expect(info.amountIn).toBe("—");
    expect(info.route).toBeUndefined();
  });

  it("requires the signed refund to match on a wallet quote", () => {
    const quote = quotePart() as {
      input: Record<string, unknown>;
    };
    quote.input = {
      ...quote.input,
      refundTo: "0x0000000000000000000000000000000000000001",
    };
    const proposal = swapPart("approval-requested", {
      id: "ap-refund-mismatch",
    }) as { input: Record<string, unknown> };
    proposal.input = {
      ...proposal.input,
      refundTo: "0x0000000000000000000000000000000000000002",
    };

    const [info] = collect([quote, proposal]);

    expect(info.swapInput?.quoteId).toBeUndefined();
    expect(info.amountIn).toBe("—");
  });

  it("requires the signed slippage to match on a wallet quote", () => {
    const quote = quotePart() as {
      input: Record<string, unknown>;
    };
    quote.input = { ...quote.input, slippageBps: 100 };
    const proposal = swapPart("approval-requested", {
      id: "ap-slippage-mismatch",
    }) as { input: Record<string, unknown> };
    proposal.input = { ...proposal.input, slippageBps: 200 };

    const [info] = collect([quote, proposal]);

    expect(info.swapInput?.quoteId).toBeUndefined();
    expect(info.amountIn).toBe("—");
  });

  it("ignores the recipient on an account-funded quote", () => {
    const quote = quotePart() as {
      input: Record<string, unknown>;
      output: Record<string, unknown>;
    };
    quote.input = {
      ...quote.input,
      recipient: "0x0000000000000000000000000000000000000001",
    };
    quote.output = { ...quote.output, route: "account" };
    const proposal = swapPart("approval-requested", {
      id: "ap-account-recipient",
    }) as { input: Record<string, unknown> };
    proposal.input = {
      ...proposal.input,
      recipient: "0x0000000000000000000000000000000000000002",
    };

    const [info] = collect([quote, proposal]);

    expect(info.swapInput?.quoteId).toBe("quote-default");
    expect(info.route).toBe("account");
  });

  it("still requires slippage to match on an account-funded quote", () => {
    const quote = quotePart() as {
      input: Record<string, unknown>;
      output: Record<string, unknown>;
    };
    quote.input = { ...quote.input, slippageBps: 100 };
    quote.output = { ...quote.output, route: "account" };
    const proposal = swapPart("approval-requested", {
      id: "ap-account-slippage",
    }) as { input: Record<string, unknown> };
    proposal.input = { ...proposal.input, slippageBps: 200 };

    const [info] = collect([quote, proposal]);

    expect(info.swapInput?.quoteId).toBeUndefined();
    expect(info.amountIn).toBe("—");
    expect(info.route).toBeUndefined();
  });

  it("carries the raw asset ids for server-side resolution", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-8" })],
      "2026-11-02T00:00:00.000Z",
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
      "2026-11-02T00:00:00.000Z",
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
      "2026-11-02T00:00:00.000Z",
      catalogueMeta(),
    );
    expect(info.slippageBps).toBe(100);
  });

  it("carries unit prices for the token popups", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-13" })],
      "2026-11-02T00:00:00.000Z",
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
      "2026-11-02T00:00:00.000Z",
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
      "2026-11-02T00:00:00.000Z",
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
      "2026-11-02T00:00:00.000Z",
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
      "2026-11-02T00:00:00.000Z",
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

  it("carries the destination name from the stored quote", () => {
    const quoted = quotePart();
    (quoted.output as Record<string, unknown>).destinationName =
      "vitalik.eth";
    const [withdrawal] = collect([
      quoted,
      withdrawalPart("approval-requested", { id: "ap-w4" }),
    ]);

    expect(withdrawal.destination).toBe(DESTINATION);
    expect(withdrawal.destinationName).toBe("vitalik.eth");
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

  it("refuses a quote that priced a different pair than the proposal", () => {
    const part = withdrawalPart("approval-requested", { id: "ap-w6" }) as {
      input: Record<string, unknown>;
    };
    part.input = {
      ...part.input,
      fromAssetId: "arb:other",
      toAssetId: "arb:other",
    };

    const [withdrawal] = collect([quotePart(), part]);

    // Fail closed: a mismatched quote lends no id, no figures, and no
    // destination.
    expect(withdrawal.fromAssetId).toBe("arb:other");
    expect(withdrawal.quoteId).toBeUndefined();
    expect(withdrawal.destination).toBeUndefined();
    expect(withdrawal.amountIn).toBeUndefined();
  });

  it("gives each withdrawal its own quote in a two-quote turn", () => {
    const OTHER = "base:usdc";
    const OTHER_DESTINATION = "0x0000000000000000000000000000000000000001";
    const quoteOne = quotePart();
    const secondInput = {
      fromAssetId: OTHER,
      toAssetId: OTHER,
      amount: "700000",
      destinationAddress: OTHER_DESTINATION.toLowerCase(),
    };
    const quoteTwo = {
      type: "tool-get_withdrawal_quote",
      state: "output-available",
      input: secondInput,
      output: {
        quoteId: "22222222-2222-4333-8444-555555555555",
        fromAssetId: OTHER,
        toAssetId: OTHER,
        amountIn: "0.7",
        amountOut: "0.6894",
        minAmountOut: "0.684506",
        withdrawFeeFormatted: "0.0106",
        destination: OTHER_DESTINATION,
        destinationChain: "base",
        expiresAt: "2026-11-05T00:00:00.000Z",
      },
    };
    const secondProposal = {
      type: "tool-prepare_withdrawal",
      state: "approval-requested",
      input: secondInput,
      approval: { id: "ap-w7" },
    };

    const withdrawals = collect([
      quoteOne,
      withdrawalPart("approval-requested", { id: "ap-w8" }),
      quoteTwo,
      secondProposal,
    ]);

    expect(
      withdrawals.map((w) => ({
        id: w.approvalId,
        quoteId: w.quoteId,
        amountIn: w.amountIn,
        destination: w.destination,
      })),
    ).toEqual([
      {
        id: "ap-w8",
        quoteId: "11111111-2222-4333-8444-555555555555",
        amountIn: "0.5",
        destination: DESTINATION,
      },
      {
        id: "ap-w7",
        quoteId: "22222222-2222-4333-8444-555555555555",
        amountIn: "0.7",
        destination: OTHER_DESTINATION,
      },
    ]);
  });

  it("assigns duplicate same-destination quotes one to each withdrawal", () => {
    const first = quotePart() as { output: Record<string, unknown> };
    first.output = { ...first.output, quoteId: "withdraw-1", amountOut: "0.4894" };
    const second = quotePart() as { output: Record<string, unknown> };
    second.output = { ...second.output, quoteId: "withdraw-2", amountOut: "0.4895" };

    const withdrawals = collect([
      first,
      second,
      withdrawalPart("approval-requested", { id: "ap-dup-w1" }),
      withdrawalPart("approval-requested", { id: "ap-dup-w2" }),
    ]);

    expect(withdrawals.map((w) => w.quoteId)).toEqual([
      "withdraw-2",
      "withdraw-1",
    ]);
    expect(withdrawals.map((w) => w.amountOut)).toEqual(["0.4895", "0.4894"]);
  });

  it("never lets an approved withdrawal consume the quote a waiting card needs", () => {
    const withdrawals = collect([
      quotePart(),
      withdrawalPart("approval-responded", {
        id: "ap-w-done",
        approved: true,
      }),
      withdrawalPart("approval-requested", { id: "ap-w-wait" }),
    ]);

    expect(withdrawals[0].status).toBe("approved");
    expect(withdrawals[0].quoteId).toBe("11111111-2222-4333-8444-555555555555");
    expect(withdrawals[1].status).toBe("awaiting");
    expect(withdrawals[1].quoteId).toBe("11111111-2222-4333-8444-555555555555");
    expect(withdrawals[1].destination).toBe(DESTINATION);
  });

  it("never lets a denied withdrawal consume the quote a waiting card needs", () => {
    const withdrawals = collect([
      quotePart(),
      withdrawalPart("approval-responded", {
        id: "ap-w-denied",
        approved: false,
      }),
      withdrawalPart("approval-requested", { id: "ap-w-next" }),
    ]);

    expect(withdrawals[0].status).toBe("denied");
    expect(withdrawals[0].quoteId).toBe("11111111-2222-4333-8444-555555555555");
    expect(withdrawals[1].status).toBe("awaiting");
    expect(withdrawals[1].quoteId).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("keeps a duplicate withdrawal quote id from being shared by waiting cards", () => {
    const first = quotePart() as { output: Record<string, unknown> };
    first.output = { ...first.output, quoteId: "same-withdraw-id" };
    const second = quotePart() as { output: Record<string, unknown> };
    second.output = { ...second.output, quoteId: "same-withdraw-id" };

    const withdrawals = collect([
      first,
      second,
      withdrawalPart("approval-requested", { id: "ap-same-w1" }),
      withdrawalPart("approval-requested", { id: "ap-same-w2" }),
    ]);

    expect(withdrawals[0].quoteId).toBe("same-withdraw-id");
    expect(withdrawals[1].quoteId).toBeUndefined();
    expect(withdrawals[1].destination).toBeUndefined();
  });

  function destinationTurn(options: {
    quoteDestination: string;
    proposalDestination: string;
    resolvedDestination?: string;
    resolvedName?: string;
  }) {
    const quoteInput = {
      ...INPUT,
      destinationAddress: options.quoteDestination,
    };
    const proposalInput = {
      ...INPUT,
      destinationAddress: options.proposalDestination,
    };
    const quote = {
      type: "tool-get_withdrawal_quote",
      state: "output-available",
      input: quoteInput,
      output: {
        quoteId: "quote-destination",
        fromAssetId: ASSET,
        toAssetId: ASSET,
        amountIn: "0.5",
        amountOut: "0.4894",
        minAmountOut: "0.484506",
        destination: options.resolvedDestination ?? DESTINATION,
        ...(options.resolvedName
          ? { destinationName: options.resolvedName }
          : {}),
        destinationChain: "arb",
        expiresAt: "2026-11-05T00:00:00.000Z",
      },
    };
    const proposal = {
      type: "tool-prepare_withdrawal",
      state: "approval-requested",
      input: proposalInput,
      approval: { id: "ap-destination" },
    };
    return collect([quote, proposal])[0];
  }

  it("matches a lowercase quote to a checksummed proposal", () => {
    const withdrawal = destinationTurn({
      quoteDestination: DESTINATION.toLowerCase(),
      proposalDestination: DESTINATION,
    });
    expect(withdrawal.quoteId).toBe("quote-destination");
  });

  it("matches a checksummed quote to a lowercase proposal", () => {
    const withdrawal = destinationTurn({
      quoteDestination: DESTINATION,
      proposalDestination: DESTINATION.toLowerCase(),
    });
    expect(withdrawal.quoteId).toBe("quote-destination");
  });

  it("matches a name quote to an address proposal", () => {
    const withdrawal = destinationTurn({
      quoteDestination: "vitalik.eth",
      proposalDestination: DESTINATION,
      resolvedDestination: DESTINATION,
      resolvedName: "vitalik.eth",
    });
    expect(withdrawal.quoteId).toBe("quote-destination");
    expect(withdrawal.destination).toBe(DESTINATION);
  });

  it("fails closed when an address quote is proposed by name", () => {
    const withdrawal = destinationTurn({
      quoteDestination: DESTINATION,
      proposalDestination: "vitalik.eth",
      resolvedDestination: DESTINATION,
    });
    // An address quote has no name to prove the proposal against, and the
    // client does not resolve names here. The model must pass the same
    // destination string to both tools.
    expect(withdrawal.quoteId).toBeUndefined();
    expect(withdrawal.destination).toBeUndefined();
  });

  it("fails closed when the quote and proposal name different destinations", () => {
    const withdrawal = destinationTurn({
      quoteDestination: DESTINATION,
      proposalDestination: "0x0000000000000000000000000000000000000001",
      resolvedDestination: DESTINATION,
    });
    expect(withdrawal.quoteId).toBeUndefined();
    expect(withdrawal.destination).toBeUndefined();
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
    ["expired", "expired"],
  ])("paints %s as %s", (state, painted) => {
    expect(settlementCardState(state)).toBe(painted);
  });

  it("leaves live states to the poll", () => {
    for (const state of ["pending", "confirming", "processing", "submitted"]) {
      expect(settlementCardState(state)).toBeNull();
    }
  });
});

describe("collectApprovals from the record", () => {
  beforeEach(() => {
    resetApprovalStore();
  });

  // The paused snapshot is saved before the decision exists and is never
  // rewritten, so a reloaded part still says "approval requested". The record
  // is what decides, on every device.
  it("paints a refusal the snapshot never heard about", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-r1" })],
      undefined,
      {},
      null,
      [],
      { "ap-r1": "denied" },
    );
    expect(info?.status).toBe("denied");
  });

  it("paints an approval the snapshot never heard about", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-r2" })],
      undefined,
      {},
      null,
      [],
      { "ap-r2": "approved" },
    );
    expect(info?.status).toBe("approved");
    // The proposal is spent, so the host must not offer it again.
    expect(info?.swapInput).toBeUndefined();
  });

  it("leaves an undecided card awaiting", () => {
    const [info] = collect(
      [quotePart(), swapPart("approval-requested", { id: "ap-r3" })],
      undefined,
      {},
      null,
      [],
      {},
    );
    expect(info?.status).toBe("awaiting");
  });
});
