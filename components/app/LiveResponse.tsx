"use client";

import { memo, useMemo } from "react";
import type { UIMessage } from "ai";
import ActivityPills, {
  type ActivityBlock,
} from "@/components/app/ActivityPills";
import type { ToolDetailLine, ToolStep } from "@/components/primitives/ToolChips";
import { AgentMessageActions } from "@/components/app/MessageActions";
import {
  buildAgentCopyHtml,
  buildAgentCopyText,
  type AgentCopySegment,
} from "@/components/app/agentCopy";
import { stripAssetMarkup } from "@/components/app/assetMarkup";
import SentenceTradeCard, {
  type SentenceCardState,
} from "@/components/finance/SentenceTradeCard";
import {
  depositApproval,
  swapApproval,
  withdrawalApproval,
} from "@/components/finance/sentence-approval";
import { formatRawAmount } from "@/lib/intents/approval";
import { depositCardStateForRecord } from "@/lib/intents/deposit-status";
import { signIntentForSession } from "@/lib/intents/session-signer";
import AssetMatrix from "@/components/finance/AssetMatrix";
import AddressPill from "@/components/finance/AddressPill";
import { UnlockedCard, UnlockRequestCard } from "@/components/app/UnlockCard";
import type { SupportedChain } from "@/components/atoms/TechDataChip";
import type { AssetGroup } from "@/lib/wallet/balances";
import {
  approvalDecision,
  approvalIdOf,
  collectApprovalAssetIds,
  collectApprovals,
  collectWithdrawals,
  settlementCardState,
  type SettlementSnapshot,
} from "@/components/app/approvals";
import { useResolvedAssetMeta } from "@/components/app/useAssetMeta";
import { useWallet } from "@/lib/wallet/registry";
import { evmChainForSlug } from "@/lib/wallet/evm-chains";
import { useAuth } from "@/lib/auth/auth-provider";
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
export type LiveResponseProps = {
  message: UIMessage;
  status: "submitted" | "streaming" | "ready" | "error";
  /** True only in the live chat, where actions still apply. */
  interactive?: boolean;
  /** A later user message exists, so this turn is a record. */
  superseded?: boolean;
  onRegenerate?: () => void;
  /** Sends a fresh request when an expired unlock card offers one. */
  onRetry?: () => void;
  onApproval?: (approvalId: string, approved: boolean) => void;
  /** Database settlements by tool approval id; terminal ones paint at once. */
  settlements?: Record<string, SettlementSnapshot>;
};

/**
 * Memoized: the chat re-renders every message per streaming token, but a
 * completed card only depends on its message object, status, and the
 * settlements for its approvals. The chat store (`ai` package) keeps
 * untouched message references stable across token updates
 * (`messages.map(m => m.id === updated ? {...} : m)`), so reference checks
 * are enough — no deep compare of large tool outputs.
 *
 * The callbacks are intentionally excluded: the live list passes fresh
 * inline closures (`onRetry`, `onRegenerate`) every render, and they close
 * over stable send/regenerate functions plus per-card text that never
 * changes for a historical card.
 */
export const LiveResponse = memo(function LiveResponseInner({
  message,
  status,
  interactive = false,
  superseded = false,
  onRegenerate,
  onRetry,
  onApproval,
  settlements,
}: LiveResponseProps) {
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
  const { account, signMessage, signNEP413 } = useWallet();
  // A session names its signer. A passkey account has no wallet to fall back
  // to, so every card it sees runs the signed-intent route; a wallet session
  // keeps `/api/approve` for a swap.
  const { identity } = useAuth();
  const passkeyIdentity = identity?.kind === "passkey" ? identity : null;
  // One signer per session, built once: the cards receive the function, not
  // the identity, so no card has to know how a session signs.
  const intentSigner = useMemo(
    () =>
      signIntentForSession({
        identity,
        account,
        signMessage,
        signNEP413,
      }),
    [identity, account, signMessage, signNEP413],
  );
  // A confidential swap payload is signed by the same session signer as a
  // withdrawal; the server only ever issues a WebAuthn string to a passkey
  // session, so the payload standard is fixed here.
  const swapSigner = useMemo(
    () =>
      passkeyIdentity
        ? (payload: string) =>
            intentSigner({ standard: "webauthn", payload })
        : null,
    [passkeyIdentity, intentSigner],
  );
  // The tool names an amount in the smallest unit; the sentence reads it in
  // whole units when the catalogue told us the exponent.
  const rawAmountLabel = (assetId: string, amount: string) => {
    const decimals = assetMeta.get(assetId)?.decimals;
    return decimals !== undefined ? formatRawAmount(amount, decimals) : amount;
  };

  // The unlock card ages on the message's own clock, so it behaves the same
  // live and after a reload (the loader maps messages.created_at here).
  const createdAt = (() => {
    const meta = message.metadata as { createdAt?: unknown } | undefined;
    if (
      typeof meta?.createdAt === "string" ||
      typeof meta?.createdAt === "number"
    ) {
      const parsed = new Date(meta.createdAt).getTime();
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return null;
  })();

  // A continuation turn carries the unlock confirmation on the message, so
  // the card can lead the reply without the model repeating it.
  const justUnlocked =
    (message.metadata as { superJustUnlocked?: unknown } | undefined)
      ?.superJustUnlocked === true;
  const approvals = collectApprovals(
    message,
    symbols,
    assetMeta,
    account?.address ?? null,
  );
  const withdrawals = collectWithdrawals(message, symbols, assetMeta);
  const withdrawalById = new Map(
    withdrawals.map((withdrawal) => [withdrawal.approvalId, withdrawal]),
  );
  const balanceViews = collectBalanceViews(message.parts);
  const balanceByCallId = new Map(balanceViews.map((b) => [b.callId, b]));
  const approvalById = new Map(approvals.map((a) => [a.approvalId, a]));

  // Part index each card was born at. The pill row for the same call keeps
  // its place in the trace; the card mounts directly after it.
  const balanceOrder = new Map<string, number>();
  const approvalOrder = new Map<string, number>();
  const depositOrder = new Map<string, number>();
  const withdrawalOrder = new Map<string, number>();
  const unlockOrder = new Map<string, number>();
  const depositById = new Map<
    string,
    { assetId: string; amount: string; part: ToolPart }
  >();
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
    if (toolNameOf(p) === "prepare_deposit") {
      const id = approvalIdOf(p);
      // Any state that still carries the approval id keeps the card: after
      // the tool executes the part is `output-available`, and the address
      // must stay visible rather than vanishing when the turn continues.
      if (id) {
        if (!depositById.has(id)) {
          const input = inputOf(p);
          depositById.set(id, {
            assetId: str(input.assetId) ?? "",
            amount: str(input.amount) ?? "",
            part: p,
          });
        }
        if (!depositOrder.has(id)) depositOrder.set(id, index);
      }
    }
    if (toolNameOf(p) === "prepare_withdrawal") {
      const id = approvalIdOf(p);
      // The card is a record of the decision; it stays after the tool
      // executes so the destination and the settlement remain visible.
      if (id && withdrawalById.has(id) && !withdrawalOrder.has(id)) {
        withdrawalOrder.set(id, index);
      }
    }
    if (
      (toolNameOf(p) === "request_super_unlock" ||
        toolNameOf(p) === "get_super_balances") &&
      typeof p.toolCallId === "string" &&
      (outputOf(p)?.needsSuperUnlock ?? false) === true
    ) {
      unlockOrder.set(p.toolCallId, index);
    }
  });

  type TimelineNode =
    | { kind: "blocks"; blocks: ActivityBlock[]; order: number }
    | { kind: "balance"; callId: string; order: number }
    | { kind: "approval"; approvalId: string; order: number }
    | { kind: "deposit"; approvalId: string; order: number }
    | { kind: "withdraw"; approvalId: string; order: number }
    | { kind: "unlock"; callId: string; order: number };

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
  for (const [approvalId, order] of depositOrder) {
    timeline.push({ kind: "deposit", approvalId, order });
  }
  for (const [approvalId, order] of withdrawalOrder) {
    timeline.push({ kind: "withdraw", approvalId, order });
  }
  for (const [callId, order] of unlockOrder) {
    timeline.push({ kind: "unlock", callId, order });
  }
  // Pills first on ties: the trace row for a call reads before its card.
  timeline.sort((a, b) => a.order - b.order);

  function renderBalance(callId: string) {
    const b = balanceByCallId.get(callId);
    if (!b) return null;
    // Name the wallet, not the network: the connected wallet's brand mark
    // when this card reads its own address, otherwise the queried chain's
    // mark from `chain`. An EVM-shaped Intents account read on NEAR keeps
    // the NEAR mark instead of flipping to EVM by address shape.
    const isSelf =
      !!account?.address &&
      !!b.address &&
      (account.address === b.address ||
        (b.address.startsWith("0x") &&
          account.address.toLowerCase() === b.address.toLowerCase()));
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
            <AddressPill
              address={b.address}
              chain={b.chain}
              walletIcon={isSelf ? (account?.walletIcon ?? undefined) : undefined}
              walletName={isSelf ? (account?.walletName ?? undefined) : undefined}
            />
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
    // A passkey card is the intents path, not a restyle: it has no wallet
    // signature to request, so "approved" means the signed intent is
    // submitted and the settlement is being read.
    const intentsState: SentenceCardState =
      a.status === "denied"
        ? "denied"
        : (snapState ?? (a.status === "approved" ? "processing" : "awaiting"));
    const walletState: SentenceCardState =
      a.status === "denied"
        ? "denied"
        : (snapState ?? (a.status === "approved" ? "submitted" : "awaiting"));
    const approve = (tx?: { transactionId: string; depositAddress: string }) => {
      if (tx) rememberApprovalTx(a.approvalId, tx);
      onApproval?.(a.approvalId, true);
    };
    const deny = () => {
      rememberApprovalDenied(a.approvalId);
      onApproval?.(a.approvalId, false);
    };
    return (
      <div key={a.approvalId} className="mt-2.5">
        <SentenceTradeCard
          // A passkey proposal is one signed confidential intent, which the
          // route submits as a swap. A wallet keeps the action it was given.
          action={passkeyIdentity ? "swap" : a.action}
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
          refundTo={a.refundTo}
          expiresAt={a.expiresAt}
          requestedAt={a.requestedAt}
          slippageBps={a.slippageBps}
          state={passkeyIdentity ? intentsState : walletState}
          transactionId={snap?.transactionId ?? a.transactionId}
          depositAddress={snap?.depositAddress ?? a.depositAddress ?? undefined}
          initialExplorerUrls={snap?.explorerUrls}
          swapInput={a.status === "awaiting" ? a.swapInput : undefined}
          runApproval={
            swapSigner
              ? swapApproval({
                  quoteId: a.swapInput?.quoteId ?? "",
                  approvalId: a.approvalId,
                  sign: swapSigner,
                })
              : undefined
          }
          disabled={
            a.status !== "awaiting" ||
            (passkeyIdentity !== null && !a.swapInput?.quoteId)
          }
          onApprove={approve}
          onDeny={deny}
        />
      </div>
    );
  }

  function renderDeposit(approvalId: string) {
    const entry = depositById.get(approvalId);
    if (!entry || !entry.assetId || !entry.amount) return null;
    // The deposit card is a record of the tool decision, not a new signature.
    // The record wins when it exists; otherwise the decision decides between
    // "the address has been issued and we are waiting" and "nothing yet".
    const snap = settlements?.[approvalId] ?? null;
    const partState = stateOf(entry.part);
    const decision = approvalDecision(entry.part);
    // The execute only runs after an approval, so its output is evidence the
    // decision was yes even when the part snapshot no longer says so.
    const executed =
      partState === "output-available" || partState === "output-error";
    // A timed-out workflow is not a failed deposit: the address keeps its
    // own deadline, and the card ages it out only if that deadline passed.
    const recordState = snap
      ? depositCardStateForRecord(snap.state, null, 0)
      : null;
    const state: SentenceCardState =
      decision === false || partState === "output-denied"
        ? "denied"
        : (recordState ??
          (decision === true || executed ? "waiting" : "awaiting"));
    const approve = (tx?: {
      transactionId: string;
      depositAddress: string;
    }) => {
      if (tx) rememberApprovalTx(approvalId, tx);
      onApproval?.(approvalId, true);
    };
    const deny = () => {
      rememberApprovalDenied(approvalId);
      onApproval?.(approvalId, false);
    };
    const symbol = assetName(entry.assetId, symbols);
    const amount = rawAmountLabel(entry.assetId, entry.amount);
    return (
      <div key={approvalId} className="mt-2.5">
        {/* A deposit has no signature to collect: the server mints the exact
            one-time address and the sender funds it from an exchange or
            another wallet. There is no wallet source clause for either kind
            of session, because the funds do not come from the connected one. */}
        <SentenceTradeCard
          action="deposit"
          approvalId={approvalId}
          fromSymbol={symbol}
          fromChain={assetMeta.get(entry.assetId)?.chain}
          toSymbol={symbol}
          toChain="near"
          amountIn={amount}
          amountOut={amount}
          recipient={identity?.intentsAccountId ?? ""}
          sender={null}
          approveLabel="Start"
          state={state}
          expiresAt={snap?.deposit?.expiresAt ?? undefined}
          transactionId={snap?.transactionId}
          depositAddress={snap?.depositAddress ?? undefined}
          depositMeta={snap?.deposit ?? undefined}
          initialExplorerUrls={snap?.explorerUrls}
          runApproval={depositApproval({
            assetId: entry.assetId,
            amount: entry.amount,
            approvalId,
          })}
          disabled={decision !== null}
          onApprove={approve}
          onDeny={deny}
          onRecord={(tx) => rememberApprovalTx(approvalId, tx)}
        />
      </div>
    );
  }

  // A withdrawal is one signed intent in every session kind: a passkey signs
  // the WebAuthn payload with its credential, a wallet signs with the standard
  // its chain uses. Either way the destination is the one the stored quote
  // normalised, never a model string.
  function renderWithdrawal(approvalId: string) {
    const withdrawal = withdrawalById.get(approvalId);
    if (!withdrawal) return null;
    const snap = settlements?.[approvalId] ?? null;
    const terminal = snap ? settlementCardState(snap.state) : null;
    const state: SentenceCardState =
      withdrawal.status === "denied"
        ? "denied"
        : (terminal ??
          (withdrawal.status === "approved" ? "processing" : "awaiting"));
    // The catalogue names the chain with a short slug. The card shows the
    // human chain name when the slug is one the product already knows.
    const chainSlug = withdrawal.destinationChain ?? withdrawal.toChain;
    const destinationChain = chainSlug
      ? (evmChainForSlug(chainSlug)?.name ?? chainSlug)
      : undefined;
    const amountLabel =
      withdrawal.amountIn ??
      rawAmountLabel(withdrawal.fromAssetId, withdrawal.amount);
    return (
      <div key={approvalId} className="mt-2.5">
        {/* The destination is the stored quote's, and the confidential
            deposit account is never passed: a withdrawal shows where the
            money lands, not the account the intent is signed against. */}
        <SentenceTradeCard
          action="withdraw"
          approvalId={approvalId}
          fromSymbol={withdrawal.fromSymbol}
          fromChain={withdrawal.fromChain}
          toSymbol={withdrawal.toSymbol}
          toChain={withdrawal.toChain}
          amountIn={amountLabel}
          amountOut={withdrawal.amountOut ?? amountLabel}
          minAmountOut={withdrawal.minAmountOut}
          recipient={withdrawal.destination ?? ""}
          destinationChain={destinationChain}
          fee={withdrawal.fee}
          expiresAt={withdrawal.expiresAt}
          state={state}
          transactionId={snap?.transactionId ?? withdrawal.transactionId}
          runApproval={withdrawalApproval({
            quoteId: withdrawal.quoteId ?? "",
            approvalId,
            sign: intentSigner,
          })}
          disabled={withdrawal.status !== "awaiting" || !withdrawal.quoteId}
          onApprove={() => onApproval?.(approvalId, true)}
          onDeny={() => onApproval?.(approvalId, false)}
        />
      </div>
    );
  }

  // The deterministic unlock prompt: fixed wording from the tool, one
  // button opening the dialog. The model only decided this was needed.
  function renderUnlock(callId: string) {
    return (
      <UnlockRequestCard
        key={`unlock-${callId}`}
        callId={callId}
        createdAt={createdAt}
        interactive={interactive}
        superseded={superseded}
        onRetry={onRetry}
      />
    );
  }

  // Copy follows the visual timeline, not the trace: prose first, then the
  // landmark cards the reader sees. Tool pills and thinking never enter the
  // transcript — see components/app/agentCopy.ts for the contract.
  const copySegments: AgentCopySegment[] = [];
  for (const node of timeline) {
    if (node.kind === "blocks") {
      for (const block of node.blocks) {
        if (block.kind === "text" && block.text.trim()) {
          copySegments.push({ kind: "text", text: block.text });
        }
      }
    } else if (node.kind === "unlock" || node.kind === "deposit" || node.kind === "withdraw") {
      // None of these cards carries a settlement to copy; prose already says it.
      continue;
    } else if (node.kind === "balance") {
      const view = balanceByCallId.get(node.callId);
      if (view) {
        copySegments.push({
          kind: "balance",
          view: {
            title: view.title,
            address: view.address,
            chain: view.chain,
            totalValueUsd: view.totalValueUsd,
            groups: view.groups,
          },
        });
      }
    } else {
      const approval = approvalById.get(node.approvalId);
      if (approval) {
        copySegments.push({
          kind: "approval",
          approval,
          settlement: settlements?.[approval.approvalId] ?? null,
        });
      }
    }
  }
  const copyText = running ? "" : buildAgentCopyText(copySegments);
  const copyHtml = running ? "" : buildAgentCopyHtml(copySegments);

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
        {justUnlocked ? <UnlockedCard /> : null}
        {timeline.map((node, i) => {
          if (node.kind === "balance") return renderBalance(node.callId);
          if (node.kind === "approval") return renderApproval(node.approvalId);
          if (node.kind === "deposit") return renderDeposit(node.approvalId);
          if (node.kind === "withdraw") return renderWithdrawal(node.approvalId);
          if (node.kind === "unlock") return renderUnlock(node.callId);
          return (
            <ActivityPills
              key={`blocks-${node.order}-${i}`}
              blocks={node.blocks}
              running={running && i === lastGroupIndex}
            />
          );
        })}
      </div>
      {copyText && !running && (
        <div className="mt-2.5">
          <AgentMessageActions
            text={stripAssetMarkup(replyText)}
            copyText={copyText}
            copyHtml={copyHtml}
            onRegenerate={onRegenerate}
          />
        </div>
      )}
    </article>
  );
},
(prev, next) =>
  prev.message === next.message &&
  prev.status === next.status &&
  prev.superseded === next.superseded &&
  prev.settlements === next.settlements &&
  prev.interactive === next.interactive,
);

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
    // A single-asset check carries its figure in the reply. The tool derives
    // this from the query shape, so an inventory question still draws the
    // table and the model never chooses whether the card appears.
    if (out.showCard === false) continue;
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
      // Every balance card carries the address it belongs to, so the reader
      // can relate the table to the wallet it was read from.
      address:
        typeof out.address === "string" && out.address.length > 0
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
    case "prepare_deposit": {
      const input = inputOf(part);
      const assetId = str(input.assetId) ?? "";
      const symbol = assetId ? assetName(assetId, symbols) : "deposit";
      const deposit: ToolStep = {
        icon: "write",
        label: "Proposed a deposit",
        chip: symbol,
        mono: true,
        detailMono: true,
        detail: [],
      };
      if (state === "approval-requested") {
        return { ...deposit, chip: "awaiting approval", mono: false };
      }
      if (state === "approval-responded" && approvalDecision(part) === false) {
        return { ...deposit, chip: "rejected", mono: false };
      }
      return deposit;
    }
    case "get_withdrawal_quote":
      return withdrawalQuoteRow(part, symbols);
    case "prepare_withdrawal": {
      const input = inputOf(part);
      const symbol = assetName(str(input.fromAssetId) ?? "", symbols);
      const withdrawal: ToolStep = {
        icon: "write",
        label: "Proposed a withdrawal",
        chip: symbol,
        mono: true,
        detailMono: true,
        detail: [],
      };
      if (state === "approval-requested") {
        return { ...withdrawal, chip: "awaiting approval", mono: false };
      }
      if (state === "approval-responded" && approvalDecision(part) === false) {
        return { ...withdrawal, chip: "rejected", mono: false };
      }
      return withdrawal;
    }
    case "get_transaction_status":
      return statusRow(part);
    case "get_transaction_history":
      return historyRow(part);
    case "get_super_balances":
      return superBalancesRow(part);
    case "request_super_unlock":
      return {
        icon: "write",
        label: "Super account",
        chip: "unlock needed",
        mono: false,
        detailMono: false,
        detail: [],
      };
    case "get_google_news":
    case "get_reddit_posts":
    case "get_x_posts":
    case "get_x_user_posts":
    case "get_crypto_news":
    case "get_market_news":
      return newsRow(name, part);
    case "get_page_content":
      return pageRow(part);
    default:
      return {
        icon: "run",
        label: "Used a tool",
        chip: name.replace(/_/g, " "),
        mono: false,
        detailMono: false,
        detail: [],
      };
  }
}

function iconFor(name: string): string {
  switch (name) {
    case "get_quote":
    case "get_withdrawal_quote":
    case "get_transaction_status":
      return "run";
    case "prepare_swap":
    case "prepare_deposit":
    case "prepare_withdrawal":
    case "request_super_unlock":
      return "write";
    case "get_google_news":
    case "get_reddit_posts":
    case "get_x_posts":
    case "get_x_user_posts":
    case "get_crypto_news":
    case "get_market_news":
    case "get_page_content":
      return "read";
    default:
      return "read";
  }
}

/** The label stays put while the call resolves, so the row never shifts
 * under the reader; the chip is the part that fills in. Labels are generic:
 * the tool used, never the query. */
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
    case "prepare_deposit":
      return "Proposed a deposit";
    case "get_withdrawal_quote":
      return "Priced a withdrawal";
    case "prepare_withdrawal":
      return "Proposed a withdrawal";
    case "get_transaction_status":
      return "Checked a trade";
    case "get_transaction_history":
      return "Listed trades";
    case "get_super_balances":
      return "Read private balance";
    case "request_super_unlock":
      return "Super account";
    case "get_google_news":
    case "get_crypto_news":
    case "get_market_news":
      return "Searching the web";
    case "get_reddit_posts":
    case "get_x_posts":
    case "get_x_user_posts":
      return "Searching social media";
    case "get_page_content":
      return "Reading articles";
    default:
      return "Used a tool";
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

function superBalancesRow(part: ToolPart): ToolStep {
  const output = outputOf(part);

  if (output.status === "locked") {
    return {
      icon: "write",
      label: "Read private balance",
      chip: "locked",
      mono: false,
      detailMono: false,
      detail: [],
    };
  }

  if (output.status === "error") {
    return {
      icon: "read",
      label: "Read private balance",
      chip: "unavailable",
      mono: false,
      detailMono: false,
      detail: [],
    };
  }

  const balances = Array.isArray(output.balances)
    ? (output.balances as Array<{
        symbol?: string;
        amount?: string;
        valueUsd?: number;
      }>)
    : [];

  if (balances.length > 0) {
    const lines: ToolDetailLine[] = balances.slice(0, 4).map((b) => ({
      text: `${b.symbol ?? "TOKEN"} · ${b.amount ?? "0"}`,
    }));
    if (balances.length > 4) {
      lines.push({ text: `+${balances.length - 4} more` });
    }
    return {
      icon: "read",
      label: "Read private balance",
      chip: `${balances.length} ${balances.length === 1 ? "token" : "tokens"}`,
      mono: false,
      detailMono: true,
      detail: lines,
    };
  }

  return {
    icon: "read",
    label: "Read private balance",
    chip: "empty",
    mono: false,
    detailMono: false,
    detail: [],
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

function withdrawalQuoteRow(
  part: ToolPart,
  symbols: Map<string, string>,
): ToolStep {
  const output = outputOf(part);
  const from = str(output.fromAssetId) ?? "";
  const to = str(output.toAssetId) ?? from;
  const fromSymbol = assetName(from, symbols);
  const toSymbol = assetName(to, symbols);
  const amountIn = str(output.amountIn);
  const amountOut = str(output.amountOut);
  const destination = str(output.destination);
  const fee = str(output.withdrawFeeFormatted);

  const detail: ToolDetailLine[] = [];
  if (amountIn && amountOut) {
    detail.push({
      text: `${formatNum(amountIn)} ${fromSymbol} → ${formatNum(amountOut)} ${toSymbol}`,
    });
  }
  if (fee) detail.push({ text: `Fee ${formatNum(fee)} ${fromSymbol}` });

  return {
    icon: "run",
    label: "Priced a withdrawal",
    chip:
      amountIn && destination
        ? `${formatNum(amountIn)} ${fromSymbol} to ${shortId(destination)}`
        : destination
          ? shortId(destination)
          : "a withdrawal",
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

function domainOf(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function newsItems(part: ToolPart): Array<{ title?: unknown }> {
  const output = outputOf(part);
  if (!Array.isArray(output.items)) return [];
  return output.items.filter(
    (item): item is { title?: unknown } =>
      typeof item === "object" && item !== null,
  );
}

function newsRow(name: string, part: ToolPart): ToolStep {
  const isWeb =
    name === "get_google_news" ||
    name === "get_crypto_news" ||
    name === "get_market_news";
  const label = isWeb ? "Searching the web" : "Searching social media";
  const emptyChip = isWeb ? "web" : "social";
  const items = newsItems(part);
  const done = items.length > 0;
  const detail: ToolDetailLine[] = items.slice(0, 4).map((item) => {
    const title = str(item.title);
    return { text: title ?? "Untitled" };
  });
  if (items.length > 4) detail.push({ text: `+${items.length - 4} more` });
  return {
    icon: "read",
    label,
    chip: done
      ? `${items.length} ${items.length === 1 ? "story" : "stories"}`
      : emptyChip,
    /* the chip is a source or count; headlines are prose */
    mono: false,
    detailMono: false,
    detail,
  };
}

function pageRow(part: ToolPart): ToolStep {
  const input = inputOf(part);
  const output = outputOf(part);
  // Batch shape: input.urls with output.pages and output.errors. Turns
  // stored before the batch change carry input.url with output.title, so
  // both render here rather than dropping history after a reload.
  const requested: string[] = Array.isArray(input.urls)
    ? input.urls.filter((u): u is string => typeof u === "string")
    : (() => {
        const single = str(input.url);
        return single ? [single] : [];
      })();
  const pages: Array<Record<string, unknown>> = Array.isArray(output.pages)
    ? output.pages.filter(
        (p): p is Record<string, unknown> =>
          typeof p === "object" && p !== null,
      )
    : (() => {
        const title = str(output.title);
        const publishedDate = str(output.publishedDate);
        const error = str(output.error);
        if (!title && !publishedDate && !error) return [];
        return [{ url: str(input.url), title, publishedDate, error }];
      })();
  const failures: Array<Record<string, unknown>> = Array.isArray(
    output.errors,
  )
    ? output.errors.filter(
        (e): e is Record<string, unknown> =>
          typeof e === "object" && e !== null,
      )
    : [];
  const total = pages.length + failures.length || requested.length;

  const detail: ToolDetailLine[] = [];
  for (const page of pages.slice(0, 4)) {
    const title = str(page.title);
    if (title) {
      detail.push({ text: title });
      continue;
    }
    const message = str(page.error);
    const domain = domainOf(str(page.url)) ?? "article";
    detail.push({
      text: message ? `${domain} — ${message.slice(0, 160)}` : domain,
    });
  }
  for (const entry of failures.slice(0, Math.max(0, 4 - detail.length))) {
    const domain =
      domainOf(str(entry.url)) ?? str(entry.url) ?? "article";
    const message = str(entry.error);
    detail.push({
      text: message ? `${domain} — ${message.slice(0, 160)}` : domain,
    });
  }
  // A lone page keeps its date line, as it always has; a batch stays one
  // line per page so eight results read as a list, not a wall.
  if (total === 1) {
    const publishedDate = str(pages[0]?.publishedDate);
    if (publishedDate) detail.push({ text: publishedDate });
  }
  if (detail.length === 0) {
    const topError = str(output.error);
    if (topError) detail.push({ text: topError.slice(0, 160) });
  }
  if (total > 4) detail.push({ text: `+${total - 4} more` });

  const singleDomain =
    total === 1
      ? (domainOf(str(pages[0]?.url) ?? requested[0] ?? null) ?? "article")
      : null;
  return {
    icon: "read",
    label: "Reading articles",
    chip: singleDomain ?? (total > 1 ? `${total} articles` : "article"),
    /* the domain is an identifier; titles and counts are prose */
    mono: singleDomain != null,
    detailMono: false,
    detail,
  };
}
