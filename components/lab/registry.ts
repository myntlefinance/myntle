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
      "A resting GTC order with partial fills and async cancel. The shipped version is the sentence card's limit-order action; this prototype records the original shape.",
    file: "LimitOrderCard.tsx",
    variants: ["Open", "Partially filled", "Filled"],
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
  {
    id: "auth-probe",
    title: "User auth probe",
    caption:
      "Lab-only signer for the 1Click empty-intent proof. Tokens stay in memory and are never stored.",
    file: "AuthProbe.tsx",
  },
  {
    id: "pill-wrapping",
    title: "Pill line breaks",
    caption:
      "What happens when the venue pill meets the end of a line: an atomic pill moves whole, an inline pill splits into two fragments (cloned or sliced), and a pill whose label wraps inside stays one box but becomes two lines tall.",
    file: "PillWrapping.tsx",
    variants: [
      "Atomic inline-flex",
      "Inline, cloned",
      "Inline, sliced",
      "Label wraps inside",
    ],
    layout: "row",
  },
  {
    id: "unlock-card",
    title: "Unlock card states",
    caption:
      "One card in four states: waiting on the user, cancelled at the wallet, unlocked and continuing, and expired after five minutes or a newer message.",
    file: "UnlockCardStates.tsx",
    variants: ["Live, locked", "Live, cancelled", "Live, unlocked", "Live, expired"],
    layout: "stack",
  },
  {
    id: "portfolio-revamp",
    title: "Portfolio holdings",
    caption:
      "Tabbed wallet and super account view built only from distilled primitives: segmented tabs, allocation bar, faceted filters, and search.",
    file: "PortfolioRevamp.tsx",
    variants: ["Your wallet", "Super account", "Empty"],
    layout: "stack",
  },
  {
    id: "morph-money",
    title: "Morphing hero total",
    caption:
      "The portfolio total gliding between values by place value instead of cutting, with the masked and reduced-motion states staying plain.",
    file: "MorphMoney.tsx",
    variants: ["small-delta", "large-delta", "masked", "reduced-motion"],
    layout: "row",
  },
  {
    id: "watched-selector",
    title: "Watched address selector",
    caption:
      "Three shapes for the watched list with the same two accounts: today's duplicated rows, deduped compact rows, and an overlay dropdown. The shipped cards live in components/finance/WatchedCards.tsx.",
    file: "WatchedSelector.tsx",
    variants: ["Rows", "Compact rows", "Dropdown"],
    layout: "stack",
  },
];
