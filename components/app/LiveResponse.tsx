"use client";

import { useMemo } from "react";
import type { UIMessage } from "ai";
import ActivityPills, {
  type ActivityBlock,
} from "@/components/app/ActivityPills";
import type { ToolDetailLine, ToolStep } from "@/components/primitives/ToolChips";
import { AgentMessageActions } from "@/components/app/MessageActions";
import SentenceTradeCard from "@/components/finance/SentenceTradeCard";
import AssetMatrix from "@/components/finance/AssetMatrix";
import AddressPill from "@/components/finance/AddressPill";
import type { SupportedChain } from "@/components/atoms/TechDataChip";
import type { AssetGroup } from "@/lib/wallet/balances";
import {
  approvalDecision,
  approvalIdOf,
  collectApprovalAssetIds,
  collectApprovals,
  settlementCardState,
  type SettlementSnapshot,
} from "@/components/app/approvals";
import { useResolvedAssetMeta } from "@/components/app/useAssetMeta";
import { useWallet } from "@/lib/wallet/registry";
import {
  rememberApprovalDenied,
  rememberApprovalTx,
} from "@/components/app/approvalStore";
import {
  assetName,
  formatNum,
  harvestAssetMeta,
  harvestSymbols,
  inputOf,
  isToolPart,
  outputOf,
  shortId,
  stateOf,
  str,
  toolNameOf,
  type ToolPart,
} from "@/components/app/toolParts";

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
  onApproval,
  settlements,
}: {
  message: UIMessage;
  status: "submitted" | "streaming" | "ready" | "error";
  onRegenerate?: () => void;
  onApproval?: (approvalId: string, approved: boolean) => void;
  /** Database settlements by tool approval id; terminal ones paint at once. */
  settlements?: Record<string, SettlementSnapshot>;
}) {
  const approvalIds = useMemo(
    () => collectApprovalAssetIds(message.parts),
    [message.parts],
  );
  const resolvedMeta = useResolvedAssetMeta(approvalIds);
  const symbols = useMemo(() => {
    const inTurn = harvestSymbols(message.parts);
    for (const [id, meta] of resolvedMeta) {
      if (!inTurn.has(id) && meta.symbol) inTurn.set(id, meta.symbol);
    }
    return inTurn;
  }, [message.parts, resolvedMeta]);
  const assetMeta = useMemo(() => {
    const inTurn = harvestAssetMeta(message.parts);
    const merged = new Map(resolvedMeta);
    for (const [id, meta] of inTurn) merged.set(id, meta);
    return merged;
  }, [message.parts, resolvedMeta]);
  // Blocks preserve stream order: consecutive reasoning deltas merge, a tool
  // part extends the current tools run, text merges until interrupted.
  // blockOrder records the part index each block started at so landmark
  // cards can interleave at their own tool index rather than trailing at
  // the end. A card never splits a sentence: it mounts between two text
  // blocks at a tool boundary.
  const blocks: ActivityBlock[] = [];
  const blockOrder: number[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === "reasoning") {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "reasoning") last.text += part.text;
      else {
        blocks.push({ kind: "reasoning", text: part.text });
        blockOrder.push(index);
      }
    } else if (isToolPart(part.type)) {
      const step = describeTool(toolNameOf(part), part, symbols);
      const last = blocks[blocks.length - 1];
      if (last?.kind === "tools") last.steps.push(step);
      else {
        blocks.push({ kind: "tools", steps: [step] });
        blockOrder.push(index);
      }
    } else if (part.type === "text" && part.text.length > 0) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "text") last.text += part.text;
      else {
        blocks.push({ kind: "text", text: part.text });
        blockOrder.push(index);
      }
    }
  });

  const running = status === "submitted" || status === "streaming";
  const replyText = blocks
    .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
    .map((b) => b.text)
    .join("\n\n");

  /* Landmark cards interleave at their own tool index: one balance card per
   * balance output, one approval card per prepare_swap decision. A decided
   * part keeps its card so the settlement stays visible; the card polls
   * /api/tx itself. The connected address lets the mapper name self-returns
   * correctly. Setup tools (asset lookup, quote) stay as pill rows only. */
  const { account } = useWallet();
  const approvals = collectApprovals(
    message,
    symbols,
    assetMeta,
    account?.address ?? null,
  );
  const balanceViews = collectBalanceViews(message.parts);
  const balanceByCallId = new Map(balanceViews.map((b) => [b.callId, b]));
  const approvalById = new Map(approvals.map((a) => [a.approvalId, a]));

  // Part index each card was born at. The pill row for the same call keeps
  // its place in the trace; the card mounts directly after it.
  const balanceOrder = new Map<string, number>();
  const approvalOrder = new Map<string, number>();
  message.parts.forEach((part, index) => {
    const p = part as ToolPart;
    if (!isToolPart(part.type)) return;
    if (
      (toolNameOf(p) === "get_wallet_balances" ||
        toolNameOf(p) === "getWalletBalances") &&
      typeof p.toolCallId === "string" &&
      balanceByCallId.has(p.toolCallId)
    ) {
      balanceOrder.set(p.toolCallId, index);
    }
    if (toolNameOf(p) === "prepare_swap") {
      const id = approvalIdOf(p);
      if (id && approvalById.has(id) && !approvalOrder.has(id)) {
        approvalOrder.set(id, index);
      }
    }
  });

  type TimelineNode =
    | { kind: "blocks"; blocks: ActivityBlock[]; order: number }
    | { kind: "balance"; callId: string; order: number }
    | { kind: "approval"; approvalId: string; order: number };

  const timeline: TimelineNode[] = [];
  blocks.forEach((block, i) => {
    timeline.push({ kind: "blocks", blocks: [block], order: blockOrder[i] });
  });
  for (const [callId, order] of balanceOrder) {
    timeline.push({ kind: "balance", callId, order });
  }
  for (const [approvalId, order] of approvalOrder) {
    timeline.push({ kind: "approval", approvalId, order });
  }
  // Pills first on ties: the trace row for a call reads before its card.
  timeline.sort((a, b) => a.order - b.order);

  function renderBalance(callId: string) {
    const b = balanceByCallId.get(callId);
    if (!b) return null;
    return (
      <div
        key={b.callId}
        className="mt-3"
        style={{
          animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both",
        }}
      >
        <div className="flex flex-col items-start gap-2">
          {b.address ? (
            <AddressPill address={b.address} chain={b.chain} />
          ) : null}
          <AssetMatrix
            title={b.title}
            groups={b.groups}
            totalValueUsd={b.totalValueUsd}
            showFilters={b.showFilters}
            initialFilter={b.initialFilter}
          />
        </div>
      </div>
    );
  }

  function renderApproval(approvalId: string) {
    const a = approvalById.get(approvalId);
    if (!a) return null;
    // The database row wins when it exists: terminal states paint at
    // once with no polling, and live rows poll the right record even on
    // a device whose localStorage never saw the approval.
    const snap = settlements?.[a.approvalId] ?? null;
    const snapState = snap ? settlementCardState(snap.state) : null;
    return (
      <div key={a.approvalId} className="mt-2.5">
        <SentenceTradeCard
          action={a.action}
          approvalId={a.approvalId}
          fromSymbol={a.fromSymbol}
          fromChain={a.fromChain}
          toSymbol={a.toSymbol}
          toChain={a.toChain}
          amountIn={a.amountIn}
          amountInUsd={a.amountInUsd}
          amountOut={a.amountOut}
          amountOutUsd={a.amountOutUsd}
          minAmountOut={a.minAmountOut}
          minAmountOutRaw={a.minAmountOutRaw}
          fromPriceUsd={a.fromPriceUsd}
          toPriceUsd={a.toPriceUsd}
          recipient={a.recipient}
          expiresAt={a.expiresAt}
          requestedAt={a.requestedAt}
          slippageBps={a.slippageBps}
          state={
            a.status === "denied"
              ? "denied"
              : (snapState ??
                (a.status === "approved" ? "submitted" : "awaiting"))
          }
          transactionId={snap?.transactionId ?? a.transactionId}
          depositAddress={snap?.depositAddress ?? a.depositAddress ?? undefined}
          initialExplorerUrls={snap?.explorerUrls}
          swapInput={a.status === "awaiting" ? a.swapInput : undefined}
          disabled={a.status !== "awaiting"}
          onApprove={(tx) => {
            if (tx) rememberApprovalTx(a.approvalId, tx);
            onApproval?.(a.approvalId, true);
          }}
          onDeny={() => {
            rememberApprovalDenied(a.approvalId);
            onApproval?.(a.approvalId, false);
          }}
        />
      </div>
    );
  }

  if (timeline.length === 0) {
    return null;
  }

  // Only the last activity group is live. Earlier groups settle the moment
  // a card mounts after them, so the thread never shows two spinners.
  const lastGroupIndex = timeline.reduce(
    (last, node, i) => (node.kind === "blocks" ? i : last),
    -1,
  );

  return (
    <article
      className="min-w-0"
      /* fade-in only: this article mounts 2-3s after send, replacing the
       * inflight loader in place. A fade-up would start it 8px low then
       * slide it up, reading as a downward jump of the settled loader. */
      style={{ animation: "fade-in 300ms ease-out both" }}
    >
      <div className="flex flex-col gap-4">
        {timeline.map((node, i) => {
          if (node.kind === "balance") return renderBalance(node.callId);
          if (node.kind === "approval") return renderApproval(node.approvalId);
          return (
            <ActivityPills
              key={`blocks-${node.order}-${i}`}
              blocks={node.blocks}
              running={running && i === lastGroupIndex}
            />
          );
        })}
      </div>
      {replyText && !running && (
        <div className="mt-2.5">
          <AgentMessageActions text={replyText} onRegenerate={onRegenerate} />
        </div>
      )}
    </article>
  );
}

/* ── per-tool rows ──────────────────────────────────────────── */

type BalanceViewInfo = {
  callId: string;
  title: string;
  address?: string;
  chain?: SupportedChain;
  showFilters: boolean;
  initialFilter: "all" | "stables" | "dust";
  totalValueUsd?: number;
  groups: AssetGroup[];
};

function collectBalanceViews(parts: UIMessage["parts"]): BalanceViewInfo[] {
  const views: BalanceViewInfo[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as ToolPart;
    if (!isToolPart(p.type)) continue;
    const name = toolNameOf(p);
    if (name !== "get_wallet_balances" && name !== "getWalletBalances") continue;

    if (!stateOf(p).startsWith("output")) continue;
    const out = outputOf(p);
    // Turns stored before `source` existed carry `connected` instead. Keep
    // those cards rendering after a reload rather than dropping them.
    const isBalanceCard =
      out.source === "session" ||
      out.source === "requested" ||
      out.connected === true;
    if (!isBalanceCard || !Array.isArray(out.groups) || out.groups.length === 0) {
      continue;
    }

    const callId =
      typeof p.toolCallId === "string" ? p.toolCallId : `balance-${i}`;

    views.push({
      callId,
      title: typeof out.title === "string" ? out.title : "Portfolio balances",
      // Only a lookup the model asked for carries an address the reader has
      // to be told about. The session card is already known to be theirs.
      address:
        (out.source === "requested" ||
          (out.source === undefined && out.connected === true)) &&
        typeof out.address === "string"
          ? out.address
          : undefined,
      chain:
        out.chain === "evm" || out.chain === "solana" || out.chain === "near"
          ? out.chain
          : undefined,
      showFilters: out.showFilters !== false,
      initialFilter:
        out.initialFilter === "stables" || out.initialFilter === "dust"
          ? out.initialFilter
          : "all",
      totalValueUsd:
        typeof out.totalValueUsd === "number" ? out.totalValueUsd : undefined,
      groups: out.groups as AssetGroup[],
    });
  }

  return views;
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
      if (state === "approval-requested") {
        const swap = quoteRow(part, symbols, "Proposed a trade");
        return { ...swap, chip: "awaiting approval", mono: false };
      }
      if (state === "approval-responded") {
        const swap = quoteRow(part, symbols, "Proposed a trade");
        if (approvalDecision(part) === false) {
          return { ...swap, chip: "rejected", mono: false };
        }
        return swap;
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
  const output = outputOf(part);
  const wallet =
    typeof output.wallet === "object" && output.wallet !== null
      ? (output.wallet as { balances?: unknown[] })
      : undefined;
  const balances = Array.isArray(wallet?.balances)
    ? (wallet.balances as Array<{
        symbol?: string;
        chain?: string;
        balance?: string;
        valueUsd?: number;
      }>)
    : [];

  if (balances.length > 0) {
    const lines: ToolDetailLine[] = balances.slice(0, 4).map((b) => ({
      text: `${b.symbol ?? "TOKEN"} · ${b.balance ?? "0"} (${b.chain ?? ""})`,
    }));
    if (balances.length > 4) {
      lines.push({ text: `+${balances.length - 4} more` });
    }
    return {
      icon: "read",
      label: "Read balances",
      chip: `${balances.length} ${balances.length === 1 ? "token" : "tokens"}`,
      mono: false,
      detailMono: true,
      detail: lines,
    };
  }

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
