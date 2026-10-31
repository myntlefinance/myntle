import { FatalError, sleep } from "workflow";

export type SwapInput = {
  fromAssetId: string;
  toAssetId: string;
  amount: string;
};

export type SwapOutcome = {
  status: "settled" | "refunded" | "failed";
  amountOut: string;
  depositAddress: string;
};

export async function swapLifecycle(input: SwapInput): Promise<SwapOutcome> {
  "use workflow";

  const quote = await fetchQuoteStep(input);

  await sleep("2s");

  const outcome = await checkStatusStep({
    depositAddress: quote.depositAddress,
    expectedOut: quote.amountOut,
  });

  if (outcome.status === "failed") {
    throw new FatalError("The settlement failed on chain");
  }

  return outcome;
}

async function fetchQuoteStep(input: SwapInput) {
  "use step";

  const res = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dry: false,
      swapType: "EXACT_INPUT",
      originAsset: input.fromAssetId,
      destinationAsset: input.toAssetId,
      amount: input.amount,
      recipient: "test.near",
      refundTo: "test.near",
      depositType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
      slippageTolerance: 100,
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  });

  const body = await res.json();
  return {
    depositAddress: body.quote.depositAddress as string,
    amountOut: body.quote.amountOutFormatted as string,
  };
}

async function checkStatusStep(input: {
  depositAddress: string;
  expectedOut: string;
}): Promise<SwapOutcome> {
  "use step";

  const res = await fetch(
    `https://1click.chaindefuser.com/v0/status?depositAddress=${input.depositAddress}`,
  );
  const body = await res.json();

  return {
    status: body.status === "SUCCESS" ? "settled" : "refunded",
    amountOut: input.expectedOut,
    depositAddress: input.depositAddress,
  };
}
