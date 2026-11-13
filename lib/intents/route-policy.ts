/**
 * Pure policy for the unified intent routes.
 *
 * `/api/intents/approve` and `/api/intents/submit` are thin: they check the
 * session, load the server-saved row, call the service, and return a response.
 * Everything that can be decided without a database or the network lives here,
 * so the security-relevant rules are unit-tested rather than inferred:
 *
 * - the request schemas (a `chain` mode is never accepted on this route),
 * - the signer a session maps to,
 * - the early guard that keeps a passkey session off the wallet route,
 * - the one generic body every assertion failure maps to,
 * - the idempotent-submit rule,
 * - the stored quote/refs readers that keep the browser body out of money
 *   decisions.
 *
 * Nothing here reads a secret, logs, or touches the network.
 */

import { z } from "zod";
import type { AuthChain } from "@/lib/auth/challenge";
import type { TxState } from "@/lib/db/transactions";
import { normalizeEvmAddress } from "./destination";
import {
  intentHashForPayload,
  type IntentVerificationReason,
} from "./verify-intent";
import type { IntentStandard } from "./service";

/* ------------------------------------------------------------------ */
/* request schemas                                                     */
/* ------------------------------------------------------------------ */

/**
 * The unified route never mints the old chain-to-chain quote. That route is
 * `app/api/approve/route.ts`, and it stays exactly as it is.
 *
 * `confidential-withdrawal` is a distinct mode rather than a second recipient
 * type on `confidential-intents`. The mode is the security discriminator: an
 * EVM wallet's Intents account is its own address, so the recipient alone
 * cannot distinguish a swap from a withdrawal.
 */
export const CONFIDENTIAL_QUOTE_MODES = [
  "confidential-intents",
  "confidential-external",
  "confidential-withdrawal",
] as const;

export type ConfidentialQuoteMode = (typeof CONFIDENTIAL_QUOTE_MODES)[number];

/**
 * The two modes that require a signature before settlement starts. An
 * external deposit has no signed intent, so it is the only mode that may
 * start the workflow straight from approval.
 */
export const SIGNED_QUOTE_MODES = [
  "confidential-intents",
  "confidential-withdrawal",
] as const;

export type SignedQuoteMode = (typeof SIGNED_QUOTE_MODES)[number];

export function isSignedQuoteMode(
  mode: string | null | undefined,
): mode is SignedQuoteMode {
  return (SIGNED_QUOTE_MODES as readonly string[]).includes(mode ?? "");
}

/**
 * Whether a stored quote belongs to the confidential account at all.
 *
 * The wallet direct route (`/api/approve`) can only settle a `chain` quote.
 * Re-pricing a stored confidential quote there would silently turn a
 * withdrawal or a private swap into a public chain trade, so the route
 * refuses it before any signature or chain work.
 */
export function isConfidentialStoredMode(mode: unknown): boolean {
  return (
    mode === "confidential-intents" ||
    mode === "confidential-external" ||
    mode === "confidential-withdrawal"
  );
}

export const approveBodySchema = z.strictObject({
  quoteId: z.string().uuid(),
  /** A chat slug or uuid; the route resolves and authorizes it. */
  conversationId: z.string().max(200).nullish(),
  /** Tool approval id (aitxt-…), so a reload can rejoin the transaction. */
  approvalId: z.string().max(200).nullish(),
  action: z.enum(["swap", "deposit", "withdraw"]),
  mode: z.enum(CONFIDENTIAL_QUOTE_MODES),
});

export type ApproveBody = z.infer<typeof approveBodySchema>;

/**
 * The action names what the user decided; the mode names the money path. A
 * withdrawal is the only action that pays an external chain address, and the
 * deposit action is the only one that funds the account from outside.
 */
export function actionMatchesMode(
  mode: ConfidentialQuoteMode,
  action: ApproveBody["action"],
): boolean {
  if (mode === "confidential-withdrawal") return action === "withdraw";
  if (mode === "confidential-external") return action === "deposit";
  return action !== "withdraw" && action !== "deposit";
}

/**
 * `signedData` is the one field the client owns. It is checked field by field
 * against the stored payload by `verifyIntent`, never trusted as a whole.
 */
const signedDataSchema = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value),
);

export const submitBodySchema = z.strictObject({
  transactionId: z.string().uuid(),
  signedData: signedDataSchema,
});

export type SubmitBody = z.infer<typeof submitBodySchema>;

/* ------------------------------------------------------------------ */
/* signer selection and the wallet-route guard                         */
/* ------------------------------------------------------------------ */

export type SessionSigner = {
  accountKind: "wallet" | "passkey";
  chain: AuthChain;
};

const WALLET_STANDARD_BY_CHAIN: Record<AuthChain, IntentStandard> = {
  evm: "erc191",
  solana: "raw_ed25519",
  near: "nep413",
};

/**
 * The standard is chosen from the session, never from the browser. A passkey
 * account signs with WebAuthn; a wallet account signs with the standard its
 * chain uses.
 */
export function standardForSession(session: SessionSigner): IntentStandard {
  if (session.accountKind === "passkey") return "webauthn";
  const standard = WALLET_STANDARD_BY_CHAIN[session.chain];
  if (!standard) throw new Error("The session chain is not recognised.");
  return standard;
}

export const PASSKEY_WALLET_ROUTE_ERROR =
  "This account signs with a passkey. Use the passkey route.";

/**
 * The wallet direct route signs a canonical approval message with an external
 * wallet. A passkey account has no wallet to sign it, so the route says so
 * before it reads a body, verifies a signature, or mints a quote.
 */
export function passkeyWalletRouteGuard(session: {
  accountKind: "wallet" | "passkey";
}): { error: string } | null {
  return session.accountKind === "passkey"
    ? { error: PASSKEY_WALLET_ROUTE_ERROR }
    : null;
}

/* ------------------------------------------------------------------ */
/* verification failure mapping                                        */
/* ------------------------------------------------------------------ */

export const GENERIC_VERIFICATION_ERROR = "An error occurred.";

export type VerificationFailure = {
  status: 401;
  body: { error: string };
  /** Server-side only. It is never serialised into the response. */
  logReason: IntentVerificationReason;
};

/**
 * Every assertion failure produces this exact body. The reason code exists
 * only for the server log, so a caller cannot use the route as an oracle for
 * which check failed.
 */
export function mapVerificationFailure(
  reason: IntentVerificationReason,
): VerificationFailure {
  return {
    status: 401,
    body: { error: GENERIC_VERIFICATION_ERROR },
    logReason: reason,
  };
}

/* ------------------------------------------------------------------ */
/* idempotent submit                                                   */
/* ------------------------------------------------------------------ */

export type SubmitDecision =
  | { kind: "proceed" }
  | { kind: "idempotent" }
  | {
      kind: "conflict";
      reason: "intent-changed" | "not-submittable";
    };

/**
 * Decides what a submit request may do, from the stored row only.
 *
 * A transaction is submittable only while it is `awaiting_approval`. Once the
 * server has recorded an `intentHash` and moved the row to `submitted`, a
 * repeated request for the same intent returns the existing result and a
 * different intent is rejected. `intentHash` is content-addressed over the
 * payload, so it is the right dedupe key and never an acceptance signal.
 */
export function decideSubmit(input: {
  state: TxState;
  storedIntentHash: string | null;
  sameIntent: boolean;
}): SubmitDecision {
  if (input.state === "awaiting_approval") return { kind: "proceed" };

  if (input.state === "submitted" && input.storedIntentHash) {
    return input.sameIntent
      ? { kind: "idempotent" }
      : { kind: "conflict", reason: "intent-changed" };
  }

  return { kind: "conflict", reason: "not-submittable" };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Whether a repeat submit carries the intent the server already accepted.
 *
 * String payloads are compared the way 1Click hashes them:
 * `base58(sha256(payload))` (P0.4c). A NEP-413 payload is an envelope object
 * (P0.3c), so it is compared on the same `message` / `recipient` / `nonce`
 * fields the verifier binds. The signature bytes are deliberately not part of
 * this check: a retry after a lost response may legitimately re-sign the same
 * payload, and the same payload is the same money movement.
 */
export function isSameSubmittedIntent(input: {
  signedData: unknown;
  storedPayload: unknown;
  storedIntentHash: string | null;
}): boolean {
  const data = asRecord(input.signedData);
  if (!data) return false;
  const payload = data.payload;

  if (typeof payload === "string") {
    return (
      !!input.storedIntentHash &&
      intentHashForPayload(payload) === input.storedIntentHash
    );
  }

  const submitted = asRecord(payload);
  const stored = asRecord(input.storedPayload);
  if (!submitted || !stored) return false;

  return (
    submitted.message === stored.message &&
    submitted.recipient === stored.recipient &&
    submitted.nonce === stored.nonce
  );
}

/* ------------------------------------------------------------------ */
/* stored quote                                                        */
/* ------------------------------------------------------------------ */

export type StoredQuoteParams = {
  fromAssetId: string;
  toAssetId: string;
  amount: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  confidentiality: "basic" | "advanced";
  /** Absent on a quote written before the mode was stored. */
  mode: ConfidentialQuoteMode | null;
};

export type StoredQuoteResult =
  | { ok: true; params: StoredQuoteParams }
  | {
      ok: false;
      reason: "quote-malformed" | "mode-mismatch" | "account-mismatch";
    };

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads the dry preview the server itself saved.
 *
 * The body only names the quote and the mode; every priced parameter comes
 * from this row. A quote that was priced for the wallet chain route, or for a
 * different account, is refused rather than re-purposed.
 *
 * The withdrawal mode is the only one where the recipient is an external
 * address. Its topology is re-derived here rather than trusted: the stored
 * mode must be the withdrawal mode, the refund must be the session's account,
 * the recipient type must be `DESTINATION_CHAIN`, and the address is
 * normalised to EIP-55 again. Same-asset is valid only for this mode.
 */
export function readStoredQuoteRequest(
  request: unknown,
  expected: {
    mode: ConfidentialQuoteMode;
    accountKind: "wallet" | "passkey";
    intentsAccountId: string;
  },
): StoredQuoteResult {
  const stored = asRecord(request);
  if (!stored) return { ok: false, reason: "quote-malformed" };

  const isWithdrawal = expected.mode === "confidential-withdrawal";
  const fromAssetId = readString(stored.fromAssetId);
  const toAssetId = readString(stored.toAssetId);
  const amount = readString(stored.amount);
  const recipient = readString(stored.recipient);
  const refundTo = readString(stored.refundTo) || recipient;

  if (
    !fromAssetId ||
    !toAssetId ||
    !amount ||
    !recipient ||
    (!isWithdrawal && fromAssetId === toAssetId)
  ) {
    return { ok: false, reason: "quote-malformed" };
  }

  const storedMode = stored.mode;
  if (isWithdrawal) {
    // A withdrawal quote must say it is one. A row that lost its mode, or
    // was priced for the private swap route, cannot prove its destination
    // topology and is refused.
    if (typeof storedMode !== "string" || storedMode !== expected.mode) {
      return { ok: false, reason: "mode-mismatch" };
    }
  } else if (storedMode !== undefined && storedMode !== null) {
    if (typeof storedMode !== "string" || storedMode !== expected.mode) {
      return { ok: false, reason: "mode-mismatch" };
    }
  }

  const storedAccountKind = stored.accountKind;
  if (storedAccountKind !== undefined && storedAccountKind !== null) {
    if (storedAccountKind !== "wallet" && storedAccountKind !== "passkey") {
      return { ok: false, reason: "quote-malformed" };
    }
    if (storedAccountKind !== expected.accountKind) {
      return { ok: false, reason: "account-mismatch" };
    }
  }

  const storedIntentsAccountId = readString(stored.intentsAccountId);
  if (
    storedIntentsAccountId &&
    storedIntentsAccountId !== expected.intentsAccountId
  ) {
    return { ok: false, reason: "account-mismatch" };
  }

  let destination: string | null = null;
  if (isWithdrawal) {
    // The type is a server decision, never a client one. A row that names a
    // different recipient type would park the funds at an Intents account
    // instead of paying the chain address.
    const storedRecipientType = stored.recipientType;
    if (
      storedRecipientType !== undefined &&
      storedRecipientType !== null &&
      storedRecipientType !== "DESTINATION_CHAIN"
    ) {
      return { ok: false, reason: "quote-malformed" };
    }
    const storedRefundType = stored.refundType;
    if (
      storedRefundType !== undefined &&
      storedRefundType !== null &&
      storedRefundType !== "CONFIDENTIAL_INTENTS"
    ) {
      return { ok: false, reason: "quote-malformed" };
    }
    if (!expected.intentsAccountId || refundTo !== expected.intentsAccountId) {
      return { ok: false, reason: "account-mismatch" };
    }

    destination = normalizeEvmAddress(recipient);
    if (!destination) return { ok: false, reason: "quote-malformed" };

    const storedDestination = readString(stored.destination);
    if (storedDestination) {
      const normalizedStored = normalizeEvmAddress(storedDestination);
      if (!normalizedStored || normalizedStored !== destination) {
        return { ok: false, reason: "quote-malformed" };
      }
    }
  } else {
    // Every other confidential mode pays and refunds the account itself.
    if (recipient !== expected.intentsAccountId) {
      return { ok: false, reason: "account-mismatch" };
    }
    if (refundTo !== expected.intentsAccountId) {
      return { ok: false, reason: "account-mismatch" };
    }
    if (
      stored.recipientType !== undefined &&
      stored.recipientType !== null &&
      stored.recipientType !== "CONFIDENTIAL_INTENTS"
    ) {
      return { ok: false, reason: "quote-malformed" };
    }
    if (
      stored.refundType !== undefined &&
      stored.refundType !== null &&
      stored.refundType !== "CONFIDENTIAL_INTENTS"
    ) {
      return { ok: false, reason: "quote-malformed" };
    }
  }

  const rawSlippage = stored.slippageBps;
  const slippageBps =
    typeof rawSlippage === "number" &&
    Number.isInteger(rawSlippage) &&
    rawSlippage >= 1 &&
    rawSlippage <= 300
      ? rawSlippage
      : 100;

  return {
    ok: true,
    params: {
      fromAssetId,
      toAssetId,
      amount,
      recipient: destination ?? recipient,
      refundTo,
      slippageBps,
      // The product has no public mode. A stored `public` is treated as the
      // default confidential quote rather than forwarded.
      confidentiality:
        stored.confidentiality === "advanced" ? "advanced" : "basic",
      mode:
        storedMode === "confidential-intents" ||
        storedMode === "confidential-external" ||
        storedMode === "confidential-withdrawal"
          ? storedMode
          : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* stored transaction refs                                             */
/* ------------------------------------------------------------------ */

const INTENT_STANDARDS: readonly IntentStandard[] = [
  "webauthn",
  "erc191",
  "raw_ed25519",
  "nep413",
];

export type StoredIntentRefs = {
  mode: SignedQuoteMode;
  standard: IntentStandard;
  signerId: string;
  intentPayload: string | Record<string, unknown>;
  intentDepositAddress: string;
  amountInRaw: string;
  deadline: string;
  assetId: string;
  /**
   * The external destination, present only for a withdrawal. It is not in the
   * signed payload; the approve route bound it in the quote and the submit
   * route checks it against the transaction row before enqueuing.
   */
  destination: string | null;
  intentHash: string | null;
  /** The card this intent answers, and the tool name it belongs to. */
  toolApprovalId: string | null;
  toolName: string | null;
  conversationId: string | null;
  dryQuoteId: string | null;
};

export type StoredIntentRefsResult =
  | { ok: true; refs: StoredIntentRefs }
  | { ok: false; reason: "refs-malformed" | "mode-mismatch" };

/**
 * Reads the values `/api/intents/approve` saved for the signed path.
 *
 * A signed intent exists for `confidential-intents` and
 * `confidential-withdrawal`; both are addressed to `intents.far`. The
 * external deposit mode has no payload and must never reach the submit route.
 */
export function readIntentRefs(refs: unknown): StoredIntentRefsResult {
  const stored = asRecord(refs);
  if (!stored) return { ok: false, reason: "refs-malformed" };

  if (!isSignedQuoteMode(typeof stored.mode === "string" ? stored.mode : null)) {
    return { ok: false, reason: "mode-mismatch" };
  }
  const mode = stored.mode as SignedQuoteMode;

  const standard = stored.standard;
  if (
    typeof standard !== "string" ||
    !(INTENT_STANDARDS as readonly string[]).includes(standard)
  ) {
    return { ok: false, reason: "refs-malformed" };
  }

  const signerId = readString(stored.signerId);
  const intentDepositAddress = readString(stored.intentDepositAddress);
  const amountInRaw = readString(stored.amountInRaw);
  const deadline = readString(stored.deadline);
  const assetId = readString(stored.assetId);

  const payload = stored.intentPayload;
  const intentPayload =
    typeof payload === "string"
      ? payload
      : asRecord(payload);

  if (
    !signerId ||
    !intentDepositAddress ||
    !amountInRaw ||
    !deadline ||
    !assetId ||
    !intentPayload
  ) {
    return { ok: false, reason: "refs-malformed" };
  }

  // A withdrawal is the only signed mode whose money leaves the account. Its
  // destination must have been recorded by the approve route, and it must
  // still normalise to an EIP-55 address. A missing one is malformed, not a
  // reason to read a destination from anywhere else.
  let destination: string | null = null;
  if (mode === "confidential-withdrawal") {
    destination = normalizeEvmAddress(readString(stored.destination));
    if (!destination) return { ok: false, reason: "refs-malformed" };
  }

  const intentHash = readString(stored.intentHash);

  return {
    ok: true,
    refs: {
      mode,
      standard: standard as IntentStandard,
      signerId,
      intentPayload,
      intentDepositAddress,
      amountInRaw,
      deadline,
      assetId,
      destination,
      intentHash: intentHash || null,
      toolApprovalId: readString(stored.toolApprovalId) || null,
      toolName: readString(stored.toolName) || null,
      conversationId: readString(stored.conversationId) || null,
      dryQuoteId: readString(stored.dryQuoteId) || null,
    },
  };
}

export type StoredWorkflowRef =
  | { kind: "swap" }
  | { kind: "limit_order"; orderId: string }
  | { kind: "malformed" };

/**
 * Which durable workflow a submitted transaction starts.
 *
 * A row written before limit orders has no `kind` and keeps the swap
 * lifecycle byte for byte. A limit-order row names its 1Click order id; a row
 * that says it is a limit order but carries no id is refused rather than
 * polled as a swap, because the swap status endpoint would never know it.
 */
export function readWorkflowRef(refs: unknown): StoredWorkflowRef {
  const stored = asRecord(refs);
  if (!stored || stored.kind !== "limit_order") return { kind: "swap" };
  const orderId = readString(stored.orderId);
  return orderId ? { kind: "limit_order", orderId } : { kind: "malformed" };
}
