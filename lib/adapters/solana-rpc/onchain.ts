/**
 * On-chain SNS resolution (`.sns` only) through the Solana RPC endpoint
 * adapter — no REST proxy, no web3.js, no new dependencies.
 *
 * Flow (SNS-IP 5): derive the name-account key, read the registry plus the
 * tokenized check and both SOL records, then walk tokenized-domain owner →
 * SOL record V2 (staleness + RoA verified) → SOL record V1 (signature
 * verified against the domain owner; an invalid signature falls through and
 * NEVER pays the record address) → domain owner fallback.
 * Reference logic: `resolveSns` in `@bonfida/spl-name-service@4.0.1`
 * (`dist/cjs/resolve/resolveSns.cjs`); methodology:
 * `https://docs.sns.id/dev/on-chain-resolution.md`.
 *
 * Scope: `.sns` ONLY. `.sol` stays `unavailable/sns_sol_transition` at the
 * name layer and is never read on-chain here (the SRS transition moved
 * authority; old accounts may read stale). Anything without a `.sns`
 * suffix throws `InvalidInput` before any network call.
 *
 * Crypto (all in-tree, zero new deps — so `@noble/hashes` was NOT added):
 * - sha256 via `node:crypto` (server-side only, byte-identical to the
 *   `@noble/hashes/sha256` the SDK hashes with).
 * - ed25519 verify + on-curve checks via `@noble/curves` (already a dep;
 *   the SDK verifies V1 signatures with the same curve code).
 * - base58 via `bs58` (already a dep; addresses are round-tripped so odd
 *   encodings cannot leak out).
 * V1 fixture signatures in tests are produced with `tweetnacl` (already a
 * dep) so the verify path is checked cross-library.
 *
 * Errors use the shared taxonomy: well-formed but unregistered → `NotFound`
 * (the name layer turns that into its `null` return); every RPC, parse, or
 * timeout failure → `ProviderUnavailable` (the caller in `sns.ts` falls
 * back to the proxy); malformed input → `InvalidInput` (propagates, never
 * proxied, so the frozen taxonomy cannot change). Provider detail goes to
 * the server log, never to the caller.
 *
 * Timeouts: every RPC call carries its own abort (default 20s, the step
 * cap), and the whole flow runs under a hard overall timeout (default
 * 20s) — reads never hang.
 *
 * Server-side only.
 */

import { createHash } from "node:crypto";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import { InvalidInput, NotFound, ProviderUnavailable } from "@/lib/ports";

// ---------------------------------------------------------------------------
// Program constants. Each one is cited with its read-only source; a wrong
// constant resolves wrong silently, so every constant below is covered by
// the derivation vectors in `onchain.test.ts` plus the differential corpus
// in `sns-corpus.test.ts`.
// ---------------------------------------------------------------------------

/** Source: `@bonfida/spl-name-service@4.0.1` `dist/cjs/constants.cjs`
 * (`NAME_PROGRAM_ID`), same value in the sns-sdk `js/src/constants.ts`.
 * Verified live 2026-11-09: owns the `bonfida.sns` name account. */
const NAME_PROGRAM_ID = "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX";

/** Source: same constants modules (`SNS_HASH_PREFIX`); consumed by the
 * SDK's `getHashedNameSync`. */
const SNS_HASH_PREFIX = "SPL Name Service";

/** Source: same constants modules (labeled "The `.sns` TLD",
 * `SNS_ROOT_DOMAIN_ACCOUNT`). Verified live 2026-11-09 as the parent of
 * the `bonfida.sns` account. */
const SNS_ROOT_DOMAIN_ACCOUNT = "58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx";

/** Source: `spl-name-service` `dist/cjs/nft/const.cjs`
 * (`NAME_TOKENIZER_ID`), seed prefix `MINT_PREFIX`. */
const NAME_TOKENIZER_ID = "nftD3vbNkNqfj2Sd3HZwbpw4BxxKWr4AjGb9X38JeZk";
const MINT_PREFIX = "tokenized_name";

/** Source: `spl-name-service` `dist/cjs/nft/state.cjs`
 * (`NftRecord.findKeySync` seeds `["nft_record", nameAccount]`). */
const NFT_RECORD_SEED = "nft_record";

/** Name-tokenizer record layout. Source: `nft/state.cjs`
 * (`NftRecord.schema`: tag u8, nonce u8, nameAccount 32, owner 32,
 * nftMint 32; `NftRecord.LEN = 98`; `Tag.ActiveRecord = 2`,
 * `Tag.InactiveRecord = 3`). */
const NFT_RECORD_LEN = 98;
const NFT_TAG_ACTIVE_RECORD = 2;

/** Source: `@bonfida/sns-records@0.1.0` `dist` (`SNS_RECORDS_ID`); the
 * central state is the PDA of the program id under itself.
 * Source: `sns-records` index (`findProgramAddressSync([W.toBuffer()], W)`
 * exported as `CENTRAL_STATE_SNS_RECORDS`). Derived at runtime rather than
 * hardcoded, so derivation bugs surface as key mismatches in tests. */
const SNS_RECORDS_PROGRAM_ID = "HP3D4D1ZCmohQGFVms2SS4LCANgJyksBf5s1F77FuFjZ";

/** Name-registry header. Source: `spl-name-service` `dist/cjs/state.cjs`
 * (`NameRegistryState.schema`: parentName 32, owner 32, class 32;
 * `HEADER_LEN = 96`). */
const REGISTRY_HEADER_LEN = 96;

/** Record identifiers and version prefixes. Source: `spl-name-service`
 * `dist/cjs/types/record.cjs` (`Record.SOL = "SOL"`,
 * `RecordVersion.V1 = 1 / V2 = 2`, `RECORD_V1_SIZE` SOL = 96) and
 * `dist/cjs/utils/getSnsDomainKeySync.cjs` (V1 prefix byte `\x01`,
 * subdomain prefix `\0`) plus `dist/cjs/record/getRecordV2Key.cjs`
 * (V2 hashed label `"\x02" + record`). */
const RECORD_SOL = "SOL";
const RECORD_V1_PREFIX = "\x01";
const RECORD_V2_PREFIX = "\x02";
const SUBDOMAIN_PREFIX = "\0";
const RECORD_V1_SOL_LEN = 96;

/** V2 record header. Source: `sns-records` `RecordHeader`
 * (`stalenessValidation u16`, `rightOfAssociationValidation u16`,
 * `contentLength u32`, `LEN = 8`, sliced at `[96, 104)`). */
const RECORD_V2_HEADER_LEN = 8;

/** Validation schemes. Source: `spl-name-service`
 * `dist/cjs/record/const.cjs` (`Validation`: None 0, Solana 1,
 * Ethereum 2, UnverifiedSolana 3) and `sns-records`
 * `getValidationLength` (None → 0, Ethereum → 20,
 * Solana/UnverifiedSolana → 32). */
const VALIDATION_SOLANA = 1;
const SIGNATURE_LENGTH = 64;

/** Generic caller-facing message: no provider names reach the client. */
const UNAVAILABLE_MESSAGE = "Name lookup is unavailable. Try again shortly.";

/** Per-call cap (the step allows ≤20s) and hard overall cap. */
const ONCHAIN_CALL_TIMEOUT_MS = 20_000;
const ONCHAIN_OVERALL_TIMEOUT_MS = 20_000;

function unavailable(detail: string): ProviderUnavailable {
  console.error(`[sns-onchain] ${detail}`);
  return new ProviderUnavailable(UNAVAILABLE_MESSAGE);
}

function invalid(detail: string): InvalidInput {
  return new InvalidInput(detail);
}

function withTimeout<T>(
  ms: number,
  run: () => Promise<T>,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([run(), timeout]).finally(() => {
    clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// Derivation (pure; exported so tests pin every constant above).
// Mirrors `getHashedNameSync` / `getNameAccountKeySync` /
// `getSnsDomainKeySync` / `getRecordV1Key` / `getRecordV2Key` /
// `NftRecord.findKeySync` / `getDomainMint` from the SDK sources cited
// above — including the `findProgramAddress` nonce scan (255 → 0) with
// on-curve rejection of candidates.
// ---------------------------------------------------------------------------

function sha256Bytes(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

/** `PublicKey.isOnCurve` semantics: a 32-byte string that fails ed25519
 * point decompression is off-curve. */
export function isOffCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(bytes);
    return false;
  } catch {
    return true;
  }
}

function createProgramAddress(
  seeds: Uint8Array[],
  programId: Uint8Array,
): Uint8Array {
  const hash = createHash("sha256");
  for (const seed of seeds) {
    if (seed.length > 32) throw new Error("seed too long");
    hash.update(seed);
  }
  hash.update(programId);
  hash.update(Buffer.from("ProgramDerivedAddress", "utf8"));
  return new Uint8Array(hash.digest());
}

function findProgramAddress(
  seeds: Uint8Array[],
  programId: Uint8Array,
): Uint8Array {
  for (let nonce = 255; nonce >= 0; nonce--) {
    const candidate = createProgramAddress(
      [...seeds, new Uint8Array([nonce])],
      programId,
    );
    if (isOffCurve(candidate)) return candidate;
  }
  throw new Error("Unable to find a valid program address");
}

function decodeKey(base58Key: string): Uint8Array {
  return bs58.decode(base58Key);
}

function hashedName(name: string): Uint8Array {
  return sha256Bytes(Buffer.from(SNS_HASH_PREFIX + name, "utf8"));
}

function nameAccountKey(
  hashed: Uint8Array,
  nameClass: Uint8Array | null,
  nameParent: Uint8Array | null,
): Uint8Array {
  return findProgramAddress(
    [
      hashed,
      nameClass ?? new Uint8Array(32),
      nameParent ?? new Uint8Array(32),
    ],
    decodeKey(NAME_PROGRAM_ID),
  );
}

function deriveSync(
  name: string,
  parent: Uint8Array = decodeKey(SNS_ROOT_DOMAIN_ACCOUNT),
  nameClass?: Uint8Array,
): Uint8Array {
  return nameAccountKey(hashedName(name), nameClass ?? null, parent);
}

/**
 * Mirrors `getSnsDomainKeySync` for a TLD-trimmed domain (no record): one
 * label derives under the `.sns` root; `sub.parent` derives the parent
 * first with the `\0`-prefixed subdomain seed. Deeper nesting throws, as
 * the SDK's `InvalidInputError` does.
 */
function deriveDomainKeyBytes(trimmed: string): Uint8Array {
  const parts = trimmed.split(".");
  if (parts.length === 1) return deriveSync(parts[0] as string);
  if (parts.length === 2) {
    const parentKey = deriveSync(parts[1] as string);
    return deriveSync(SUBDOMAIN_PREFIX + (parts[0] as string), parentKey);
  }
  throw invalid("That name is not valid. Check it and try again.");
}

/** V2 record class. Mirrors the SDK's `CENTRAL_STATE_SNS_RECORDS`. */
function recordsCentralState(): Uint8Array {
  const programId = decodeKey(SNS_RECORDS_PROGRAM_ID);
  return findProgramAddress([programId], programId);
}

/** Domain account for a normalized `*.sns` name. */
export function deriveSnsDomainKey(name: string): string {
  return bs58.encode(deriveDomainKeyBytes(trimDomain(name)));
}

/**
 * Legacy V1 record key. Mirrors `getRecordV1Key(domain, Record.SOL)` =
 * `getSnsDomainKeySync("SOL." + trimmed, V1)`: the `\x01`-prefixed record
 * label derives under the domain (or subdomain) parent with no record
 * class.
 */
export function deriveRecordV1Key(name: string): string {
  const trimmed = trimDomain(name);
  const dotted = `${RECORD_SOL}.${trimmed}`;
  const parts = dotted.split(".");
  if (parts.length === 2) {
    const parentKey = deriveSync(parts[1] as string);
    return bs58.encode(
      deriveSync(RECORD_V1_PREFIX + (parts[0] as string), parentKey),
    );
  }
  if (parts.length === 3) {
    const parentKey = deriveSync(parts[2] as string);
    const subKey = deriveSync(SUBDOMAIN_PREFIX + (parts[1] as string), parentKey);
    return bs58.encode(
      deriveSync(RECORD_V1_PREFIX + (parts[0] as string), subKey),
    );
  }
  throw invalid("That name is not valid. Check it and try again.");
}

/**
 * V2 record key. Mirrors `getRecordV2Key(domain, Record.SOL)`: the hashed
 * `"\x02SOL"` label derives under the domain key with the records central
 * state as the name class.
 */
export function deriveRecordV2Key(name: string): string {
  const domainKey = deriveDomainKeyBytes(trimDomain(name));
  return bs58.encode(
    nameAccountKey(
      hashedName(RECORD_V2_PREFIX + RECORD_SOL),
      recordsCentralState(),
      domainKey,
    ),
  );
}

/** Mirrors `NftRecord.findKeySync(domainKey, NAME_TOKENIZER_ID)`. */
export function deriveNftRecordKey(domainKeyBase58: string): string {
  return bs58.encode(
    findProgramAddress(
      [Buffer.from(NFT_RECORD_SEED, "utf8"), decodeKey(domainKeyBase58)],
      decodeKey(NAME_TOKENIZER_ID),
    ),
  );
}

/** Mirrors `getDomainMint`: PDA of `["tokenized_name", domainKey]`. */
export function deriveDomainMintKey(domainKeyBase58: string): string {
  return bs58.encode(
    findProgramAddress(
      [Buffer.from(MINT_PREFIX, "utf8"), decodeKey(domainKeyBase58)],
      decodeKey(NAME_TOKENIZER_ID),
    ),
  );
}

/** The V2 records central state (derived, not hardcoded — see above). */
export function deriveRecordsCentralState(): string {
  return bs58.encode(recordsCentralState());
}

// ---------------------------------------------------------------------------
// RPC reads (fetch against the endpoint adapter's URL).
// ---------------------------------------------------------------------------

type FetchImpl = typeof fetch;

type AccountInfo = { owner: string; data: Uint8Array } | null;

type RpcDeps = {
  endpoint: string;
  fetchImpl: FetchImpl;
  timeoutMs: number;
};

function readAccountValue(body: unknown): AccountInfo | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const result = (body as Record<string, unknown>).result as
    | Record<string, unknown>
    | undefined;
  if (typeof result !== "object" || result === null) return undefined;
  const value = (result as Record<string, unknown>).value as
    | Record<string, unknown>
    | null
    | undefined;
  if (value === null || value === undefined) return null;
  const data = (value as Record<string, unknown>).data;
  const owner = (value as Record<string, unknown>).owner;
  if (!Array.isArray(data) || typeof data[0] !== "string") return undefined;
  if (data[1] !== "base64" || typeof owner !== "string") return undefined;
  return { owner, data: new Uint8Array(Buffer.from(data[0] as string, "base64")) };
}

async function rpcSingle(
  deps: RpcDeps,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    return await withTimeout(
      deps.timeoutMs,
      async () => {
        const res = await deps.fetchImpl(deps.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: controller.signal,
        });
        return (await res.json()) as unknown;
      },
      () => unavailable(`sns read ${method} timed out after ${deps.timeoutMs}ms`),
    );
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw error;
    throw unavailable(
      `sns read ${method} failed: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** One HTTP round-trip for the four resolution accounts (mirrors the SDK's
 * `getMultipleAccountsInfo` order: nft record, V1, V2, registry). */
async function readResolutionAccounts(
  deps: RpcDeps,
  keys: { nftRecord: string; v1: string; v2: string; domain: string },
): Promise<{ nft: AccountInfo; v1: AccountInfo; v2: AccountInfo; registry: AccountInfo }> {
  const ordered = [keys.nftRecord, keys.v1, keys.v2, keys.domain];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const bodies = await withTimeout(
      deps.timeoutMs,
      async () => {
        const res = await deps.fetchImpl(deps.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            ordered.map((key, index) => ({
              jsonrpc: "2.0",
              id: index + 1,
              method: "getAccountInfo",
              params: [key, { encoding: "base64" }],
            })),
          ),
          signal: controller.signal,
        });
        return (await res.json()) as unknown;
      },
      () => unavailable(`sns read getAccountInfo timed out after ${deps.timeoutMs}ms`),
    );
    if (!Array.isArray(bodies) || bodies.length !== ordered.length) {
      throw unavailable("sns read answered outside the batch envelope.");
    }
    const byId = new Map<number, unknown>();
    for (const item of bodies) {
      if (typeof item !== "object" || item === null) {
        throw unavailable("sns read answered outside the batch envelope.");
      }
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "number" || record.error !== undefined) {
        const code =
          typeof record.error === "object" && record.error !== null
            ? (record.error as Record<string, unknown>).code
            : undefined;
        throw unavailable(`sns read rejected the batch (code ${String(code)}).`);
      }
      byId.set(record.id, item);
    }
    const pick = (id: number): AccountInfo => {
      const parsed = readAccountValue(byId.get(id));
      if (parsed === undefined) {
        throw unavailable("sns read answered outside the account envelope.");
      }
      return parsed;
    };
    return { nft: pick(1), v1: pick(2), v2: pick(3), registry: pick(4) };
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw error;
    throw unavailable(
      `sns read getAccountInfo failed: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tokenized-domain owner. Mirrors `retrieveNftOwnerV2`: the domain mint's
 * largest token account, decoded with the SPL token layout (mint 32,
 * owner 32, amount u64-LE at `[64,72)`), pays only when exactly one token
 * sits there. A `-32602` (mint does not exist) means no owner, as in
 * the SDK. Anything inconclusive returns null so the caller falls back.
 */
async function readTokenOwner(
  deps: RpcDeps,
  mint: string,
): Promise<string | null> {
  const raw = await rpcSingle(deps, "getTokenLargestAccounts", [mint]);
  if (typeof raw !== "object" || raw === null) {
    throw unavailable("sns read answered outside the largest-accounts envelope.");
  }
  const largest = raw as Record<string, unknown>;
  const result = largest.result as Record<string, unknown> | undefined;
  const error = largest.error as Record<string, unknown> | undefined;
  if (error !== undefined) {
    if (error.code === -32602) return null;
    throw unavailable(`sns read getTokenLargestAccounts rejected (code ${String(error.code)}).`);
  }
  if (typeof result !== "object" || result === null) {
    throw unavailable("sns read answered outside the largest-accounts envelope.");
  }
  const value = (result as Record<string, unknown>).value;
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0] as Record<string, unknown>;
  if (typeof first.address !== "string") {
    throw unavailable("sns read answered outside the largest-accounts envelope.");
  }
  const info = await rpcSingle(deps, "getAccountInfo", [
    first.address as string,
    { encoding: "base64" },
  ]);
  const account = readAccountValue(info);
  if (account === undefined) {
    throw unavailable("sns read answered outside the account envelope.");
  }
  if (account === null || account.data.length < 72) return null;
  const owner = account.data.subarray(32, 64);
  const amount = new DataView(
    account.data.buffer,
    account.data.byteOffset + 64,
    8,
  ).getBigUint64(0, true);
  if (amount !== 1n) return null;
  return bs58.encode(owner);
}

// ---------------------------------------------------------------------------
// Record parsing.
// ---------------------------------------------------------------------------

function canonicalBase58(raw: Uint8Array): string {
  return bs58.encode(bs58.decode(bs58.encode(raw)));
}

function validationLength(kind: number): number {
  if (kind === 0) return 0;
  if (kind === 2) return 20;
  if (kind === VALIDATION_SOLANA || kind === 3) return 32;
  throw unavailable(`sns record carries an unknown validation scheme (${kind}).`);
}

/**
 * V2 SOL record. Mirrors the `recordV2:` block of `resolveSns`: both
 * validations must be Solana-scheme, the content must be 32 bytes, the
 * staleness id must equal the domain owner (a mismatch breaks to V1,
 * exactly as the SDK's `break recordV2` does), and the RoA id must equal
 * the content (a mismatch throws, as the SDK's `InvalidRoaError` does —
 * the record address is NEVER paid on any anomaly).
 */
function parseRecordV2(
  data: Uint8Array,
  domainOwner: Uint8Array,
): { address: string } | { fallThrough: true } {
  if (data.length < REGISTRY_HEADER_LEN + RECORD_V2_HEADER_LEN) {
    throw unavailable("sns record v2 arrived truncated.");
  }
  const view = new DataView(data.buffer, data.byteOffset + REGISTRY_HEADER_LEN);
  const stalenessValidation = view.getUint16(0, true);
  const roaValidation = view.getUint16(2, true);
  if (
    stalenessValidation !== VALIDATION_SOLANA ||
    roaValidation !== VALIDATION_SOLANA
  ) {
    throw unavailable("sns record v2 uses an unexpected validation scheme.");
  }
  const payload = data.subarray(REGISTRY_HEADER_LEN + RECORD_V2_HEADER_LEN);
  const staleLen = validationLength(stalenessValidation);
  const roaLen = validationLength(roaValidation);
  const stalenessId = payload.subarray(0, staleLen);
  const roaId = payload.subarray(staleLen, staleLen + roaLen);
  const content = payload.subarray(staleLen + roaLen);
  if (content.length !== 32) {
    throw unavailable("sns record v2 arrived malformed.");
  }
  if (!bytesEqual(stalenessId, domainOwner)) return { fallThrough: true };
  if (!bytesEqual(roaId, content)) {
    throw unavailable("sns record v2 failed association verification.");
  }
  return { address: canonicalBase58(content) };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * V1 SOL record. Mirrors the V1 block of `resolveSns`: the payload is a
 * 96-byte pubkey + 64-byte signature (source: the on-chain-resolution FAQ
 * and the V1-records doc), and the message is the UTF-8 bytes of the hex
 * of `pubkey_bytes + record_key_bytes`, verified against the domain
 * owner. An invalid signature (or any anomaly) falls through — the record
 * address is NEVER paid.
 */
function parseRecordV1(
  data: Uint8Array,
  recordKey: Uint8Array,
  domainOwner: Uint8Array,
): string | null {
  // The payload is exactly the 96-byte pubkey + signature documented for
  // the V1 SOL record (`RECORD_V1_SIZE`), so the account is 96 + 96 bytes.
  if (data.length < REGISTRY_HEADER_LEN + RECORD_V1_SOL_LEN) {
    return null;
  }
  const pubkey = data.subarray(
    REGISTRY_HEADER_LEN,
    REGISTRY_HEADER_LEN + 32,
  );
  const signature = data.subarray(
    REGISTRY_HEADER_LEN + 32,
    REGISTRY_HEADER_LEN + 32 + SIGNATURE_LENGTH,
  );
  const message = new TextEncoder().encode(
    Buffer.from(Buffer.concat([pubkey, recordKey])).toString("hex"),
  );
  try {
    if (ed25519.verify(signature, message, domainOwner)) {
      return canonicalBase58(pubkey);
    }
  } catch {
    // A length or encoding anomaly verifies as invalid: fall through.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export type OnchainSnsResolution = {
  /** Canonical base58 (round-tripped, so odd encodings cannot leak out). */
  address: string;
};

function trimDomain(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0 || !trimmed.endsWith(".sns")) {
    throw invalid("That name is not valid. Check it and try again.");
  }
  const withoutTld = trimmed.slice(0, -".sns".length);
  if (withoutTld.length === 0) {
    throw invalid("That name is not valid. Check it and try again.");
  }
  return withoutTld;
}

/**
 * Resolves one normalized `.sns` name against chain state. Throws
 * `NotFound` when the name is well-formed but unregistered, `InvalidInput`
 * for non-`.sns` input (before any network call), and
 * `ProviderUnavailable` for every RPC, parse, or timeout failure so the
 * caller can fall back to the proxy.
 */
export async function resolveSnsOnchain(
  name: string,
  options: {
    /** Solana RPC URL from the endpoint adapter (never hardcoded here). */
    endpoint: string;
    fetchImpl?: FetchImpl;
    /** Per-call cap (≤20s). */
    timeoutMs?: number;
    /** Hard overall cap — the flow never hangs. */
    overallTimeoutMs?: number;
  },
): Promise<OnchainSnsResolution> {
  const timeoutMs = options?.timeoutMs ?? ONCHAIN_CALL_TIMEOUT_MS;
  const overallTimeoutMs =
    options?.overallTimeoutMs ?? ONCHAIN_OVERALL_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const endpoint = options?.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    throw unavailable("sns read has no endpoint configured.");
  }

  return withTimeout(
    overallTimeoutMs,
    async () => {
      const trimmed = trimDomain(name);
      const domainKey = bs58.encode(deriveDomainKeyBytes(trimmed));
      const v1Key = deriveRecordV1Key(name);
      const v2Key = deriveRecordV2Key(name);
      const nftRecordKey = deriveNftRecordKey(domainKey);
      const deps: RpcDeps = { endpoint, fetchImpl, timeoutMs };

      const accounts = await readResolutionAccounts(deps, {
        nftRecord: nftRecordKey,
        v1: v1Key,
        v2: v2Key,
        domain: domainKey,
      });

      if (accounts.registry === null) {
        throw new NotFound("No name record matches that request.");
      }
      if (accounts.registry.data.length < REGISTRY_HEADER_LEN) {
        throw unavailable("sns name account arrived truncated.");
      }
      const domainOwner = accounts.registry.data.subarray(32, 64);

      // Step 1 (docs flowchart): a tokenized domain pays its token holder.
      // Only an active tokenizer record counts — anything else (including
      // the inactive record live on `bonfida.sns`) falls through, as the
      // SDK does.
      if (
        accounts.nft !== null &&
        accounts.nft.data.length >= NFT_RECORD_LEN &&
        accounts.nft.data[0] === NFT_TAG_ACTIVE_RECORD
      ) {
        const tokenOwner = await readTokenOwner(
          deps,
          deriveDomainMintKey(domainKey),
        );
        if (tokenOwner === null) {
          throw unavailable("sns tokenized domain has no token holder.");
        }
        return { address: canonicalBase58(decodeKey(tokenOwner)) };
      }
      if (accounts.nft !== null && accounts.nft.data.length < 1) {
        throw unavailable("sns tokenizer record arrived truncated.");
      }

      // Step 2a: SOL record V2, staleness + RoA verified.
      if (accounts.v2 !== null) {
        const v2 = parseRecordV2(accounts.v2.data, domainOwner);
        if (!("fallThrough" in v2)) return { address: v2.address };
        // Stale V2 breaks to the V1 check, exactly as the SDK does.
      }

      // Step 2b: SOL record V1, signature verified. Invalid falls through.
      if (accounts.v1 !== null) {
        const v1Address = parseRecordV1(
          accounts.v1.data,
          decodeKey(v1Key),
          domainOwner,
        );
        if (v1Address !== null) return { address: v1Address };
      }

      // Step 3: the domain owner — unless it is a PDA, which the SDK's
      // default resolution refuses (mirrored here as an on-chain failure
      // so the proxy fallback decides).
      if (isOffCurve(domainOwner)) {
        throw unavailable("sns domain owner is not a wallet address.");
      }
      return { address: canonicalBase58(domainOwner) };
    },
    () => unavailable(`sns read exceeded ${overallTimeoutMs}ms overall`),
  );
}
