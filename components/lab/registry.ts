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
      "A resting GTC order with partial fills and async cancel. Needs a partner key in production, so it stays lab-only for now.",
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
    id: "unlock-card",
    title: "Unlock card states",
    caption:
      "One card in four states: waiting on the user, cancelled at the wallet, unlocked and continuing, and expired after five minutes or a newer message.",
    file: "UnlockCardStates.tsx",
    variants: ["Live, locked", "Live, cancelled", "Live, unlocked", "Live, expired"],
    layout: "stack",
  },
];
