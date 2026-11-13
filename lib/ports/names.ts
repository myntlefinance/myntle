/**
 * Name-resolution port. Frozen contract from step 01: every later step
 * builds against this shape.
 *
 * - `resolveName(chain, input)` returns `{ address, name, resolvedAt }`
 *   on success, `null` when the input is well-formed but unregistered,
 *   and throws `NameResolutionError` otherwise.
 * - Normalization: both chains `input.trim()` and reject empty post-trim
 *   (`invalid_input`). EVM lowercases then validates with `normalize`
 *   from the ENS package and accepts the `.eth` suffix only. Solana
 *   lowercases (case is not preserved), checks ASCII labels of 1-63
 *   `[a-z0-9-]` chars with total length <= 253, and accepts the `.sns`
 *   suffix only for now.
 * - Load-bearing `.sol` rule (today): `resolveName("solana", "<x>.sol")`
 *   throws `{ kind: "unavailable", reason: "sns_sol_transition" }` —
 *   never `invalid_input`, never `null`. Re-enabling `.sol` is a
 *   suffix-policy change owned by step 08, not a type change.
 *
 * Cache policy (no authoritative in-memory or client-side name cache):
 * success entries live 10 minutes (`resolved_at + 10min` = stale, then
 * background re-resolve), unregistered (`null`) entries live 1 hour,
 * failures are never cached. The money path is TTL 0: approval and
 * signing always resolve fresh and never accept a cached `resolvedAt`.
 */

export type NameChain = "evm" | "solana";

export type ResolvedName = {
  /** EVM: checksummed 0x; Solana: canonical base58. */
  address: string;
  /** The normalized input that was resolved (see rules above). */
  name: string;
  /** ISO 8601 UTC, always produced via `new Date().toISOString()`. */
  resolvedAt: string;
};

export type NameResolutionErrorKind = "invalid_input" | "unavailable";

/**
 * Closed machine-code list. The factory below rejects anything outside
 * it at runtime, so a new source signal cannot slip in untyped.
 *
 * - `bad_name`: local validation failed (ENS normalize threw, SNS
 *   charset/label/length check failed, empty input). No network call.
 * - `bad_suffix`: well-formed name under an unsupported suffix
 *   (non-`.eth` on EVM; non-`.sns`, non-`.sol` on Solana). No fetch.
 * - `ens_rpc`: mainnet client threw or timed out. Never cached.
 * - `sns_proxy`: proxy-side rejection, HTTP 5xx, network error, or
 *   timeout. Never cached as fact.
 * - `sns_sol_transition`: a well-formed `.sol` input while `.sol` reads
 *   are suspended. Retryable; step 08 owns the re-enable flip.
 */
export const NAME_RESOLUTION_REASONS = [
  "bad_name",
  "bad_suffix",
  "ens_rpc",
  "sns_proxy",
  "sns_sol_transition",
] as const;

export type NameResolutionReason =
  (typeof NAME_RESOLUTION_REASONS)[number];

export type NameResolutionError = {
  kind: NameResolutionErrorKind;
  /** Human-readable, logged server-side; never forwarded verbatim. */
  message: string;
  reason: NameResolutionReason;
  /** invalid_input: false; unavailable: true. */
  retryable: boolean;
};

const REASON_SET: ReadonlySet<string> = new Set(NAME_RESOLUTION_REASONS);

/**
 * Mapping to the shared taxonomy: `InvalidInput` becomes
 * `invalid_input` (retryable false), `ProviderUnavailable` becomes
 * `unavailable` (retryable true), and `NotFound` becomes the `null`
 * return (unregistered is never thrown).
 *
 * A missing key is non-retryable: retrying without a config change
 * loops forever, so adapters surface `ProviderNotConfigured` as-is
 * (see `isRetryablePortError`). If a name port must express a missing
 * key as a `NameResolutionError`, it maps to kind `unavailable` with
 * `retryable` false — constructed explicitly, since the factory below
 * defaults `unavailable` to retryable true.
 *
 * Steps 03/04 must write the adapter catch-mapping from caught
 * `InvalidInput` / `ProviderUnavailable` / `ProviderNotConfigured`
 * into `NameResolutionError` explicitly: `nameError()` is a factory,
 * not a converter.
 */
export function nameError(
  kind: NameResolutionErrorKind,
  reason: NameResolutionReason,
  message: string,
): NameResolutionError {
  if (!REASON_SET.has(reason)) {
    throw new Error(`Unknown name-resolution reason: ${String(reason)}`);
  }
  return { kind, reason, message, retryable: kind === "unavailable" };
}

export function isNameResolutionError(
  error: unknown,
): error is NameResolutionError {
  if (typeof error !== "object" || error === null) return false;
  const e = error as Record<string, unknown>;
  return (
    (e.kind === "invalid_input" || e.kind === "unavailable") &&
    typeof e.message === "string" &&
    typeof e.reason === "string" &&
    REASON_SET.has(e.reason) &&
    typeof e.retryable === "boolean"
  );
}

/** Success entries live 10 minutes; stale entries re-resolve. */
export const RESOLVED_NAME_TTL_MS = 10 * 60 * 1000;
/** Unregistered (`null`) entries live 1 hour. */
export const UNREGISTERED_NAME_TTL_MS = 60 * 60 * 1000;
/** Money path: approval and signing always resolve fresh, TTL 0. */
export const MONEY_PATH_TTL_MS = 0;

export interface NameResolverPort {
  resolveName(chain: NameChain, input: string): Promise<ResolvedName | null>;
}
