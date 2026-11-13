import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { swapLifecycle } from "@/workflows/swap-lifecycle";
import { limitOrderLifecycle } from "@/workflows/limit-order-lifecycle";
import { requireSession, type Session } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import { getWebAuthnConfig } from "@/lib/auth/webauthn-config";
import {
  decodeP256PublicKeyBase64,
  encodeP256PublicKey,
} from "@/lib/auth/passkeys";
import { getSupabaseAdmin } from "@/lib/db/client";
import {
  addEvent,
  getTransaction,
  setTransactionRunId,
  setTransactionState,
  updateTransactionRefs,
} from "@/lib/db/transactions";
import {
  TOOL_APPROVAL_NAMES,
  recordToolApproval,
  type ToolApprovalName,
} from "@/lib/db/tool-approvals";
import { submitIntent } from "@/lib/intents/service";
import { normalizeEvmAddress } from "@/lib/intents/destination";
import {
  intentHashForPayload,
  verifyIntent,
} from "@/lib/intents/verify-intent";
import {
  decideSubmit,
  isSameSubmittedIntent,
  mapVerificationFailure,
  readIntentRefs,
  readWorkflowRef,
  submitBodySchema,
  GENERIC_VERIFICATION_ERROR,
  type SubmitBody,
} from "@/lib/intents/route-policy";

type PasskeyKeyResult =
  | { ok: true; publicKey: string }
  | {
      ok: false;
      reason:
        | "passkey-missing"
        | "passkey-mismatch"
        | "passkey-key-invalid";
    };

/**
 * Reads the passkey that signed the session and converts the stored base64 key
 * to the wire form the verifier expects.
 *
 * The database stores the 64-byte `x || y` as base64; 1Click and the server
 * verifier use `p256:<base58>`. The conversion belongs at this boundary, and
 * a mismatch between the session account and the row is refused.
 */
async function loadPasskeyPublicKey(
  session: Pick<Session, "passkeyId" | "userId" | "intentsAccountId">,
): Promise<PasskeyKeyResult> {
  if (!session.passkeyId) return { ok: false, reason: "passkey-missing" };

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("passkey_accounts")
    .select("p256_public_key, account_id")
    .eq("id", session.passkeyId)
    .eq("user_id", session.userId)
    .is("revoked_at", null)
    .single();

  if (error || !data) return { ok: false, reason: "passkey-missing" };

  const row = data as {
    p256_public_key?: unknown;
    account_id?: unknown;
  };
  if (
    typeof row.p256_public_key !== "string" ||
    row.account_id !== session.intentsAccountId
  ) {
    return { ok: false, reason: "passkey-mismatch" };
  }

  try {
    return {
      ok: true,
      publicKey: encodeP256PublicKey(
        decodeP256PublicKeyBase64(row.p256_public_key),
      ),
    };
  } catch {
    return { ok: false, reason: "passkey-key-invalid" };
  }
}

/**
 * Records the card's decision once the signed intent is actually submitted.
 *
 * The approve route deliberately does not write this row: a cancelled passkey
 * prompt or a failed submit must leave the card retryable. The refs carry the
 * card id and the tool name, so this write is the first moment the decision
 * is true.
 */
async function recordSignedDecision(input: {
  userId: string;
  refs: {
    toolApprovalId: string | null;
    toolName: string | null;
    conversationId: string | null;
    dryQuoteId: string | null;
    mode: string;
  };
  orderId: string | null;
}): Promise<void> {
  const cardId = input.refs.toolApprovalId;
  if (!cardId) return;
  const storedName = input.refs.toolName;
  const fallback: ToolApprovalName = input.orderId
    ? "prepare_limit_order"
    : input.refs.mode === "confidential-withdrawal"
      ? "prepare_withdrawal"
      : "prepare_swap";
  const toolName =
    storedName &&
    (TOOL_APPROVAL_NAMES as readonly string[]).includes(storedName)
      ? (storedName as ToolApprovalName)
      : fallback;
  try {
    await recordToolApproval({
      userId: input.userId,
      toolApprovalId: cardId,
      toolName,
      decision: "approved",
      conversationId: input.refs.conversationId,
      quoteId: input.refs.dryQuoteId,
    });
  } catch {
    // The intent is already submitted; a lost decision row costs the card's
    // paint, never the money. The transaction is the stronger record.
    console.error("[intents/submit] decision record failed");
  }
}

async function startSettlement(input: {
  transactionId: string;
  depositAddress: string;
  expectedOut?: string;
  mode?: string | null;
  /** Present only for a limit-order record; selects its own workflow. */
  orderId?: string | null;
}): Promise<string> {
  // A limit order is polled through `GET /v0/orders/{id}`, not the deposit
  // status endpoint, so it starts its own lifecycle. Everything else keeps
  // the swap run's exact input object.
  if (input.orderId) {
    const orderRun = await start(limitOrderLifecycle, [
      { transactionId: input.transactionId, orderId: input.orderId },
    ]);
    await setTransactionRunId(input.transactionId, orderRun.runId);
    return orderRun.runId;
  }

  const run = await start(swapLifecycle, [
    {
      transactionId: input.transactionId,
      depositAddress: input.depositAddress,
      expectedOut: input.expectedOut,
      mode: input.mode,
    },
  ]);
  await setTransactionRunId(input.transactionId, run.runId);
  return run.runId;
}

/**
 * Accepts a signature over the exact intent the approve route stored.
 *
 * The request body carries only a transaction id and the `signedData` object.
 * Every expected value (`signerId`, `standard`, `depositAddress`, `amountIn`,
 * `assetId`, `deadline`) comes from the transaction's stored refs, and the
 * assertion is verified server-side before 1Click is called. A `201` from
 * `submit-intent` is not acceptance (P0.4); the workflow reads the outcome
 * from `GET /v0/status?depositAddress=…`.
 *
 * Idempotency is keyed by the content-addressed `intentHash`: a repeated
 * submit of the same intent returns the existing result, and a different
 * intent after `submitted` is rejected. The workflow starts only after the
 * server has verified the assertion and 1Click has returned a hash.
 */
export async function POST(req: Request) {
  const { limited } = checkRateLimit(
    `intents-submit:${clientIp(req)}`,
    20,
    60_000,
  );
  if (limited) {
    return NextResponse.json({ error: "An error occurred." }, { status: 429 });
  }

  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: SubmitBody;
  try {
    body = submitBodySchema.parse(await req.json());
  } catch {
    console.error("[intents/submit] invalid body");
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }

  const found = await getTransaction(session.userId, body.transactionId);
  if (!found) {
    console.error("[intents/submit] unknown transaction", {
      transactionId: body.transactionId,
    });
    return NextResponse.json({ error: "An error occurred." }, { status: 404 });
  }
  const { tx } = found;

  const stored = readIntentRefs(tx.refs);
  if (!stored.ok) {
    console.error("[intents/submit] refs rejected", {
      transactionId: tx.id,
      reason: stored.reason,
    });
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }
  const refs = stored.refs;

  // The record names which lifecycle owns it. A limit-order row carries its
  // 1Click order id; a row from before this feature has no kind and keeps the
  // swap workflow. A limit-order row with no id is refused rather than polled
  // against an endpoint that cannot see it.
  const workflowRef = readWorkflowRef(tx.refs);
  if (workflowRef.kind === "malformed") {
    console.error("[intents/submit] limit order refs malformed", {
      transactionId: tx.id,
      reason: "order-id-missing",
    });
    return NextResponse.json({ error: "An error occurred." }, { status: 400 });
  }
  const limitOrderId =
    workflowRef.kind === "limit_order" ? workflowRef.orderId : null;

  // The refs were written from the session that approved the transaction. If
  // they name another account, the session is stale or the row is not ours
  // even though the user id matched.
  if (refs.signerId !== session.intentsAccountId) {
    console.error("[intents/submit] signer mismatch", {
      transactionId: tx.id,
      reason: "signer-session-mismatch",
    });
    return NextResponse.json(
      { error: GENERIC_VERIFICATION_ERROR },
      { status: 401 },
    );
  }

  // The signed payload contains no external destination. For a withdrawal
  // the destination lives in the quote, was recorded in refs by the approve
  // route, and is also on the transaction row. Both must still agree before
  // the signed intent is enqueued; a mismatch means the record was rewritten
  // and the money must not move.
  if (refs.mode === "confidential-withdrawal") {
    const bound = normalizeEvmAddress(tx.recipient);
    if (!bound || bound !== refs.destination) {
      console.error("[intents/submit] withdrawal destination mismatch", {
        transactionId: tx.id,
        reason: "destination-mismatch",
      });
      return NextResponse.json(
        { error: GENERIC_VERIFICATION_ERROR },
        { status: 400 },
      );
    }
  }

  const storedIntentHash = refs.intentHash;
  const sameIntent = isSameSubmittedIntent({
    signedData: body.signedData,
    storedPayload: refs.intentPayload,
    storedIntentHash,
  });
  const decision = decideSubmit({
    state: tx.state,
    storedIntentHash,
    sameIntent,
  });

  if (decision.kind === "idempotent" && storedIntentHash) {
    // A crash between the submit and the decision write leaves the card
    // undecided. Repair it here; the first decision still wins.
    await recordSignedDecision({
      userId: session.userId,
      refs,
      orderId: limitOrderId,
    });
    // A crash between the submit and the workflow start leaves the row
    // submitted with no run id. Starting it here makes a retry complete the
    // record instead of silently returning an unpolled trade.
    let runId = tx.workflow_run_id;
    if (!runId) {
      try {
        runId = await startSettlement({
          transactionId: tx.id,
          depositAddress: tx.deposit_address ?? refs.intentDepositAddress,
          expectedOut: tx.expected_out ?? undefined,
          mode: refs.mode,
          orderId: limitOrderId,
        });
      } catch {
        console.error("[intents/submit] workflow restart failed", {
          transactionId: tx.id,
        });
        return NextResponse.json(
          { error: "An error occurred." },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      transactionId: tx.id,
      intentHash: storedIntentHash,
      runId,
    });
  }

  if (decision.kind === "conflict") {
    console.error("[intents/submit] submit conflict", {
      transactionId: tx.id,
      reason: decision.reason,
    });
    return NextResponse.json(
      {
        error: "conflict",
        message:
          decision.reason === "intent-changed"
            ? "This transaction has already been submitted."
            : "This transaction cannot be submitted.",
      },
      { status: 409 },
    );
  }

  // The WebAuthn config is read only for a passkey session. A wallet session
  // never reaches the WebAuthn branch of the verifier, so a passkey-disabled
  // deployment does not need the relying-party variables for a wallet submit.
  let webauthn: { rpID: string; origins: string[] } = {
    rpID: "",
    origins: [],
  };
  let passkeyPublicKey: string | undefined;

  if (session.accountKind === "passkey") {
    try {
      const config = getWebAuthnConfig();
      webauthn = { rpID: config.rpID, origins: config.origin };
    } catch {
      console.error("[intents/submit] webauthn config unavailable", {
        transactionId: tx.id,
        reason: "webauthn-config",
      });
      return NextResponse.json(
        { error: GENERIC_VERIFICATION_ERROR },
        { status: 500 },
      );
    }

    const key = await loadPasskeyPublicKey(session);
    if (!key.ok) {
      console.error("[intents/submit] passkey unavailable", {
        transactionId: tx.id,
        reason: key.reason,
      });
      return NextResponse.json(
        { error: GENERIC_VERIFICATION_ERROR },
        { status: 401 },
      );
    }
    passkeyPublicKey = key.publicKey;
  }

  const verification = await verifyIntent({
    signedData: body.signedData,
    payload: refs.intentPayload,
    signerId: refs.signerId,
    standard: refs.standard,
    mode: "confidential",
    depositAddress: refs.intentDepositAddress,
    amountIn: refs.amountInRaw,
    assetId: refs.assetId,
    deadline: refs.deadline,
    accountKind: session.accountKind,
    chain: session.chain,
    address: session.accountKind === "wallet" ? session.address : undefined,
    passkeyPublicKey,
    webauthn,
  });

  if (!verification.ok) {
    const failure = mapVerificationFailure(verification.reason);
    console.error("[intents/submit] verification failed", {
      transactionId: tx.id,
      reason: failure.logReason,
    });
    return NextResponse.json(failure.body, { status: failure.status });
  }

  let submitted: Awaited<ReturnType<typeof submitIntent>>;
  try {
    submitted = await submitIntent({
      type: "swap_transfer",
      signedData: body.signedData,
    });
  } catch {
    // Nothing was accepted, so the row stays `awaiting_approval` and the
    // stored payload is still the one that will be signed on retry. Never
    // regenerate the payload here: `generate-intent` mints a new nonce.
    console.error("[intents/submit] submit-intent failed", {
      transactionId: tx.id,
      reason: "submit-intent",
    });
    return NextResponse.json(
      {
        error: "The transaction could not be submitted. Please try again.",
      },
      { status: 502 },
    );
  }

  if (session.accountKind === "passkey") {
    // P0.4: `intentHash = base58(sha256(payload))`. It is content-addressed
    // and computable offline, so a mismatch means the bytes 1Click accepted
    // are not the bytes the server stored. The submit has already happened,
    // so the trade is marked for reconciliation rather than retried.
    if (typeof refs.intentPayload !== "string") {
      console.error("[intents/submit] intent payload not a string", {
        transactionId: tx.id,
        reason: "payload-malformed",
      });
      return NextResponse.json(
        { error: GENERIC_VERIFICATION_ERROR },
        { status: 500 },
      );
    }

    const expectedIntentHash = intentHashForPayload(refs.intentPayload);
    if (submitted.intentHash !== expectedIntentHash) {
      console.error("[intents/submit] intent hash mismatch", {
        transactionId: tx.id,
        reason: "intent-hash-mismatch",
      });
      try {
        await updateTransactionRefs(tx.id, {
          intentHash: submitted.intentHash,
          signedAt: new Date().toISOString(),
          standard: verification.standard,
        });
        await setTransactionState(tx.id, "needs_reconciliation");
        await addEvent(
          tx.id,
          "needs_reconciliation",
          "The submitted intent hash did not match the stored payload.",
        );
      } catch {
        // The mismatch is already logged; never start a workflow for it.
      }
      return NextResponse.json({ error: "An error occurred." }, { status: 502 });
    }
  }

  try {
    await updateTransactionRefs(tx.id, {
      intentHash: submitted.intentHash,
      signedAt: new Date().toISOString(),
      standard: verification.standard,
    });
    await setTransactionState(tx.id, "submitted");
    await addEvent(
      tx.id,
      "submitted",
      "The signed intent was submitted for settlement.",
    );
    await recordSignedDecision({
      userId: session.userId,
      refs,
      orderId: limitOrderId,
    });
  } catch {
    console.error("[intents/submit] record update failed", {
      transactionId: tx.id,
    });
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }

  let runId: string;
  try {
    runId = await startSettlement({
      transactionId: tx.id,
      depositAddress: tx.deposit_address ?? refs.intentDepositAddress,
      expectedOut: tx.expected_out ?? undefined,
      mode: refs.mode,
      orderId: limitOrderId,
    });
  } catch {
    // The row is `submitted` and keeps the hash. A repeated submit now takes
    // the idempotent branch above and starts the missing workflow.
    console.error("[intents/submit] workflow start failed", {
      transactionId: tx.id,
    });
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }

  return NextResponse.json({
    transactionId: tx.id,
    intentHash: submitted.intentHash,
    runId,
  });
}
