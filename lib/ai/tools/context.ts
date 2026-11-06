import { z } from "zod";

export const SupportedNetworkEnum = z.enum([
  "arbitrum",
  "base",
  "ethereum",
  "optimism",
  "polygon",
  "solana",
  "near",
]);

export const SupportedChainEnum = z.enum(["evm", "solana", "near"]);

export type ToolDomain = "portfolio" | "trading" | "assets" | "news" | "intents";

/**
 * Context passed to the tools from the active chat turn.
 */
export type ToolContext = {
  /**
   * The signed-in account that owns quotes and transactions. Absent for a
   * logged-out preview, which prices but stores nothing.
   */
  userId?: string | null;
  /**
   * Which signer owns the account. A wallet account keeps the chain tools and
   * the direct route; a passkey account has no wallet and reads only the
   * Intents account. Absent means wallet, so every existing caller is
   * unchanged.
   */
  accountKind?: "wallet" | "passkey";
  /** The NEAR Intents account the signer controls. */
  intentsAccountId?: string | null;
  /** The passkey account id, set only for a passkey session. */
  accountId?: string | null;
  activeAddress?: string | null;
  activeChain?: string | null;
  /** Whether the super account is unlocked for this wallet. */
  superUnlocked?: boolean | null;
  /**
   * A live 1Click User-Session access token for this turn.
   *
   * The browser mints it and sends it in a request header; the server uses it
   * for the read tools in this turn and never stores it. The refresh token
   * stays in the browser, so nothing here can outlive the request.
   */
  intentsAccessToken?: string | null;
};
