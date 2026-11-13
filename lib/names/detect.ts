import type { NameChain } from "@/lib/ports/names";

/**
 * Name mentions in free text and whole-field name checks.
 *
 * Client-safe: zero imports, no `fetch`, no provider coupling. The composer
 * strip and the approval card both read from here; the server side resolves
 * through `lib/names/resolve.ts` (behind the port) and re-verifies with
 * `lib/names/binding.ts`.
 *
 * Only `.eth` and `.sns` read as names. `.sol` is deliberately excluded:
 * the resolver holds `.sol` as unavailable during the registry transition
 * (see `lib/names/resolve.ts`), so a `.sol` mention keeps its raw-path
 * behavior instead of previewing an address that cannot be served.
 */

export type DetectedName = {
  /** The exact slice as typed, for replacing back into the draft. */
  raw: string;
  /** Lowercased form, which is what the resolver normalizes to. */
  name: string;
  chain: NameChain;
  start: number;
  end: number;
};

/** Whole-field input cap, matching `MAX_WATCH_ADDRESS_LENGTH`. */
export const MAX_NAME_INPUT_LENGTH = 128;

/**
 * A name-like run inside prose: at least one label, then `.eth` or `.sns`,
 * opened by a start or boundary character. Case-insensitive; the match is
 * trimmed of trailing sentence punctuation (a terminal "vitalik.eth." still
 * reads as the name) and capped at the input length.
 */
const NAME_IN_TEXT =
  /(^|[\s"'([{<])((?!0x)[^\s"'(){}<>\[\],;!?]+?\.(?:eth|sns))(?![A-Za-z0-9_-])/gi;

const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

const WHOLE_NAME = /^(?!0x)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.(eth|sns)$/i;

/**
 * Every name mention in the text, in order. ASCII labels only: a
 * non-ASCII name never previews, but the server still resolves it when it
 * reaches a tool, so nothing typed is lost.
 */
export function findNamesInText(text: string): DetectedName[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const found: DetectedName[] = [];
  NAME_IN_TEXT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NAME_IN_TEXT.exec(text)) !== null) {
    const rawMatch = match[2] ?? "";
    const cleaned = rawMatch.replace(TRAILING_PUNCTUATION, "");
    // The opener character is group 1; the name starts after it.
    const start = match.index + (match[1]?.length ?? 0);
    if (cleaned.length === 0 || cleaned.length > MAX_NAME_INPUT_LENGTH) {
      continue;
    }
    const whole = WHOLE_NAME.exec(cleaned);
    if (!whole) continue;
    const suffix = whole[1].toLowerCase();
    found.push({
      raw: cleaned,
      name: cleaned.toLowerCase(),
      chain: suffix === "eth" ? "evm" : "solana",
      start,
      end: start + cleaned.length,
    });
    // A zero-width advance guard: the pattern always consumes, but a
    // shared module regex must never spin on an empty match.
    if (match[0].length === 0) NAME_IN_TEXT.lastIndex += 1;
  }
  return found;
}

/**
 * The resolver chain for a whole-field value, or null when the value is
 * not a name candidate. Raw addresses are not candidates: an `0x` value
 * stays on the address path even when it ends in `.eth`-like text, and a
 * base58 address never contains a dot.
 */
export function nameChainForInput(value: unknown): NameChain | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_NAME_INPUT_LENGTH) return null;
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered.endsWith(".eth")) return "evm";
  if (lowered.endsWith(".sns")) return "solana";
  return null;
}

/** True when the whole-field value reads as a name candidate. */
export function isNameLikeValue(value: unknown): boolean {
  return nameChainForInput(value) !== null;
}

/** Replaces the first occurrence of the typed name with the address. */
export function replaceFirstName(
  text: string,
  raw: string,
  replacement: string,
): string {
  const at = text.indexOf(raw);
  if (at < 0) return text;
  return text.slice(0, at) + replacement + text.slice(at + raw.length);
}

export type NamePreview =
  | { ok: true; address: string; name: string; resolvedAt: string }
  | { ok: false; reason: "unregistered" | "invalid" | "unavailable" };

/**
 * Reads one name through the resolve route for display only. Never throws:
 * every failure reads as its reason, so a strip or a card always has a
 * state to show. The server resolves again at submit time and never trusts
 * the address returned here.
 */
export async function fetchNamePreview(
  input: string,
  chain: NameChain,
  fetchImpl: typeof fetch = fetch,
): Promise<NamePreview> {
  let res: Response;
  try {
    res = await fetchImpl(
      `/api/names/resolve?chain=${chain}&name=${encodeURIComponent(input.trim())}`,
      { cache: "no-store" },
    );
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (res.status === 404) return { ok: false, reason: "unregistered" };
  if (res.status === 400) return { ok: false, reason: "invalid" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const body = (await res.json().catch(() => null)) as {
    address?: unknown;
    name?: unknown;
    resolvedAt?: unknown;
  } | null;
  if (
    !body ||
    typeof body.address !== "string" ||
    typeof body.name !== "string" ||
    typeof body.resolvedAt !== "string"
  ) {
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    address: body.address,
    name: body.name,
    resolvedAt: body.resolvedAt,
  };
}
