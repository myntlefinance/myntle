/**
 * The lab catalogue.
 *
 * A prototype is a file in `components/lab/samples/`. Adding one to this list
 * is the only wiring it needs.
 *
 * The lab lives on its own route and nothing in the application imports these
 * files, so a prototype cannot break the product. When one is right, copy the
 * source out of the frame and into `components/finance/`.
 */
export type LabEntry = {
  /** Used for the anchor and the file name */
  id: string;
  title: string;
  /** One sentence on what the prototype is for */
  caption: string;
  /** File name inside `components/lab/samples/` */
  file: string;
  /** The variants to render */
  variants?: string[];
  /** Layout of variants: 'row' (side by side) or 'stack' (one card per row) */
  layout?: "row" | "stack";
};

export const LAB: LabEntry[] = [
  {
    id: "action-button",
    title: "Action button",
    caption:
      "A button with the three weights the product needs, checked against the approval flow where the primary action has to be unmistakable.",
    file: "ActionButton.tsx",
    variants: ["Primary", "Secondary", "Ghost", "Danger"],
    layout: "row",
  },
  {
    id: "quote-preview",
    title: "Quote preview",
    caption:
      "A draft of the quote card, working out which numbers belong on screen and which are padding.",
    file: "QuotePreview.tsx",
    variants: ["Default", "Compact"],
    layout: "stack",
  },
  {
    id: "approval-row",
    title: "Approval row",
    caption:
      "How the destination, the amount and the deadline read together at the moment a user decides.",
    file: "ApprovalRow.tsx",
    variants: ["Approved", "Denied", "Pending"],
    layout: "stack",
  },
  {
    id: "asset-matrix",
    title: "Asset Matrix",
    caption:
      "A grouped multi-row matrix for balances, positions, and DeFi holdings. The network or venue spans multiple rows as a single cell, with filter chips and no metric counters.",
    file: "AssetMatrix.tsx",
    variants: ["Balances", "Positions & Perps", "Single token"],
    layout: "stack",
  },
  {
    id: "address-pill",
    title: "Address pill",
    caption:
      "The wallet a lookup belongs to, sitting above the card with a gap and aligned to its left edge.",
    file: "AddressPill.tsx",
    variants: ["EVM", "Solana", "NEAR"],
    layout: "stack",
  },
  {
    id: "deposit-card",
    title: "Deposit execution",
    caption:
      "Funding the intents.near ledger with ft_transfer_call. Verified against the Verifier deposit mechanics; figures are sample data.",
    file: "DepositCard.tsx",
    variants: ["Awaiting", "Settling", "Settled"],
    layout: "stack",
  },
  {
    id: "swap-card",
    title: "Swap execution",
    caption:
      "One variant per 1Click swap type: exact input, exact output with its slippage buffer, and the flex band. Verified against the swap-types reference.",
    file: "SwapCard.tsx",
    variants: ["Exact input", "Exact output", "Flex band"],
    layout: "stack",
  },
  {
    id: "bridge-card",
    title: "Bridge execution",
    caption:
      "A same-ticker move across chains prices as an ordinary exact-input quote; no special endpoint exists. Verified live with a USDC to USDC quote.",
    file: "BridgeCard.tsx",
    variants: ["Awaiting", "Settled"],
    layout: "stack",
  },
  {
    id: "withdraw-card",
    title: "Withdraw execution",
    caption:
      "Leaving the ledger for a chain address via ft_withdraw, with the msg parameter left out so refunds survive failures.",
    file: "WithdrawCard.tsx",
    variants: ["Awaiting", "Settled"],
    layout: "stack",
  },
  {
    id: "limit-order-card",
    title: "Limit order execution",
    caption:
      "A resting GTC order with partial fills and async cancel. Needs a partner key in production, so it stays lab-only for now.",
    file: "LimitOrderCard.tsx",
    variants: ["Open", "Partially filled", "Filled"],
    layout: "stack",
  },
  {
    id: "plain-english-card",
    title: "Plain English trade",
    caption:
      "One sentence carries the proposal while the footer carries the decision, offering rejection or approval until the trade is decided and a status badge in their place after, with a clickable card running the transition.",
    file: "PlainEnglishCard.tsx",
    variants: [
      "Deposit — Awaiting",
      "Swap — Approved",
      "Swap — Rejected",
      "Limit order — Expired",
      "Clickable",
    ],
    layout: "stack",
  },
  {
    id: "chip-hover-cards",
    title: "Hover details on chips",
    caption:
      "Inline chips that open a small detail card on hover or tap, with chain, price, and a sample price graph for tokens and identity for addresses.",
    file: "ChipHoverCards.tsx",
    variants: ["Token", "Address", "Venue"],
    layout: "stack",
  },
];
