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
    id: "button-tones",
    title: "Button tones",
    caption:
      "Every button tone with its label and one-line usage, the three sizes, and how the sheet pair reads on the tinted fill.",
    file: "ButtonVariants.tsx",
  },
  {
    id: "status-sheet",
    title: "Terminal status sheet",
    caption:
      "The sentence stays untouched on a taller card while success, failure, and error share one tinted bottom sheet with a single mark, headline, sentence, and View txn action.",
    file: "StatusSheetCard.tsx",
    variants: ["Success", "Failed", "Error"],
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
  {
    id: "portfolio-revamp",
    title: "Portfolio holdings",
    caption:
      "Tabbed wallet and super account view built only from distilled primitives: segmented tabs, allocation bar, faceted filters, and search.",
    file: "PortfolioRevamp.tsx",
    variants: ["Your wallet", "Super account", "Empty"],
    layout: "stack",
  },
];
