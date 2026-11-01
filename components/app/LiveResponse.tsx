"use client";

import type { UIMessage } from "ai";
import ActivityPills, {
  type ActivityBlock,
} from "@/components/app/ActivityPills";
import type { ToolDetailLine, ToolStep } from "@/components/primitives/ToolChips";
import { AgentMessageActions } from "@/components/app/MessageActions";

/**
 * The assistant's live reply.
 *
 * The message parts arrive in stream order — reasoning deltas between tool
 * rounds, tool calls, and text — and are grouped into activity blocks in
 * that order: consecutive reasoning deltas form one thinking pill, a tool
 * part breaks the run and the next tool call continues the same pills, and
 * text renders as markdown through `components/app/Markdown`. Each
 * interrupt (a new tool run, new thinking after a result, or the turn simply
 * ending) therefore starts a fresh pill; see
 * `components/app/ActivityPills` for the pill lifecycle.
 *
 * Every tool row names the object it touched — the ticker looked up, the
 * pair priced, the address checked — never the row's state. The pill header
 * already says whether the run is in flight, so a chip that says "done"
 * repeats what the header said and tells the reader nothing.
 */
export function LiveResponse({
  message,
  status,
  onRegenerate,
}: {
  message: UIMessage;
  status: "submitted" | "streaming" | "ready" | "error";
  onRegenerate?: () => void;
}) {
  /* Tickers ride along in the catalogue outputs, so a later quote in the
   * same turn can name its pair without another round trip. */
  const symbols = harvestSymbols(message.parts);
  const blocks: ActivityBlock[] = [];
  for (const part of message.parts) {
    if (part.type === "reasoning") {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "reasoning") last.text += part.text;
      else blocks.push({ kind: "reasoning", text: part.text });
    } else if (isToolPart(part.type)) {
      const step = describeTool(toolNameOf(part), part, symbols);
      const last = blocks[blocks.length - 1];
      if (last?.kind === "tools") last.steps.push(step);
      else blocks.push({ kind: "tools", steps: [step] });
    } else if (part.type === "text" && part.text.length > 0) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "text") last.text += part.text;
      else blocks.push({ kind: "text", text: part.text });
    }
  }

  const running = status === "submitted" || status === "streaming";
  const replyText = blocks
    .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
    .map((b) => b.text)
    .join("\n\n");

  return (
    <article
      className="min-w-0"
      style={{ animation: "fade-up 450ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <ActivityPills blocks={blocks} running={running} />
      {replyText && (
        <div className="mt-2.5">
          <AgentMessageActions text={replyText} onRegenerate={onRegenerate} />
        </div>
      )}
    </article>
  );
}

/* ── part shapes ──────────────────────────────────────────────
 * Static tools arrive as `tool-<name>`; dynamic ones as `dynamic-tool`
 * with the name beside it. Either way a part carries its input, and once
 * the call resolves, its output or error. */

type ToolPart = {
  type: string;
  toolName?: unknown;
  state?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
};

function isToolPart(type: string): boolean {
  return type.startsWith("tool-") || type === "dynamic-tool";
}

function toolNameOf(part: ToolPart): string {
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") {
    return part.toolName;
  }
  return part.type.startsWith("tool-")
    ? part.type.slice("tool-".length)
    : part.type;
}

function stateOf(part: ToolPart): string {
  return typeof part.state === "string" ? part.state : "";
}

function inputOf(part: ToolPart): Record<string, unknown> {
  return typeof part.input === "object" && part.input !== null
    ? (part.input as Record<string, unknown>)
    : {};
}

function outputOf(part: ToolPart): Record<string, unknown> {
  return typeof part.output === "object" && part.output !== null
    ? (part.output as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/* ── the ticker map ─────────────────────────────────────────── */

function harvestSymbols(parts: UIMessage["parts"]): Map<string, string> {
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
function assetName(assetId: string, symbols: Map<string, string>): string {
  const known = symbols.get(assetId);
  if (known) return known;
  return shortId(assetId);
}

/** `nep141:172086…a33a1` — the standard stays, the hash compresses. */
function shortId(id: string): string {
  const head = id.includes(":") ? id.slice(0, id.indexOf(":")) : "";
  const tail = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  const short =
    tail.length > 12 ? `${tail.slice(0, 6)}…${tail.slice(-4)}` : tail;
  return head ? `${head}:${short}` : short;
}

function formatNum(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (n !== 0 && (Math.abs(n) >= 1_000_000 || Math.abs(n) < 0.0001)) {
    return n.toExponential(2);
  }
  return String(Number(n.toPrecision(4)));
}

/* ── per-tool rows ────────────────────────────────────────────
 * Each row answers "what did it touch": the ticker, the pair, the trade.
 * The header already carries the run's state, so no chip repeats it —
 * except `failed` and `awaiting approval`, which change what happens next. */

function describeTool(
  name: string,
  part: ToolPart,
  symbols: Map<string, string>,
): ToolStep {
  const state = stateOf(part);
  if (state === "output-error") {
    return {
      icon: iconFor(name),
      label: labelFor(name, part),
      chip: "failed",
      mono: false,
      detailMono: true,
      detail:
        typeof part.errorText === "string" && part.errorText.length > 0
          ? [{ text: part.errorText.slice(0, 160) }]
          : [],
    };
  }
  switch (name) {
    case "get_supported_assets":
      return assetsRow(part);
    case "get_wallet_balances":
      return balancesRow(part);
    case "get_quote":
      return quoteRow(part, symbols, "Quoted a price");
    case "prepare_swap": {
      if (state === "approval-requested" || state === "approval-responded") {
        const swap = quoteRow(part, symbols, "Proposed a trade");
        return { ...swap, chip: "awaiting approval", mono: false };
      }
      return quoteRow(part, symbols, "Proposed a trade");
    }
    case "get_transaction_status":
      return statusRow(part);
    case "get_transaction_history":
      return historyRow(part);
    default:
      return {
        icon: "think",
        label: "Working",
        chip: name,
        mono: true,
        detailMono: false,
        detail: [],
      };
  }
}

function iconFor(name: string): string {
  switch (name) {
    case "get_quote":
    case "get_transaction_status":
      return "run";
    case "prepare_swap":
      return "write";
    default:
      return "read";
  }
}

/** The label stays put while the call resolves, so the row never shifts
 * under the reader; the chip is the part that fills in. */
function labelFor(name: string, part: ToolPart): string {
  const input = inputOf(part);
  switch (name) {
    case "get_supported_assets": {
      const symbol = str(input.symbol);
      return symbol ? `Looked up ${symbol.toUpperCase()}` : "Listed assets";
    }
    case "get_wallet_balances":
      return "Read balances";
    case "get_quote":
      return "Quoted a price";
    case "prepare_swap":
      return "Proposed a trade";
    case "get_transaction_status":
      return "Checked a trade";
    case "get_transaction_history":
      return "Listed trades";
    default:
      return "Working";
  }
}

/** The first entries of a catalogue output, as `TICKER · chain` lines with
 * an overflow count — the same shape for balances and asset lookups. */
function catalogueDetail(
  assets: Array<{ assetId: string; symbol: string; chain: string }>,
): ToolDetailLine[] {
  const lines = assets.slice(0, 4).map((a) => ({
    text: a.chain ? `${a.symbol.toUpperCase()} · ${a.chain}` : a.symbol.toUpperCase(),
  }));
  if (assets.length > 4) lines.push({ text: `+${assets.length - 4} more` });
  return lines;
}

function catalogueEntries(part: ToolPart): Array<{
  assetId: string;
  symbol: string;
  chain: string;
}> {
  const output = outputOf(part);
  if (!Array.isArray(output.assets)) return [];
  return output.assets.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const asset = entry as { assetId?: unknown; symbol?: unknown; chain?: unknown };
    if (typeof asset.assetId !== "string" || typeof asset.symbol !== "string") {
      return [];
    }
    return [
      {
        assetId: asset.assetId,
        symbol: asset.symbol,
        chain: typeof asset.chain === "string" ? asset.chain : "",
      },
    ];
  });
}

function assetsRow(part: ToolPart): ToolStep {
  const input = inputOf(part);
  const symbol = str(input.symbol)?.toUpperCase() ?? null;
  const entries = catalogueEntries(part);
  const done = entries.length > 0;
  return {
    icon: "read",
    label: symbol ? `Looked up ${symbol}` : "Listed assets",
    chip: symbol
      ? done
        ? `${symbol} · ${entries.length} ${entries.length === 1 ? "match" : "matches"}`
        : symbol
      : done
        ? `${entries.length} assets`
        : "catalogue",
    /* the bare ticker is an identifier; counts are prose */
    mono: symbol != null && !done,
    detailMono: true,
    detail: catalogueDetail(entries),
  };
}

function balancesRow(part: ToolPart): ToolStep {
  const entries = catalogueEntries(part);
  return {
    icon: "read",
    label: "Read balances",
    chip: entries.length > 0 ? `${entries.length} assets` : "balances",
    mono: false,
    detailMono: true,
    detail: catalogueDetail(entries),
  };
}

function quoteRow(
  part: ToolPart,
  symbols: Map<string, string>,
  label: string,
): ToolStep {
  const input = inputOf(part);
  const output = outputOf(part);
  const from = str(input.fromAssetId);
  const to = str(input.toAssetId);
  const pair =
    from && to
      ? `${assetName(from, symbols)} → ${assetName(to, symbols)}`
      : "a trade";
  const amountIn = str(output.amountIn);
  const amountOut = str(output.amountOut);
  const amountOutUsd = str(output.amountOutUsd);

  const detail: ToolDetailLine[] = [];
  if (amountIn && amountOut && from && to) {
    detail.push({
      text: `${formatNum(amountIn)} ${assetName(from, symbols)} → ${formatNum(amountOut)} ${assetName(to, symbols)}`,
    });
    /* Human rate from the formatted figures, never the raw-unit ratio the
     * engine returns — that one is off by the decimals and reads as noise. */
    const rate = Number(amountOut) / Number(amountIn);
    if (Number.isFinite(rate) && rate > 0) {
      detail.push({
        text: `Rate ${formatNum(String(rate))} ${assetName(to, symbols)} per ${assetName(from, symbols)}`,
      });
    }
  }
  if (amountOutUsd) {
    detail.push({ text: `≈ $${formatNum(amountOutUsd)}` });
  }

  return {
    icon: label === "Proposed a trade" ? "write" : "run",
    label,
    chip:
      amountIn && amountOut && from && to
        ? `${formatNum(amountIn)} ${assetName(from, symbols)} → ${formatNum(amountOut)} ${assetName(to, symbols)}`
        : pair,
    mono: true,
    detailMono: true,
    detail,
  };
}

function statusRow(part: ToolPart): ToolStep {
  const input = inputOf(part);
  const output = outputOf(part);
  const address = str(input.depositAddress);
  const state = str(output.state);
  const amountOut = str(output.amountOut);
  const detail: ToolDetailLine[] = [];
  if (state) {
    detail.push({
      text: amountOut ? `${state} · out ${formatNum(amountOut)}` : state,
    });
  }
  return {
    icon: "run",
    label: "Checked a trade",
    chip:
      state != null
        ? amountOut
          ? `${state} · ${formatNum(amountOut)}`
          : state
        : address
          ? shortId(address)
          : "a trade",
    mono: state != null ? false : true,
    detailMono: true,
    detail,
  };
}

function historyRow(part: ToolPart): ToolStep {
  const output = outputOf(part);
  const trades = Array.isArray(output.trades) ? output.trades : null;
  const note = str(output.note);
  return {
    icon: "read",
    label: "Listed trades",
    chip: trades != null ? `${trades.length} trades` : "history",
    mono: false,
    detailMono: false,
    detail: note ? [{ text: note }] : [],
  };
}
