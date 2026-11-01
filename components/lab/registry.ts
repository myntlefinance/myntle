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
    variants: ["Balances", "Positions & Perps"],
    layout: "stack",
  },
];
