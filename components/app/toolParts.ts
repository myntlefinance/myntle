import type { UIMessage } from "ai";

/* ── part shapes ──────────────────────────────────────────────
 * Static tools arrive as `tool-<name>`; dynamic ones as `dynamic-tool`
 * with the name beside it. Either way a part carries its input, and once
 * the call resolves, its output or error. Pure accessors shared by the
 * live reply and the approval collector. */

export type ToolPart = {
  type: string;
  toolCallId?: unknown;
  toolName?: unknown;
  state?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
  approval?: unknown;
};

export function isToolPart(type: string): boolean {
  return type.startsWith("tool-") || type === "dynamic-tool";
}

export function toolNameOf(part: ToolPart): string {
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") {
    return part.toolName;
  }
  return part.type.startsWith("tool-")
    ? part.type.slice("tool-".length)
    : part.type;
}

export function stateOf(part: ToolPart): string {
  return typeof part.state === "string" ? part.state : "";
}

export function inputOf(part: ToolPart): Record<string, unknown> {
  return typeof part.input === "object" && part.input !== null
    ? (part.input as Record<string, unknown>)
    : {};
}

export function outputOf(part: ToolPart): Record<string, unknown> {
  return typeof part.output === "object" && part.output !== null
    ? (part.output as Record<string, unknown>)
    : {};
}

export function str(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/* ── the ticker map ─────────────────────────────────────────── */

export function harvestSymbols(parts: UIMessage["parts"]): Map<string, string> {
  const symbols = new Map<string, string>();
  for (const part of parts) {
    if (!isToolPart(part.type)) continue;
    const output = outputOf(part as ToolPart);
    if (!Array.isArray(output.assets)) continue;
    for (const entry of output.assets) {
      if (typeof entry !== "object" || entry === null) continue;
      const asset = entry as { assetId?: unknown; symbol?: unknown };
      if (typeof asset.assetId === "string" && typeof asset.symbol === "string") {
        symbols.set(asset.assetId, asset.symbol.toUpperCase());
      }
    }
  }
  return symbols;
}

/** Name an asset the way the reader would: ticker when a catalogue output
 * in this turn taught us one, otherwise a short id. Never invents one. */
export function assetName(assetId: string, symbols: Map<string, string>): string {
  const known = symbols.get(assetId);
  if (known) return known;
  return shortId(assetId);
}

/* ── asset meta ───────────────────────────────────────────────
 * Catalogue outputs teach us each asset's chain and price, which the
 * trade card needs for network badges and dollar values. */

export type AssetMeta = {
  symbol: string;
  chain?: string;
  priceUsd?: number;
};

export function harvestAssetMeta(
  parts: UIMessage["parts"],
): Map<string, AssetMeta> {
  const meta = new Map<string, AssetMeta>();
  for (const part of parts) {
    if (!isToolPart(part.type)) continue;
    const output = outputOf(part as ToolPart);
    if (!Array.isArray(output.assets)) continue;
    for (const entry of output.assets) {
      if (typeof entry !== "object" || entry === null) continue;
      const asset = entry as {
        assetId?: unknown;
        symbol?: unknown;
        chain?: unknown;
        priceUsd?: unknown;
        price?: unknown;
      };
      if (typeof asset.assetId !== "string" || typeof asset.symbol !== "string") {
        continue;
      }
      if (meta.has(asset.assetId)) continue;
      meta.set(asset.assetId, {
        symbol: (asset.symbol as string).toUpperCase(),
        chain: typeof asset.chain === "string" ? asset.chain : undefined,
        priceUsd:
          typeof asset.priceUsd === "number"
            ? asset.priceUsd
            : typeof asset.price === "number"
              ? asset.price
              : undefined,
      });
    }
  }
  return meta;
}

/** `nep141:172086…a33a1` — the standard stays, the hash compresses. */
export function shortId(id: string): string {
  const head = id.includes(":") ? id.slice(0, id.indexOf(":")) : "";
  const tail = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  const short =
    tail.length > 12 ? `${tail.slice(0, 6)}…${tail.slice(-4)}` : tail;
  return head ? `${head}:${short}` : short;
}

export function formatNum(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (n !== 0 && (Math.abs(n) >= 1_000_000 || Math.abs(n) < 0.0001)) {
    return n.toExponential(2);
  }
  return String(Number(n.toPrecision(4)));
}

/** Display truncation for money. Whole units, at most six decimals with
 * trailing zeros cut, thousands grouped. Anything unparsable passes
 * through untouched. Display-only: signed and bound values stay raw. */
export function formatAmount(raw: string): string {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return raw;
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (abs >= 1) {
    return String(Number(n.toFixed(6)));
  }
  return String(Number(n.toPrecision(6)));
}
