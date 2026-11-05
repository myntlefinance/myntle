/**
 * The three non-visual approval journeys for the Intents routes.
 *
 * A money card decides nothing here: each function runs the exact server
 * sequence the route owns, in order, and reports what the server said. The
 * settlement is still read from `/api/tx/[id]` by whichever card called it.
 *
 * - `createIntentsDeposit` asks for the one-time external address.
 * - `approveIntentsTrade` prepares, signs, and submits a confidential swap.
 * - `approveIntentsWithdrawal` does the same for a stored withdrawal quote.
 *
 * Nothing in this module renders, and nothing here holds a figure the server
 * did not return.
 */

import { PasskeyError } from "@/lib/auth/passkey-client";
import type { DepositMetadata } from "./deposit-metadata";
import type { IntentStandard } from "./service";

/* ------------------------------------------------------------------ */
/* shared                                                             */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return asRecord(await res.json()) ?? {};
  } catch {
    return {};
  }
}

/** Raw smallest-unit digits to whole units for display; never rounded up. */
export function formatRawAmount(raw: string, decimals: number): string {
  if (decimals <= 0 || !/^\d+$/.test(raw)) return raw;
  const digits = raw.replace(/^0+(?=\d)/, "");
  const padded = digits.padStart(decimals + 1, "0");
  const head = padded.slice(0, -decimals);
  const tail = padded.slice(-decimals).replace(/0+$/, "").slice(0, 6);
  return tail ? `${head}.${tail}` : head;
}

/* ------------------------------------------------------------------ */
/* the deposit request                                                */
/* ------------------------------------------------------------------ */

export type IntentsDepositResult =
  | {
      ok: true;
      transactionId: string;
      depositAddress: string;
      depositMemo: string | null;
      amountIn: string;
      expiresAt: string;
      /** Everything the card needs to redraw the address after a reload. */
      deposit: DepositMetadata;
      runId: string;
    }
  | {
      ok: false;
      reason: "approval" | "rejected" | "sign-in" | "unavailable";
      message: string;
    };

export type IntentsDepositInput = {
  assetId: string;
  amount: string;
  conversationId?: string | null;
  approvalId?: string;
  /** Test seam. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

const MISSING_APPROVAL = "The deposit cannot be confirmed. Ask for a new one.";

/**
 * Asks the server to mint the one-time address for this deposit.
 *
 * The body names the asset, the amount and the tool approval; it never names
 * a recipient, a refund address, or a chain. A success means the address
 * exists and the settlement reader has started — not that any funds arrived.
 *
 * The route pins the recipient to the session's Intents account, so the same
 * request serves a passkey account and a wallet account alike.
 */
export async function createIntentsDeposit(
  input: IntentsDepositInput,
): Promise<IntentsDepositResult> {
  if (!input.approvalId) {
    return { ok: false, reason: "approval", message: MISSING_APPROVAL };
  }

  const request = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await request("/api/intents/deposit", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetId: input.assetId,
        amount: input.amount,
        conversationId: input.conversationId ?? null,
        approvalId: input.approvalId,
      }),
    });
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "The deposit could not be prepared. Please try again.",
    };
  }

  if (!res.ok) {
    if (res.status === 401) {
      return { ok: false, reason: "sign-in", message: "Sign in to deposit." };
    }
    if (res.status === 400) {
      return {
        ok: false,
        reason: "rejected",
        message: "The deposit could not be prepared. Nothing was moved.",
      };
    }
    return {
      ok: false,
      reason: "unavailable",
      message: "The deposit could not be prepared. Please try again.",
    };
  }

  const body = await readJson(res);
  const transactionId =
    typeof body.transactionId === "string" ? body.transactionId : "";
  const depositAddress =
    typeof body.depositAddress === "string" ? body.depositAddress : "";
  if (!transactionId || !depositAddress) {
    return {
      ok: false,
      reason: "unavailable",
      message: "The deposit could not be prepared. Please try again.",
    };
  }

  const text = (value: unknown) =>
    typeof value === "string" && value.length > 0 ? value : null;
  const integer = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) ? value : null;
  const expiresAt = text(body.expiresAt) ?? "";
  const amountIn =
    typeof body.amountIn === "string" ? body.amountIn : input.amount;

  return {
    ok: true,
    transactionId,
    depositAddress,
    depositMemo:
      typeof body.depositMemo === "string" ? body.depositMemo : null,
    amountIn,
    expiresAt,
    deposit: {
      address: depositAddress,
      memo: text(body.depositMemo),
      expiresAt: expiresAt || null,
      amountInRaw: text(body.amountInRaw) ?? amountIn,
      tokenContract: text(body.tokenContract),
      chainId: integer(body.chainId),
      chainName: text(body.chainName),
      chainSlug: text(body.chainSlug),
      decimals: integer(body.decimals),
      symbol: text(body.symbol),
    },
    runId: typeof body.runId === "string" ? body.runId : "",
  };
}

/* ------------------------------------------------------------------ */
/* the swap sequence                                                  */
/* ------------------------------------------------------------------ */

export type IntentsApprovalResult =
  | {
      ok: true;
      transactionId: string;
      depositAddress: string;
      intentHash?: string;
    }
  | {
      ok: false;
      reason:
        | "quote"
        | "expired"
        | "signature"
        | "submit"
        | "conflict"
        | "unavailable";
      message: string;
    };

export type IntentsApprovalInput = {
  quoteId: string;
  conversationId?: string | null;
  approvalId?: string;
  /**
   * The session's signer, narrowed to the swap payload: the server issues a
   * WebAuthn string, and only a passkey session can answer it.
   */
  sign: (payload: string) => Promise<Record<string, unknown>>;
  /** Reports which half of the sequence is running, for the footer. */
  onPhase?: (phase: "signing" | "submitting") => void;
  /** Called after the server accepted the signed intent. */
  onSubmitted?: (tx: { transactionId: string; depositAddress: string }) => void;
  /** Test seam. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

const EXPIRED = "The quote expired. Ask for a new one.";
const SIGNATURE_REJECTED =
  "Nothing was moved. The signature was not accepted.";

/**
 * Runs the exact sequence the plan defines, in order:
 *
 * 1. `POST /api/intents/approve` asks the server to mint the wet quote and the
 *    payload from the stored dry quote. The body names the quote, the action,
 *    and the mode, and nothing else.
 * 2. The returned `intent.payload` is signed byte for byte.
 * 3. `POST /api/intents/submit` sends the assertion for server-side
 *    verification. A `201` is not acceptance; the outcome is read later from
 *    `/api/tx/[id]`.
 *
 * A failure at any step leaves the card retryable and moves nothing: the
 * transaction stays `awaiting_approval` until the server verifies it.
 */
export async function approveIntentsTrade(
  input: IntentsApprovalInput,
): Promise<IntentsApprovalResult> {
  const request = input.fetchImpl ?? fetch;

  let preparedRes: Response;
  try {
    preparedRes = await request("/api/intents/approve", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteId: input.quoteId,
        conversationId: input.conversationId ?? null,
        approvalId: input.approvalId ?? null,
        action: "swap",
        mode: "confidential-intents",
      }),
    });
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "The trade could not be prepared. Nothing was moved.",
    };
  }

  if (!preparedRes.ok) {
    const body = await readJson(preparedRes);
    if (preparedRes.status === 409 && body.error === "expired") {
      return { ok: false, reason: "expired", message: EXPIRED };
    }
    if (preparedRes.status === 400 && body.error === "stale") {
      return {
        ok: false,
        reason: "quote",
        message: "The quote is no longer available. Ask for a fresh one.",
      };
    }
    return {
      ok: false,
      reason: "unavailable",
      message: "The trade could not be prepared. Nothing was moved.",
    };
  }

  const prepared = await readJson(preparedRes);
  const transactionId =
    typeof prepared.transactionId === "string" ? prepared.transactionId : "";
  const depositAddress =
    typeof prepared.depositAddress === "string" ? prepared.depositAddress : "";
  const intent = asRecord(prepared.intent);
  const payload = typeof intent?.payload === "string" ? intent.payload : "";
  if (!transactionId || !depositAddress || !payload) {
    return {
      ok: false,
      reason: "unavailable",
      message: "The trade could not be prepared. Nothing was moved.",
    };
  }
  // The server picks the standard from the session; a passkey session can
  // only ever receive a WebAuthn payload.
  if (intent?.standard !== "webauthn") {
    return {
      ok: false,
      reason: "unavailable",
      message: "This account cannot sign that intent.",
    };
  }

  input.onPhase?.("signing");
  let signed: Record<string, unknown>;
  try {
    signed = await input.sign(payload);
  } catch (cause) {
    return {
      ok: false,
      reason: "signature",
      message:
        cause instanceof PasskeyError
          ? cause.message
          : "The passkey did not sign this trade. Nothing was moved.",
    };
  }

  // The bytes that leave the browser are the bytes the server stored. The
  // signer never re-stringifies, and neither does this check.
  if (signed.payload !== payload) {
    return {
      ok: false,
      reason: "signature",
      message: SIGNATURE_REJECTED,
    };
  }

  input.onPhase?.("submitting");
  let submittedRes: Response;
  try {
    submittedRes = await request("/api/intents/submit", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId, signedData: signed }),
    });
  } catch {
    return {
      ok: false,
      reason: "submit",
      message: "The trade could not be submitted. Please try again.",
    };
  }

  if (!submittedRes.ok) {
    const body = await readJson(submittedRes);
    if (submittedRes.status === 401) {
      return { ok: false, reason: "signature", message: SIGNATURE_REJECTED };
    }
    if (submittedRes.status === 409) {
      return {
        ok: false,
        reason: "conflict",
        message:
          typeof body.message === "string" && body.message.length > 0
            ? body.message
            : "This trade has already been submitted.",
      };
    }
    return {
      ok: false,
      reason: "submit",
      message: "The trade could not be submitted. Please try again.",
    };
  }

  const submitted = await readJson(submittedRes);
  const record = { transactionId, depositAddress };
  input.onSubmitted?.(record);
  return {
    ok: true,
    transactionId,
    depositAddress,
    intentHash:
      typeof submitted.intentHash === "string"
        ? submitted.intentHash
        : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* the withdrawal sequence                                            */
/* ------------------------------------------------------------------ */

export type IntentsWithdrawalFigures = {
  amountIn?: string;
  amountOut?: string;
  minAmountOut?: string;
  fee?: string;
  expiresAt?: string;
};

export type IntentsWithdrawalResult =
  | {
      ok: true;
      transactionId: string;
      depositAddress: string;
      /** The server-rebuilt destination from the stored quote. */
      destination: string;
      figures: IntentsWithdrawalFigures;
      intentHash?: string;
    }
  | {
      ok: false;
      reason:
        | "quote"
        | "expired"
        | "signature"
        | "submit"
        | "conflict"
        | "unavailable";
      message: string;
    };

export type IntentsWithdrawalInput = {
  quoteId: string;
  conversationId?: string | null;
  approvalId?: string;
  sign: (intent: {
    standard: IntentStandard;
    payload: string | Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  onPhase?: (phase: "signing" | "submitting") => void;
  onSubmitted?: (tx: { transactionId: string; destination: string }) => void;
  /** Test seam. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

const SIGNED_STANDARDS: readonly IntentStandard[] = [
  "webauthn",
  "erc191",
  "raw_ed25519",
  "nep413",
];

function isIntentStandard(value: unknown): value is IntentStandard {
  return (
    typeof value === "string" &&
    (SIGNED_STANDARDS as readonly string[]).includes(value)
  );
}

/** Exact comparison of the stored NEP-413 envelope and the signed one. */
function samePayload(
  stored: string | Record<string, unknown>,
  submitted: unknown,
): boolean {
  if (typeof stored === "string") return submitted === stored;
  const signed = asRecord(submitted);
  if (!signed) return false;
  return (
    signed.message === stored.message &&
    signed.recipient === stored.recipient &&
    signed.nonce === stored.nonce
  );
}

function readFigures(
  prepared: Record<string, unknown>,
): IntentsWithdrawalFigures {
  const figures = asRecord(prepared.figures) ?? {};
  const text = (value: unknown) =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  return {
    amountIn: text(figures.amountInFormatted),
    amountOut: text(figures.amountOutFormatted),
    minAmountOut: text(figures.minAmountOut),
    fee: text(figures.withdrawFeeFormatted),
    expiresAt: text(prepared.expiresAt),
  };
}

/**
 * Runs the withdrawal approval in order:
 *
 * 1. `POST /api/intents/approve` asks the server to rebuild the wet quote and
 *    the signed payload from the stored withdrawal quote. The body names only
 *    the quote, the action, and the mode.
 * 2. The returned payload is signed with the session's signer.
 * 3. `POST /api/intents/submit` sends the assertion for server-side
 *    verification. A success here is a submission, not a settlement.
 *
 * The destination returned by step 1 is the server's own value. It is the
 * only address a card ever shows, and the payload never contains it.
 */
export async function approveIntentsWithdrawal(
  input: IntentsWithdrawalInput,
): Promise<IntentsWithdrawalResult> {
  const request = input.fetchImpl ?? fetch;

  let preparedRes: Response;
  try {
    preparedRes = await request("/api/intents/approve", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteId: input.quoteId,
        conversationId: input.conversationId ?? null,
        approvalId: input.approvalId ?? null,
        action: "withdraw",
        mode: "confidential-withdrawal",
      }),
    });
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "The withdrawal could not be prepared. Nothing was moved.",
    };
  }

  if (!preparedRes.ok) {
    const body = await readJson(preparedRes);
    if (preparedRes.status === 409 && body.error === "expired") {
      return { ok: false, reason: "expired", message: EXPIRED };
    }
    if (preparedRes.status === 400 && body.error === "stale") {
      return {
        ok: false,
        reason: "quote",
        message: "The quote is no longer available. Ask for a fresh one.",
      };
    }
    return {
      ok: false,
      reason: "unavailable",
      message: "The withdrawal could not be prepared. Nothing was moved.",
    };
  }

  const prepared = await readJson(preparedRes);
  const transactionId =
    typeof prepared.transactionId === "string" ? prepared.transactionId : "";
  const depositAddress =
    typeof prepared.depositAddress === "string" ? prepared.depositAddress : "";
  const destination =
    typeof prepared.destination === "string" ? prepared.destination : "";
  const intent = asRecord(prepared.intent);
  const standard = intent?.standard;
  const rawPayload = intent?.payload;
  const payload: string | Record<string, unknown> | null =
    typeof rawPayload === "string" ? rawPayload : asRecord(rawPayload);
  if (
    !transactionId ||
    !depositAddress ||
    !destination ||
    !isIntentStandard(standard) ||
    payload === null
  ) {
    return {
      ok: false,
      reason: "unavailable",
      message: "The withdrawal could not be prepared. Nothing was moved.",
    };
  }

  input.onPhase?.("signing");
  let signed: Record<string, unknown>;
  try {
    signed = await input.sign({ standard, payload });
  } catch (cause) {
    return {
      ok: false,
      reason: "signature",
      message:
        cause instanceof PasskeyError
          ? cause.message
          : "The signature was not completed. Nothing was moved.",
    };
  }

  // The bytes that leave the browser are the bytes the server stored. The
  // signer never re-stringifies, and neither does this check.
  if (!samePayload(payload, signed.payload)) {
    return {
      ok: false,
      reason: "signature",
      message: SIGNATURE_REJECTED,
    };
  }

  input.onPhase?.("submitting");
  let submittedRes: Response;
  try {
    submittedRes = await request("/api/intents/submit", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId, signedData: signed }),
    });
  } catch {
    return {
      ok: false,
      reason: "submit",
      message: "The withdrawal could not be submitted. Please try again.",
    };
  }

  if (!submittedRes.ok) {
    const body = await readJson(submittedRes);
    if (submittedRes.status === 401) {
      return { ok: false, reason: "signature", message: SIGNATURE_REJECTED };
    }
    if (submittedRes.status === 409) {
      return {
        ok: false,
        reason: "conflict",
        message:
          typeof body.message === "string" && body.message.length > 0
            ? body.message
            : "This withdrawal has already been submitted.",
      };
    }
    return {
      ok: false,
      reason: "submit",
      message: "The withdrawal could not be submitted. Please try again.",
    };
  }

  const submitted = await readJson(submittedRes);
  input.onSubmitted?.({ transactionId, destination });
  return {
    ok: true,
    transactionId,
    depositAddress,
    destination,
    figures: readFigures(prepared),
    intentHash:
      typeof submitted.intentHash === "string"
        ? submitted.intentHash
        : undefined,
  };
}
