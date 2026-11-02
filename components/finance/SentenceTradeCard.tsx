"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconCopy, IconUserCircle, IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/atoms/Button";
import { StatusPill } from "@/components/atoms/StatusPill";
import { SpinnerRing } from "@/components/primitives/TaskRows";
import { TokenAvatar } from "@/components/finance/TokenAvatar";
import { NetworkIcon } from "@/components/finance/NetworkIcon";
import { useWallet } from "@/lib/wallet/registry";
import { toHex } from "@/lib/wallet/types";
import { networkDisplayName } from "@/lib/wallet/balances";
import { addressIdentity, shortAddr } from "@/lib/trade/identity";
import {
  APPROVAL_WINDOW_MS,
  buildTradeApprovalMessage,
  isApprovalWindowValid,
} from "@/lib/trade/approval-message";
import { actionTitle, type TradeAction } from "@/lib/trade/action";

export type SentenceCardState =
  | "awaiting"
  | "signing"
  | "submitting"
  | "submitted"
  | "settled"
  | "refunded"
  | "denied"
  | "expired"
  | "failed";

const TONE: Record<SentenceCardState, "neutral" | "accent" | "green" | "red" | "orange"> = {
  awaiting: "orange",
  signing: "accent",
  submitting: "accent",
  submitted: "accent",
  settled: "green",
  refunded: "neutral",
  denied: "red",
  expired: "red",
  failed: "red",
};

const LABEL: Record<SentenceCardState, string> = {
  awaiting: "Pending",
  signing: "Signing",
  submitting: "Approved",
  submitted: "Approved",
  settled: "Executed",
  refunded: "Refunded",
  denied: "Rejected",
  expired: "Expired",
  failed: "Failed",
};

/**
 * The sentence approval card.
 *
 * One sentence carries the proposal, built deterministically from the signed
 * parameters — never from model text. The drawer holds everything needed to
 * verify but not to decide, and the footer carries the decision: buttons
 * while awaiting, the status badge in their place after.
 */
export default function SentenceTradeCard({
  action = "swap",
  fromSymbol,
  fromChain,
  toSymbol,
  toChain,
  amountIn,
  amountOut,
  amountOutUsd,
  fromPriceUsd,
  toPriceUsd,
  minAmountOut,
  minAmountOutRaw,
  recipient,
  expiresAt,
  slippageBps,
  requestedAt,
  state = "awaiting",
  depositAddress,
  transactionId,
  swapInput,
  conversationId,
  disabled = false,
  onApprove,
  onDeny,
}: {
  action?: TradeAction;
  fromSymbol: string;
  fromChain?: string;
  toSymbol: string;
  toChain?: string;
  amountIn: string;
  amountInUsd?: string;
  amountOut: string;
  amountOutUsd?: string;
  /** Current unit price of each side, when the catalogue priced it. */
  fromPriceUsd?: string;
  toPriceUsd?: string;
  minAmountOut?: string;
  /** Raw smallest-unit minimum, bound by the wallet signature. */
  minAmountOutRaw?: string;
  recipient: string;
  expiresAt?: string;
  /** Slippage tolerance the approval was quoted with, in basis points. */
  slippageBps?: number;
  /** Card birth, from the host message. Approvals older than the window expire. */
  requestedAt?: string;
  state?: SentenceCardState;
  depositAddress?: string;
  transactionId?: string;
  swapInput?: {
    fromAssetId: string;
    toAssetId: string;
    amount: string;
    recipient: string;
    slippageBps?: number;
  };
  conversationId?: string | null;
  disabled?: boolean;
  onApprove?: (tx?: { transactionId: string; depositAddress: string }) => void;
  onDeny?: () => void;
}) {
  const { account, signMessage, signNEP413 } = useWallet();
  const [txState, setTxState] = useState<SentenceCardState>(state);
  const [txId, setTxId] = useState<string | undefined>(transactionId);
  const [deposit, setDeposit] = useState<string | undefined>(depositAddress);
  const [explorerUrls, setExplorerUrls] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Quoted figures are local so a moved price can refresh the card in
  // place; props win whenever the turn produces a new quote.
  const [figures, setFigures] = useState({
    amountOut,
    amountOutUsd,
    minAmountOut,
    minAmountOutRaw,
    expiresAt,
  });
  useEffect(() => setTxState(state), [state]);
  useEffect(() => setTxId(transactionId), [transactionId]);
  useEffect(() => setDeposit(depositAddress), [depositAddress]);
  useEffect(() => {
    setFigures({ amountOut, amountOutUsd, minAmountOut, minAmountOutRaw, expiresAt });
  }, [amountOut, amountOutUsd, minAmountOut, minAmountOutRaw, expiresAt]);

  // An untouched card expires on its own clock so every render — live,
  // revisited, or reloaded — agrees. One precisely-timed flip, no ticker.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (txState !== "awaiting" || !requestedAt) return;
    const remaining =
      Date.parse(requestedAt) + APPROVAL_WINDOW_MS - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setClock(Date.now()), remaining + 250);
    return () => clearTimeout(timer);
  }, [txState, requestedAt]);
  const expired =
    txState === "awaiting" &&
    !!requestedAt &&
    !isApprovalWindowValid(requestedAt, clock);
  // The rendered state: an untouched card past its window reads expired
  // on every surface, live or reloaded, with no ticker running.
  const viewState: SentenceCardState = expired ? "expired" : txState;

  // After submission the card polls its own record, so a refresh keeps
  // showing the settlement rather than a stale approval.
  useEffect(() => {
    if (!txId) return;
    if (txState !== "submitted" && txState !== "submitting") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tx/${encodeURIComponent(txId)}`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          state?: string;
          outcome?: { explorerUrls?: unknown };
        };
        if (cancelled || !body.state) return;
        if (body.state === "settled") setTxState("settled");
        else if (body.state === "refunded") setTxState("refunded");
        else if (body.state === "failed") setTxState("failed");
        else setTxState("submitted");
        const urls = body.outcome?.explorerUrls;
        if (Array.isArray(urls)) {
          setExplorerUrls(
            urls.filter((u): u is string => typeof u === "string").slice(0, 2),
          );
        }
      } catch {
        // Next tick retries.
      }
    };
    const timer = setInterval(tick, 4000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [txId, txState]);

  const handleApprove = async () => {
    if (!swapInput) {
      onApprove?.();
      return;
    }
    if (expired) {
      setSubmitError("That approval expired. Ask for a fresh quote.");
      return;
    }
    if (!account) {
      setSubmitError("Connect a wallet first.");
      return;
    }
    if (!figures.minAmountOutRaw || !figures.expiresAt) {
      setSubmitError("Ask for a fresh quote first.");
      return;
    }
    setSubmitError(null);

    // The wallet signs the exact parameters. Nothing is submitted until
    // the signature exists, and the server rechecks every field it covers.
    const slippageBps = swapInput.slippageBps ?? 100;
    const message = buildTradeApprovalMessage({
      fromAssetId: swapInput.fromAssetId,
      toAssetId: swapInput.toAssetId,
      amount: swapInput.amount,
      recipient: swapInput.recipient,
      slippageBps,
      minAmountOut: figures.minAmountOutRaw,
      expiresAt: figures.expiresAt,
      requestedAt: requestedAt ?? new Date().toISOString(),
    });

    setTxState("signing");
    let auth: {
      signature: string;
      publicKey?: string;
      recipientField?: string;
      nonce?: string;
    };
    try {
      auth = await signTrade(message);
    } catch {
      setTxState("awaiting");
      setSubmitError("Signature was rejected. Nothing was submitted.");
      return;
    }

    setTxState("submitting");
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...swapInput,
          slippageBps,
          minAmountOut: figures.minAmountOutRaw,
          expiresAt: figures.expiresAt,
          requestedAt: requestedAt ?? new Date().toISOString(),
          message,
          ...auth,
          conversationId,
        }),
      });
      if (res.status === 409) {
        const moved = (await res.json().catch(() => null)) as {
          message?: string;
          fresh?: {
            amountOut: string;
            minAmountOut: string;
            minAmountOutRaw: string;
            expiresAt: string;
          };
        } | null;
        if (moved?.fresh) setFigures((f) => ({ ...f, ...moved.fresh }));
        setTxState("awaiting");
        setSubmitError(moved?.message ?? "The price moved. Review the new figures.");
        return;
      }
      if (res.status === 401) {
        setTxState("awaiting");
        setSubmitError("The signature was rejected. Nothing was submitted.");
        return;
      }
      if (!res.ok) throw new Error("submit failed");
      const body = (await res.json()) as {
        transactionId: string;
        depositAddress: string;
      };
      setTxId(body.transactionId);
      setDeposit(body.depositAddress);
      setTxState("submitted");
      onApprove?.({
        transactionId: body.transactionId,
        depositAddress: body.depositAddress,
      });
    } catch {
      setTxState("awaiting");
      setSubmitError("The trade could not start. Please try again.");
    }
  };

  async function signTrade(message: string): Promise<{
    signature: string;
    publicKey?: string;
    recipientField?: string;
    nonce?: string;
  }> {
    if (!account) throw new Error("no-wallet");
    if (account.kind === "near") {
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
      const recipientField =
        typeof window !== "undefined" ? window.location.origin : "";
      const signed = await signNEP413({
        message,
        recipient: recipientField,
        nonce: nonceBytes,
      });
      return {
        signature: signed.signature,
        publicKey: signed.publicKey,
        recipientField,
        nonce: toHex(nonceBytes),
      };
    }
    const signatureBytes = await signMessage(new TextEncoder().encode(message));
    return {
      signature:
        account.kind === "evm" ? `0x${toHex(signatureBytes)}` : toHex(signatureBytes),
    };
  }

  const handleDeny = () => {
    setTxState("denied");
    onDeny?.();
  };

  const busy =
    txState === "signing" || txState === "submitting" || txState === "submitted";
  const awaiting = viewState === "awaiting";

  const rate = rateOf(amountIn, figures.amountOut);
  const senderAddress = account?.address;
  const senderIdentity = senderAddress
    ? addressIdentity(account, senderAddress, fromChain)
    : null;
  const recipientIdentity = addressIdentity(account, recipient, toChain);

  // Hover detail cards: one open at a time per card, so a single timer and
  // a single previous-open record cover every chip.
  const [openId, setOpenId] = useState<string | null>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusOpened = useRef(false);
  const prevOpen = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [popupEl, setPopupEl] = useState<HTMLDivElement | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  useEffect(() => {
    prevOpen.current = openId;
  }, [openId ]);
  const cancelHoverTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const hoverSoon = (id: string) => {
    cancelHoverTimer();
    // Switching between open chips skips the delay, after the tooltip
    // rule: the first appearance waits, the rest are instant.
    if (openId !== null) {
      setOpenId(id);
      return;
    }
    closeTimer.current = setTimeout(() => setOpenId(id), 120);
  };
  const hoverAway = () => {
    cancelHoverTimer();
    closeTimer.current = setTimeout(() => setOpenId(null), 150);
  };
  const registerAnchor = useCallback((id: string, el: HTMLElement | null) => {
    if (el) anchors.current.set(id, el);
    else anchors.current.delete(id);
  }, []);
  const closePopup = useCallback(() => setOpenId(null), []);
  const hoverPopup = useCallback(
    (hovering: boolean) => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      if (!hovering) {
        closeTimer.current = setTimeout(() => setOpenId(null), 150);
      }
    },
    [],
  );
  // The popup portals to the body, outside this root, so blur only closes
  // when focus leaves both the sentence and the open card.
  const sentenceBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (rootRef.current?.contains(next)) return;
    if (popupEl?.contains(next)) return;
    setOpenId(null);
  };
  const hover = (id: string, chip: React.ReactNode) => (
    <HoverChip
      id={id}
      open={openId === id}
      chip={chip}
      register={registerAnchor}
      focusOpened={focusOpened}
      onEnter={hoverSoon}
      onLeave={hoverAway}
      onFocusChip={(cid) => setOpenId(cid)}
      onToggle={(cid, isOpen) => setOpenId(isOpen ? null : cid)}
      onEscape={closePopup}
    />
  );
  const instant =
    prevOpen.current !== null && prevOpen.current !== openId;
  const popup: {
    label: string;
    height: number;
    body: React.ReactNode;
  } | null =
    openId === "venue" ? (
      {
        label: "Near Account details",
        height: 150,
        body: <VenuePopup address={account?.address} />,
      }
    ) : openId === "token-from" ? (
      {
        label: `${fromSymbol} details`,
        height: 140,
        body: (
          <TokenPopup
            symbol={fromSymbol}
            chain={fromChain}
            price={fromPriceUsd}
          />
        ),
      }
    ) : openId === "token-to" ? (
      {
        label: `${toSymbol} details`,
        height: 140,
        body: (
          <TokenPopup symbol={toSymbol} chain={toChain} price={toPriceUsd} />
        ),
      }
    ) : openId === "sender" && senderIdentity ? (
      {
        label: "Wallet details",
        height: 120,
        body: (
          <AddressPopup
            address={senderIdentity.address}
            isSelf={senderIdentity.isSelf}
            name={account?.walletName}
            icon={account?.walletIcon}
          />
        ),
      }
    ) : openId === "recipient" ? (
      {
        label: "Address details",
        height: 120,
        body: (
          <AddressPopup
            address={recipient}
            isSelf={recipientIdentity.isSelf}
            name={account?.walletName}
            icon={account?.walletIcon}
          />
        ),
      }
    ) : null;
  // The sentence renders the action it is given; classification lives
  // upstream in collectApprovals.
  const verb = actionTitle(action);
  // The sentence is a deterministic template over the signed parameters.
  // figures.amountOut (not the prop) so a re-quote refreshes it in place.
  const sentence =
    action === "deposit" ? (
      <>
        Send <Amount>{amountIn}</Amount>{" "}
        {hover(
          "token-from",
          <TokenChip symbol={fromSymbol} badge={fromChain} />,
        )}{" "}
        from{" "}
        {senderIdentity ? (
          hover(
            "sender",
            <AddressChip
              label={senderIdentity.label}
              icon={senderIdentity.icon}
            />,
          )
        ) : (
          <AddressChip label="your wallet" />
        )}{" "}
        to your {hover("venue", <VenueChip label="Near Account" />)}
      </>
    ) : action === "withdraw" ? (
      <>
        {verb} <Amount>{amountIn}</Amount>{" "}
        {hover(
          "token-from",
          <TokenChip symbol={fromSymbol} badge={fromChain} />,
        )}{" "}
        to{" "}
        {hover(
          "recipient",
          <AddressChip
            label={recipientIdentity.label}
            icon={recipientIdentity.icon}
          />,
        )}
      </>
    ) : (
      <>
        {verb} <Amount>{amountIn}</Amount>{" "}
        {hover(
          "token-from",
          <TokenChip symbol={fromSymbol} badge={fromChain} />,
        )}{" "}
        for <Amount>{figures.amountOut}</Amount>{" "}
        {hover(
          "token-to",
          <TokenChip symbol={toSymbol} badge={toChain} />,
        )}{" "}
        on {hover("venue", <VenueChip label="Near Account" />)}
      </>
    );

  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div
        className="primitive-card-pad"
        style={{ paddingTop: 14, paddingBottom: 14 }}
      >
        {/* A div, not a p: TokenAvatar and NetworkIcon render div roots,
            which cannot descend from a paragraph without a hydration error. */}
        <div
          ref={rootRef}
          data-sentence
          onBlur={sentenceBlur}
          className="text-[15px] leading-[2] text-ink [text-wrap:pretty]"
        >
          {sentence}
        </div>
      </div>
      {popup && openId ? (
        <Popup
          anchor={anchors.current.get(openId) ?? null}
          label={popup.label}
          height={popup.height}
          instant={instant}
          dialogRef={setPopupEl}
          onClose={closePopup}
          onHoverChange={hoverPopup}
        >
          {popup.body}
        </Popup>
      ) : null}

      {submitError ? (
        <div
          className="primitive-card-pad"
          style={{ paddingTop: 0, paddingBottom: 6 }}
        >
          <p className="text-xs text-red">{submitError}</p>
        </div>
      ) : null}

      {/* details drawer — the primitive's expanding section */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: detailsOpen ? "1fr" : "0fr",
          opacity: detailsOpen ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-line bg-surface px-3.5 py-2">
            {figures.minAmountOut ? (
              <DetailRow label="Minimum received">
                {figures.minAmountOut} {toSymbol}
              </DetailRow>
            ) : null}
            <DetailRow label="Recipient">
              <span className="inline-flex min-w-0 items-center">
                <span className="truncate">{shortAddr(recipient)}</span>
                <CopyButton value={recipient} />
              </span>
            </DetailRow>
            {rate ? (
              <DetailRow label="Rate">
                1 {fromSymbol} ≈ {rate} {toSymbol}
              </DetailRow>
            ) : null}
            <DetailRow label="Slippage">
              {((slippageBps ?? swapInput?.slippageBps ?? 100) / 100).toFixed(2)}%
            </DetailRow>
            {deposit ? (
              <DetailRow label="Deposit to">
                <span className="break-all">{deposit}</span>
              </DetailRow>
            ) : null}
            {figures.expiresAt ? (
              <DetailRow label="Price held until">
                {new Date(figures.expiresAt).toLocaleTimeString()}
              </DetailRow>
            ) : null}
            {explorerUrls.length > 0 ? (
              <DetailRow label="Settlement">
                <span className="flex flex-col items-end gap-0.5">
                  {explorerUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-ink hover:underline"
                    >
                      View on explorer
                    </a>
                  ))}
                </span>
              </DetailRow>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className="primitive-card-footer flex items-center justify-between gap-3 bg-surface"
        style={{ paddingTop: 6, paddingBottom: 6 }}
      >
        <span className="-ml-0.5 flex shrink-0 items-center">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((current) => !current)}
            className="px-2.5 text-xs"
          >
            Details
          </Button>
        </span>

        <span
          key={viewState}
          className="-mr-0.5 flex min-w-0 items-center gap-2"
          style={{
            animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both",
          }}
        >
          {awaiting && !disabled ? (
            <>
              <Button variant="secondary" size="sm" onClick={handleDeny}>
                Reject
              </Button>
              <Button variant="accent" size="sm" onClick={handleApprove}>
                Approve
              </Button>
            </>
          ) : (
            <>
              {busy ? <SpinnerRing active size={18} /> : null}
              <StatusPill tone={TONE[viewState]}>
                {LABEL[viewState]}
              </StatusPill>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function Amount({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold tabular-nums text-ink">{children}</strong>
  );
}

/* Chips are inline-block so the label stays in normal text flow and keeps
 * the sentence baseline exactly; only the icon is lifted with align-middle.
 * Every chip reads at the sentence size by inheritance — no font-size of
 * its own — so the sentence scans as one line of text. */
function TokenChip({
  symbol,
  badge,
}: {
  symbol: string;
  badge?: string;
}) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-baseline font-medium leading-none text-ink">
      <span aria-hidden="true" className="mr-[0.4em] inline-block align-middle">
        <TokenAvatar symbol={symbol} networkBadge={badge} size={18} />
      </span>
      {symbol}
    </span>
  );
}

function VenueChip({ label }: { label: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-field py-[0.25em] pl-[0.25em] pr-[0.7em] align-baseline font-medium leading-none text-ink">
      <span aria-hidden="true" className="mr-[0.4em] inline-block align-middle">
        <NetworkIcon network="near" size={18} />
      </span>
      {label}
    </span>
  );
}

function AddressChip({ label, icon }: { label: string; icon?: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-field px-[0.625em] py-[0.25em] align-baseline font-medium leading-none text-ink">
      {/* align-middle centers on the x-height middle, which reads low next
          to caps, so the mark lifts a tenth of an em to the cap middle. */}
      <span
        aria-hidden="true"
        className="relative -top-[0.1em] mr-[0.4em] inline-block align-middle"
      >
        {icon ? (
          <BrandMark src={icon} />
        ) : (
          <IconWallet size={18} stroke={2} className="text-ink-2" />
        )}
      </span>
      {label}
    </span>
  );
}

/* Brand-mark optical centering. Wallet icons arrive with arbitrary
 * transparent padding, so the visible glyph can sit far from its box
 * center while the box itself is correctly placed. Measuring the ink
 * bounds once per source and translating the glyph centers it for every
 * wallet. Transform-only: layout never moves, so pill heights — driven by
 * the fixed 18px box — stay identical across chips. Anything unmeasurable
 * (tainted canvas, odd sizes, SSR) renders uncorrected. */

type InkCorrection = { x: number; y: number };

const inkCache = new Map<string, InkCorrection | null>();

/** Translate needed to center ink of bbox in a square box, or null when
 * the art is already centered within half a pixel. */
export function inkCorrection(
  natural: number,
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  box: number,
): InkCorrection | null {
  if (!Number.isFinite(natural) || natural <= 0) return null;
  const k = box / natural;
  const dx = -(((bbox.minX + bbox.maxX + 1) / 2 - natural / 2) * k);
  const dy = -(((bbox.minY + bbox.maxY + 1) / 2 - natural / 2) * k);
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  const quantize = (v: number) => Math.round(v * 2) / 2 + 0;
  return { x: quantize(dx), y: quantize(dy) };
}

function measureInk(src: string, box: number): Promise<InkCorrection | null> {
  const key = `${src}@${box}`;
  const hit = inkCache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const done = (value: InkCorrection | null) => {
      inkCache.set(key, value);
      resolve(value);
    };
    try {
      if (typeof Image === "undefined" || typeof document === "undefined") {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const W = img.naturalWidth;
          const H = img.naturalHeight;
          if (!W || !H || W !== H) return done(null);
          const cv = document.createElement("canvas");
          cv.width = W;
          cv.height = H;
          const ctx = cv.getContext("2d");
          if (!ctx) return done(null);
          ctx.drawImage(img, 0, 0);
          const px = ctx.getImageData(0, 0, W, H).data;
          let minX = W,
            maxX = -1,
            minY = H,
            maxY = -1;
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              if (px[(y * W + x) * 4 + 3] > 12) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxX < 0) return done(null);
          done(inkCorrection(W, { minX, maxX, minY, maxY }, box));
        } catch {
          // Tainted canvas or raster failure: render uncorrected.
          done(null);
        }
      };
      img.onerror = () => done(null);
      img.src = src;
    } catch {
      done(null);
    }
  });
}

function BrandMark({ src, size = 18 }: { src: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const [shift, setShift] = useState<InkCorrection | null>(null);
  if (failed) {
    return <IconWallet size={size} stroke={2} className="text-ink-2" />;
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      onLoad={(e) => {
        const el = e.currentTarget;
        void measureInk(el.currentSrc || src, size).then(setShift);
      }}
      className="block rounded-full object-contain"
      style={{
        width: size,
        height: size,
        ...(shift
          ? { transform: `translate(${shift.x}px, ${shift.y}px)` }
          : null),
      }}
    />
  );
}

/* Hover detail cards. One open at a time; the popup portals to the body so
 * no ancestor — inline wrapper, card with overflow-hidden, or stacking
 * context — can trap it or reflow the sentence. As a child of the inline
 * wrapper the fixed card would split the inline box and move the words
 * around it; outside the flow it cannot. */
/* Line-aware placement helpers. The sentence lays out in known line boxes;
 * the popup asks which visual line its chip sits on and prefers a side from
 * that — first and middle lines open above, the last line below — with
 * viewport fit holding a veto over both. */

/** Visual line tops of a sentence container, clustered so chip fragments
 * sitting a pixel or two off the text baseline do not fake extra lines. */
function sentenceLineTops(root: Element): number[] {
  const range = document.createRange();
  range.selectNodeContents(root);
  const tops = [...range.getClientRects()]
    .map((b) => Math.round(b.top))
    .sort((a, b) => a - b);
  const lines: number[] = [];
  for (const top of tops) {
    if (lines.length === 0 || top - lines[lines.length - 1] > 4) {
      lines.push(top);
    }
  }
  return lines;
}

/** Index of the line holding a vertical center, tolerant of sub-pixel tops. */
export function locateLineIndex(lineTops: number[], centerY: number): number {
  let index = 0;
  lineTops.forEach((top, i) => {
    if (top <= centerY + 1) index = i;
  });
  return index;
}

/** Preferred side first, viewport fit second. A side that fits nowhere
 * still loses to one that fits; when neither fits the legacy side wins. */
export function resolveAbove(
  prefersAbove: boolean,
  fitsAbove: boolean,
  fitsBelow: boolean,
): boolean {
  if (prefersAbove) return fitsAbove || !fitsBelow;
  return !fitsBelow && fitsAbove;
}

function HoverChip({
  id,
  open,
  chip,
  register,
  focusOpened,
  onEnter,
  onLeave,
  onFocusChip,
  onToggle,
  onEscape,
}: {
  id: string;
  open: boolean;
  chip: React.ReactNode;
  register: (id: string, el: HTMLElement | null) => void;
  focusOpened: React.RefObject<boolean>;
  onEnter: (id: string) => void;
  onLeave: () => void;
  onFocusChip: (id: string) => void;
  onToggle: (id: string, isOpen: boolean) => void;
  onEscape: () => void;
}) {
  return (
    <span
      ref={(el) => {
        register(id, el);
      }}
      tabIndex={0}
      aria-expanded={open}
      className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onMouseEnter={() => onEnter(id)}
      onMouseLeave={onLeave}
      onFocus={() => {
        // A click trails its own focus-open and must not toggle straight
        // back shut; keyboard clicks carry no detail count and still toggle.
        focusOpened.current = true;
        onFocusChip(id);
      }}
      onClick={(e) => {
        if (e.detail !== 0 && focusOpened.current) {
          focusOpened.current = false;
          return;
        }
        focusOpened.current = false;
        onToggle(id, open);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onEscape();
      }}
    >
      {chip}
    </span>
  );
}

function Popup({
  anchor,
  label,
  height,
  instant,
  dialogRef,
  onClose,
  onHoverChange,
  children,
}: {
  anchor: HTMLElement | null;
  label: string;
  /** Estimated popup height, used only to pick which side it opens on. */
  height: number;
  /** True when switching from another open card: no entrance animation. */
  instant: boolean;
  dialogRef: (el: HTMLDivElement | null) => void;
  onClose: () => void;
  onHoverChange: (hovering: boolean) => void;
  children: React.ReactNode;
}) {
  const [box, setBox] = useState<
    { x: number; top?: number; bottom?: number; origin: string } | null
  >(null);

  useEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = 248;
    const x = Math.min(
      Math.max(8, r.left + r.width / 2 - w / 2),
      window.innerWidth - w - 8,
    );
    // Line-aware placement: first-line and middle-line chips open above,
    // last-line chips below — whenever the viewport allows. A lone line
    // counts as first.
    const root = anchor.closest("[data-sentence]");
    const tops = root ? sentenceLineTops(root) : [];
    const index = locateLineIndex(tops, (r.top + r.bottom) / 2);
    const prefersAbove =
      tops.length === 0 ? false : index === 0 || index < tops.length - 1;
    const fitsAbove = r.top - 8 - height > 8;
    const fitsBelow = r.bottom + 8 + height < window.innerHeight;
    const above = resolveAbove(prefersAbove, fitsAbove, fitsBelow);
    // Origin-aware entrance, after the wallet menu: the card scales from
    // the chip, not from its own center — the vertical edge faces the
    // trigger, and the horizontal point tracks the chip's center, clamped
    // into the card when the viewport pushes it aside.
    const chipCenter = r.left + r.width / 2;
    const originX = Math.min(Math.max(((chipCenter - x) / w) * 100, 0), 100);
    const origin = `${originX.toFixed(1)}% ${above ? "100%" : "0%"}`;
    setBox(
      above
        ? { x, bottom: window.innerHeight - r.top + 8, origin }
        : { x, top: r.bottom + 8, origin },
    );
  }, [anchor, height]);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  if (!box) return null;
  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={label}
      className="rounded-card bg-surface p-3 shadow-card"
      style={{
        position: "fixed",
        left: box.x,
        width: 248,
        zIndex: 50,
        ...(box.bottom != null ? { bottom: box.bottom } : { top: box.top }),
        // Wallet menu entrance: pop-in from 95% scale with the strong
        // ease-out, never from nothing. Instant when switching between
        // open cards. Reduced-motion users get the global instant
        // collapse for free.
        animation: instant
          ? "none"
          : "pop-in 180ms var(--ease-out-strong) both",
        transformOrigin: box.origin,
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function TokenPopup({
  symbol,
  chain,
  price,
}: {
  symbol: string;
  chain?: string;
  price?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <TokenAvatar symbol={symbol} networkBadge={chain} size={24} />
        <div>
          <p className="text-sm font-medium leading-tight text-ink">{symbol}</p>
          {chain ? (
            <p className="text-xs text-ink-3">{networkDisplayName(chain)}</p>
          ) : null}
        </div>
      </div>
      {price ? <PopupRow label="Price">{price}</PopupRow> : null}
    </div>
  );
}

/* Identity marker: the green pill with a matching user glyph. */
export function YouPill() {
  return (
    <StatusPill tone="green">
      <span className="inline-flex items-center gap-1">
        <IconUserCircle size={13} stroke={2} aria-hidden="true" />
        You
      </span>
    </StatusPill>
  );
}

export function AddressPopup({
  address,
  isSelf,
  name,
  icon,
}: {
  address: string;
  isSelf: boolean;
  name?: string;
  icon?: string;
}) {
  return (
    <div>
      <div className="flex justify-center pb-2">
        {isSelf ? (
          <YouPill />
        ) : (
          <StatusPill tone="accent">External Address</StatusPill>
        )}
      </div>
      {isSelf ? (
        <p className="text-center text-xs text-ink-2">Connected wallet</p>
      ) : null}
      <div className="my-2 border-t border-line" aria-hidden="true" />
      {isSelf && name ? (
        <PopupRow label="Wallet">
          {icon ? (
            <BrandMark src={icon} size={16} />
          ) : (
            <IconWallet size={14} stroke={2} className="text-ink-2" />
          )}
          <span>{name}</span>
        </PopupRow>
      ) : null}
      <PopupRow label="Address">
        <span className="inline-flex min-w-0 items-center">
          <span className="truncate">{shortAddr(address)}</span>
          <CopyButton value={address} />
        </span>
      </PopupRow>
    </div>
  );
}

export function VenuePopup({ address }: { address?: string }) {
  return (
    <div>
      <div className="flex justify-center pb-2">
        <YouPill />
      </div>
      <p className="text-center text-xs text-ink-2">Near Account</p>
      <div className="my-2 border-t border-line" aria-hidden="true" />
      <PopupRow label="Type">Near Intents</PopupRow>
      <PopupRow label="Contract">intents.near</PopupRow>
      {address ? (
        <PopupRow label="Address">
          <span className="inline-flex min-w-0 items-center">
            <span className="truncate">{shortAddr(address)}</span>
            <CopyButton value={address} />
          </span>
        </PopupRow>
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-ink-3">{label}</span>
      <span className="min-w-0 text-right text-xs tabular-nums text-ink">
        {children}
      </span>
    </div>
  );
}

/* Popup rows center instead of baselining. Popup values hold image marks,
 * icon glyphs, and truncating addresses — an image bottom edge or an
 * overflow bottom edge hijacks an inline baseline and floats the text
 * above the label. Same-size text centered on itself aligns exactly, so
 * the drawer keeps DetailRow and only popups use this. */
function PopupRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-ink-3">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 text-right text-xs tabular-nums text-ink">
        {children}
      </span>
    </div>
  );
}

/** Whole units out per unit in, from the formatted figures. */
function rateOf(amountIn: string, amountOut: string): string | null {
  const rate = Number(amountOut) / Number(amountIn);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return String(Number(rate.toPrecision(4)));
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  /* Same crossfade as the wallet menu: the copy mark blurs and shrinks
   * out while the green check blurs and grows in. */
  const swap =
    "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), filter 240ms cubic-bezier(0.16, 1, 0.3, 1), transform 240ms cubic-bezier(0.16, 1, 0.3, 1)";
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy address"}
      title={copied ? "Copied" : "Copy address"}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard unavailable; the address stays visible to copy by hand.
          }
        })();
      }}
      className="relative ml-1 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
    >
      <span
        aria-hidden={copied}
        className="absolute inset-0 flex items-center justify-center"
        style={{
          opacity: copied ? 0 : 1,
          filter: copied ? "blur(2.5px)" : "blur(0px)",
          transform: copied ? "scale(0.85)" : "scale(1)",
          pointerEvents: copied ? "none" : "auto",
          transition: swap,
          willChange: "transform, opacity, filter",
        }}
      >
        <IconCopy size={13} stroke={1.8} strokeWidth={1.8} />
      </span>
      <span
        aria-hidden={!copied}
        className="absolute inset-0 flex items-center justify-center text-green"
        style={{
          opacity: copied ? 1 : 0,
          filter: copied ? "blur(0px)" : "blur(2.5px)",
          transform: copied ? "scale(1)" : "scale(0.85)",
          pointerEvents: copied ? "auto" : "none",
          transition: swap,
          willChange: "transform, opacity, filter",
        }}
      >
        <IconCheck size={13} stroke={2.6} strokeWidth={2.6} />
      </span>
    </button>
  );
}
