import { IDENTITY_PROMPT } from "./identity";
import { TRADING_PROMPT } from "./trading";
import { SUPER_PROMPT } from "./super";
import { PORTFOLIO_PROMPT } from "./portfolio";
import { NAMES_PROMPT } from "./names";
import { NEWS_PROMPT } from "./news";
import { FORMATTING_PROMPT, DISCLOSURE_PROMPT } from "./formatting";
import { buildWalletContext } from "./wallet";
import { buildPasskeyContext } from "./passkey";

export type PromptDomain = "trading" | "portfolio" | "names" | "news";

/** Which signer owns the account the prompt describes. */
export type PromptAccountKind = "wallet" | "passkey";

export type SystemPromptOptions = {
  /**
   * The signer's kind. Absent means wallet, so every existing caller keeps
   * today's prompt byte for byte. A passkey account has no wallet, so its
   * section replaces the wallet context rather than joining it.
   */
  accountKind?: PromptAccountKind | null;
  /** The passkey account id, shown only to a passkey account. */
  accountId?: string | null;
  activeAddress?: string | null;
  activeChain?: string | null;
  superUnlocked?: boolean | null;
  /** The unlock landed in this same turn, so the reply should resume. */
  superJustUnlocked?: boolean | null;
  domains?: PromptDomain[];
  customInstructions?: string;
};

/**
 * Builds a modular, context-aware system prompt for the assistant.
 * If process.env.SYSTEM_INSTRUCTIONS is set, it will be used as the base
 * instructions with wallet context appended.
 */
export function buildSystemPrompt(options: SystemPromptOptions = {}): string {
  const accountKind: PromptAccountKind =
    options.accountKind === "passkey" ? "passkey" : "wallet";

  const accountSection =
    accountKind === "passkey"
      ? buildPasskeyContext({ accountId: options.accountId })
      : buildWalletContext({
          activeAddress: options.activeAddress,
          activeChain: options.activeChain,
        });

  if (process.env.SYSTEM_INSTRUCTIONS) {
    const base = process.env.SYSTEM_INSTRUCTIONS.trim();
    return `${base}\n\n${DISCLOSURE_PROMPT}\n\n${accountSection}`;
  }

  const sections: string[] = [IDENTITY_PROMPT];

  const domains = options.domains ?? [
    "trading",
    "portfolio",
    "names",
    "news",
  ];

  if (domains.includes("trading")) {
    sections.push(TRADING_PROMPT);
  }

  const superStatus = options.superJustUnlocked
    ? "unlocked (the user unlocked it in this turn, and the interface already shows the confirmation). Answer the waiting request directly and do not repeat the unlock confirmation"
    : options.superUnlocked
      ? "unlocked"
      : "locked";

  sections.push(SUPER_PROMPT + `\nSuper account status: ${superStatus}.`);

  if (domains.includes("portfolio")) {
    sections.push(PORTFOLIO_PROMPT);
  }

  if (domains.includes("names")) {
    sections.push(NAMES_PROMPT);
  }

  if (domains.includes("news")) {
    sections.push(NEWS_PROMPT);
  }

  sections.push(FORMATTING_PROMPT);
  sections.push(DISCLOSURE_PROMPT);

  sections.push(accountSection);

  if (options.customInstructions?.trim()) {
    sections.push(`Additional Instructions:\n${options.customInstructions.trim()}`);
  }

  return sections.join("\n\n");
}
