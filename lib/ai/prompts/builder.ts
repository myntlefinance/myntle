import { IDENTITY_PROMPT } from "./identity";
import { TRADING_PROMPT } from "./trading";
import { PORTFOLIO_PROMPT } from "./portfolio";
import { FORMATTING_PROMPT } from "./formatting";
import { buildWalletContext } from "./wallet";

export type PromptDomain = "trading" | "portfolio";

export type SystemPromptOptions = {
  activeAddress?: string | null;
  activeChain?: string | null;
  domains?: PromptDomain[];
  customInstructions?: string;
};

/**
 * Builds a modular, context-aware system prompt for the assistant.
 * If process.env.SYSTEM_INSTRUCTIONS is set, it will be used as the base
 * instructions with wallet context appended.
 */
export function buildSystemPrompt(options: SystemPromptOptions = {}): string {
  if (process.env.SYSTEM_INSTRUCTIONS) {
    const base = process.env.SYSTEM_INSTRUCTIONS.trim();
    const wallet = buildWalletContext({
      activeAddress: options.activeAddress,
      activeChain: options.activeChain,
    });
    return `${base}\n\n${wallet}`;
  }

  const sections: string[] = [IDENTITY_PROMPT];

  const domains = options.domains ?? ["trading", "portfolio"];

  if (domains.includes("trading")) {
    sections.push(TRADING_PROMPT);
  }

  if (domains.includes("portfolio")) {
    sections.push(PORTFOLIO_PROMPT);
  }

  sections.push(FORMATTING_PROMPT);

  const walletSection = buildWalletContext({
    activeAddress: options.activeAddress,
    activeChain: options.activeChain,
  });
  sections.push(walletSection);

  if (options.customInstructions?.trim()) {
    sections.push(`Additional Instructions:\n${options.customInstructions.trim()}`);
  }

  return sections.join("\n\n");
}
