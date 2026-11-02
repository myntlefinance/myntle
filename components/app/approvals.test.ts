import { beforeEach, describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { collectApprovalAssetIds, collectApprovals } from "./approvals";
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

  it("leaves a requested approval awaiting with its inputs", () => {
    const [info] = collect([quotePart(), swapPart("approval-requested", { id: "ap-1" })]);
    expect(info.status).toBe("awaiting");
    expect(info.swapInput).toMatchObject({ amount: "14000000" });
    expect(info.amountOut).toBe("13.99");
    expect(info.transactionId).toBeUndefined();
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
