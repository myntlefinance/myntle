import { FatalError, sleep } from "workflow";
import { settledAmountOut } from "@/lib/intents/settlement-amount";

export type SwapInput = {
  transactionId: string;
  depositAddress: string;
  txHash?: string;
  expectedOut?: string;
  /**
   * The quote mode the approval recorded. It only decides whether a missing
   * status amount may fall back to the quote; a withdrawal never may.
   */
  mode?: string | null;
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
 * The status endpoint is partner-scoped. P0.10 measured that a confidential
 * quote returns `404 Deposit address … not found` without the partner key.
 * The key is configuration, so reading it inside a step is deterministic;
 * it is never printed or written to the transaction record.
 */
function oneClickHeaders(): Record<string, string> {
  const key = process.env.ONE_CLICK_API_KEY;
  return {
    "Content-Type": "application/json",
    ...(key ? { "X-API-Key": key } : {}),
  };
}

/**
 * The durable swap lifecycle, deposit flow.
 *
 * The workflow holds no state of its own. Every check writes through to
 * Postgres, so a refresh, a dropped connection, or a redeploy resumes from
 * the record rather than from memory. A step that throws is retried; a
 * step that throws FatalError is terminal.
 *
 * Each named step is idempotent, so replays never double-submit: the commit
 * reuses the stored deposit address, the deposit record merges rather than
 * overwrites, and the status submit is a read-only nudge 1Click tolerates.
 */
export async function swapLifecycle(input: SwapInput): Promise<SwapOutcome> {
  "use workflow";

  // The approve route normally mints the wet quote before starting this
  // run. This step makes the workflow the owner of the commit: the normal
  // path is a single read, and only a crash between mint and start mints
  // again from the approval parameters.
  const depositAddress = await commitQuoteStep(input);

  await recordDepositStep({
    transactionId: input.transactionId,
    depositAddress,
    txHash: input.txHash,
  });

  // Up to 600 beats with adaptive backoff: 6s for the first ~30 polls
  // (~3 min, when most deposits confirm), then 15s thereafter. Total
  // wall-clock: 30*6s + 570*15s = 8730s (~2.4h) >= 1h cap preserved.
  // Sleeps cost no compute, so the Hobby 300s request cap does not apply —
  // nothing loops inside a request. An external exchange withdrawal can take
  // longer than the old five-minute window.
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await sleep(attempt < 30 ? "6s" : "15s");

    const snapshot = await checkStatusStep({
      transactionId: input.transactionId,
      depositAddress,
    });

    if (snapshot.state === "settled") {
      const amountOut = settledAmountOut({
        mode: input.mode,
        snapshotAmountOut: snapshot.amountOut,
        expectedOut: input.expectedOut,
      });
      await markStateStep({
        transactionId: input.transactionId,
        state: "settled",
        outcome: {
          amountOut,
          explorerUrls: snapshot.explorerUrls,
        },
      });
      return {
        status: "settled",
        amountOut,
        depositAddress,
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
        depositAddress,
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
  }

  await markStateStep({
    transactionId: input.transactionId,
    state: "needs_reconciliation",
  });
  throw new FatalError("Settlement timed out and was marked for reconciliation");
}

/**
 * Owns the execution quote. Reads the transaction row first: when the
 * approve route already minted the one-time deposit address, this is a
 * plain read and no second quote exists. Only a missing address mints
 * again, from the approval parameters the wallet signed.
 */
async function commitQuoteStep(input: SwapInput): Promise<string> {
  "use step";

  const { getSupabaseAdmin } = await import("@/lib/db/client");
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("transactions")
    .select("deposit_address, approval_id")
    .eq("id", input.transactionId)
    .single();
  const stored = (data ?? {}) as {
    deposit_address?: string | null;
    approval_id?: string | null;
  };
  if (stored.deposit_address) return stored.deposit_address;
  if (input.depositAddress) {
    await sb
      .from("transactions")
      .update({ deposit_address: input.depositAddress })
      .eq("id", input.transactionId);
    return input.depositAddress;
  }

  const { data: approval } = await sb
    .from("approvals")
    .select("parameters")
    .eq("id", stored.approval_id ?? "")
    .single();
  const p = ((approval ?? {}) as { parameters?: Record<string, unknown> })
    .parameters;
  if (!p || typeof p.fromAssetId !== "string") {
    throw new Error("The trade has no priced parameters to commit");
  }
  const { createExecutionQuote } = await import("@/lib/intents/service");
  // Preserve the mode the approval was priced with. A withdrawal re-minted
  // as the default chain route would send the funds to a public recipient.
  const storedMode = p.mode;
  const mode =
    storedMode === "chain" ||
    storedMode === "confidential-intents" ||
    storedMode === "confidential-external" ||
    storedMode === "confidential-withdrawal"
      ? storedMode
      : undefined;
  const execution = await createExecutionQuote({
    fromAssetId: p.fromAssetId as string,
    toAssetId: p.toAssetId as string,
    amount: p.amount as string,
    recipient: p.recipient as string,
    refundTo: p.refundTo as string | undefined,
    slippageBps: (p.slippageBps as number | undefined) ?? 100,
    ...(mode ? { mode } : {}),
  });
  if (!execution.depositAddress) {
    throw new Error("The execution quote returned no deposit address");
  }
  await sb
    .from("transactions")
    .update({ deposit_address: execution.depositAddress })
    .eq("id", input.transactionId);
  return execution.depositAddress;
}

/**
 * Pins the deposit address and the origin-chain funding hash to the
 * record. Merges rather than overwrites, so a later funding hash never
 * clobbers an earlier one and replays change nothing.
 */
async function recordDepositStep(input: {
  transactionId: string;
  depositAddress: string;
  txHash?: string;
}) {
  "use step";

  const { getSupabaseAdmin } = await import("@/lib/db/client");
  const sb = getSupabaseAdmin();
  if (input.txHash) {
    const { data } = await sb
      .from("transactions")
      .select("refs")
      .eq("id", input.transactionId)
      .single();
    const refs = ((data ?? {}) as { refs?: Record<string, unknown> }).refs ?? {};
    if (!refs.txHash) {
      await sb
        .from("transactions")
        .update({
          deposit_address: input.depositAddress,
          refs: { ...refs, txHash: input.txHash },
        })
        .eq("id", input.transactionId);
    }
    // Nudges 1Click to notice the funding hash sooner. Detection also
    // happens without it — the status poll below is authoritative — so a
    // missing endpoint or a blip never fails the trade.
    try {
      const res = await fetch(`${BASE}/v0/deposit/submit`, {
        method: "POST",
        headers: oneClickHeaders(),
        body: JSON.stringify({
          depositAddress: input.depositAddress,
          txHash: input.txHash,
        }),
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`deposit submit ${res.status}`);
      }
    } catch {
      // Retryable: a missed nudge only slows detection, never the outcome.
      throw new Error("The deposit registration failed and will be retried");
    }
    return;
  }
  await sb
    .from("transactions")
    .update({ deposit_address: input.depositAddress })
    .eq("id", input.transactionId);
}

/**
 * One poll of the authoritative source plus its write-through.
 *
 * The transaction state and a timeline event land on every check, so
 * closing the laptop loses nothing: reopening reads the record. A seen
 * deposit is confirming, not settled — only SUCCESS settles. A poll blip
 * throws a normal error and retries; terminal failure is the caller's.
 *
 * Read-before-write: identical consecutive polls issue zero writes, so the
 * 6s/15s beat does not churn `updated_at` (via `touch_updated_at`) or spam
 * the events timeline. Replays are safe: the guard re-reads the DB value
 * inside the step, so a retried step execution never double-inserts.
 */
async function checkStatusStep(input: {
  transactionId: string;
  depositAddress: string;
}): Promise<StatusSnapshot> {
  "use step";

  const res = await fetch(
    `${BASE}/v0/status?depositAddress=${encodeURIComponent(input.depositAddress)}`,
    { headers: oneClickHeaders() },
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
    KNOWN_DEPOSIT_TX: "confirming",
    PROCESSING: "processing",
  };

  const snapshot: StatusSnapshot = {
    state: TERMINAL[body.status] ?? "pending",
    amountOut: details.amountOutFormatted,
    explorerUrls: [
      ...(details.originChainTxHashes ?? []),
      ...(details.destinationChainTxHashes ?? []),
    ]
      .map((h) => h.explorerUrl)
      .filter((u): u is string => !!u),
  };

  const { getSupabaseAdmin } = await import("@/lib/db/client");
  const sb = getSupabaseAdmin();

  // Read-before-write guard: skip both writes when nothing material changed.
  const { data: current } = await sb
    .from("transactions")
    .select("state")
    .eq("id", input.transactionId)
    .single();
  const currentState = (current as { state?: string } | null)?.state;
  let explorerChanged = false;
  if (currentState === snapshot.state && snapshot.explorerUrls.length > 0) {
    const { data: lastEvent } = await sb
      .from("transaction_events")
      .select("meta")
      .eq("transaction_id", input.transactionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const prevUrls = (lastEvent as { meta?: { explorerUrls?: unknown } } | null)
      ?.meta?.explorerUrls;
    explorerChanged = !sameUrlSet(
      Array.isArray(prevUrls) ? (prevUrls as unknown[]) : [],
      snapshot.explorerUrls,
    );
  }
  if (currentState !== snapshot.state || explorerChanged) {
    await sb
      .from("transactions")
      .update({ state: snapshot.state })
      .eq("id", input.transactionId);
    await sb.from("transaction_events").insert({
      transaction_id: input.transactionId,
      state: snapshot.state,
      meta: { explorerUrls: snapshot.explorerUrls },
    });
  }

  return snapshot;
}

/**
 * Order-insensitive URL-set comparison. Length or membership change counts
 * as material; reorder alone does not trigger a write.
 */
function sameUrlSet(a: unknown[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a.filter((u): u is string => typeof u === "string"));
  if (set.size !== b.length) return false;
  return b.every((u) => set.has(u));
}

/**
 * Terminal writes: state plus outcome for the card, the history page, and
 * the read tools. Intermediate beats go through checkStatusStep instead.
 */
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
