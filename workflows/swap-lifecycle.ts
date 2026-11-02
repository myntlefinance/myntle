import { FatalError, sleep } from "workflow";

export type SwapInput = {
  transactionId: string;
  depositAddress: string;
  txHash?: string;
  expectedOut?: string;
};

export type SwapOutcome = {
  status: "settled" | "refunded" | "failed";
  amountOut: string;
  depositAddress: string;
  explorerUrls: string[];
};

type StatusSnapshot = {
  state: string;
  amountOut?: string;
  explorerUrls: string[];
};

const BASE = "https://1click.chaindefuser.com";

/**
 * The durable swap lifecycle.
 *
 * The workflow holds no state of its own. Every check writes through to
 * Postgres, so a refresh, a dropped connection, or a redeploy resumes from
 * the record rather than from memory. A step that throws is retried; a
 * step that throws FatalError is terminal.
 */
export async function swapLifecycle(input: SwapInput): Promise<SwapOutcome> {
  "use workflow";

  if (input.txHash) {
    await notifyDepositStep({
      depositAddress: input.depositAddress,
      txHash: input.txHash,
    });
  }

  await markStateStep({ transactionId: input.transactionId, state: "pending" });

  // Roughly five minutes of polling: a quick first check, then steady beats.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(attempt === 0 ? "5s" : "10s");

    const snapshot = await pollStatusStep(input.depositAddress);

    if (snapshot.state === "settled") {
      await markStateStep({
        transactionId: input.transactionId,
        state: "settled",
        outcome: {
          amountOut: snapshot.amountOut ?? input.expectedOut ?? "",
          explorerUrls: snapshot.explorerUrls,
        },
      });
      return {
        status: "settled",
        amountOut: snapshot.amountOut ?? input.expectedOut ?? "",
        depositAddress: input.depositAddress,
        explorerUrls: snapshot.explorerUrls,
      };
    }

    if (snapshot.state === "refunded") {
      await markStateStep({
        transactionId: input.transactionId,
        state: "refunded",
        outcome: { explorerUrls: snapshot.explorerUrls },
      });
      return {
        status: "refunded",
        amountOut: "0",
        depositAddress: input.depositAddress,
        explorerUrls: snapshot.explorerUrls,
      };
    }

    if (snapshot.state === "failed" || snapshot.state === "incomplete_deposit") {
      await markStateStep({
        transactionId: input.transactionId,
        state: snapshot.state === "failed" ? "failed" : "incomplete_deposit",
        outcome: { explorerUrls: snapshot.explorerUrls },
      });
      throw new FatalError(`Settlement ended with state: ${snapshot.state}`);
    }

    await markStateStep({
      transactionId: input.transactionId,
      state: snapshot.state === "processing" ? "processing" : "pending",
    });
  }

  await markStateStep({
    transactionId: input.transactionId,
    state: "needs_reconciliation",
  });
  throw new FatalError("Settlement timed out and was marked for reconciliation");
}

async function notifyDepositStep(input: {
  depositAddress: string;
  txHash: string;
}) {
  "use step";

  const res = await fetch(`${BASE}/v0/deposit/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      depositAddress: input.depositAddress,
      txHash: input.txHash,
    }),
  });
  // Some 1Click builds track deposits without an explicit submit call.
  if (!res.ok && res.status !== 404) {
    throw new Error("The deposit registration failed and will be retried");
  }
}

async function pollStatusStep(depositAddress: string): Promise<StatusSnapshot> {
  "use step";

  const res = await fetch(
    `${BASE}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
  );
  if (!res.ok) throw new Error("The status poll failed and will be retried");

  const body = (await res.json()) as {
    status: string;
    swapDetails?: {
      amountOutFormatted?: string;
      originChainTxHashes?: Array<{ explorerUrl?: string }>;
      destinationChainTxHashes?: Array<{ explorerUrl?: string }>;
    };
  };
  const details = body.swapDetails ?? {};

  const TERMINAL: Record<string, string> = {
    SUCCESS: "settled",
    FAILED: "failed",
    REFUNDED: "refunded",
    INCOMPLETE_DEPOSIT: "incomplete_deposit",
    PENDING_DEPOSIT: "pending",
    KNOWN_DEPOSIT_TX: "pending",
    PROCESSING: "processing",
  };

  return {
    state: TERMINAL[body.status] ?? "pending",
    amountOut: details.amountOutFormatted,
    explorerUrls: [
      ...(details.originChainTxHashes ?? []),
      ...(details.destinationChainTxHashes ?? []),
    ]
      .map((h) => h.explorerUrl)
      .filter((u): u is string => !!u),
  };
}

async function markStateStep(input: {
  transactionId: string;
  state: string;
  outcome?: Record<string, unknown>;
}) {
  "use step";

  const { getSupabaseAdmin } = await import("@/lib/db/client");
  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = { state: input.state };
  if (input.outcome) patch.outcome = input.outcome;
  await sb.from("transactions").update(patch).eq("id", input.transactionId);
  await sb.from("transaction_events").insert({
    transaction_id: input.transactionId,
    state: input.state,
    meta: input.outcome ?? {},
  });
}
