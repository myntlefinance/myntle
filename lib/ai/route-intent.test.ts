import { describe, expect, it } from "vitest";
import { routeIntent } from "./route-intent";
import { buildSystemPrompt } from "./prompts/builder";
import { createTools } from "./tools/registry";

const ctx = {
  activeAddress: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  activeChain: "evm",
};

describe("routeIntent", () => {
  it("falls back to the full set on ambiguous input", () => {
    expect(routeIntent("")).toEqual({
      domains: ["trading", "portfolio", "news", "names"],
      toolDomains: [
        "portfolio",
        "trading",
        "assets",
        "news",
        "intents",
        "names",
      ],
    });
    expect(routeIntent("hello").domains).toEqual([
      "trading",
      "portfolio",
      "news",
      "names",
    ]);
  });

  it("scopes a balance question down from a trade question", () => {
    const balance = routeIntent("What is my wallet balance?");
    const trade = routeIntent("Swap 10 USDC for NEAR, what is the quote?");
    const fullInstructions = buildSystemPrompt(ctx).length;
    const fullTools = Object.keys(createTools(ctx)).length;

    const balanceInstructions = buildSystemPrompt({
      ...ctx,
      domains: balance.domains,
    }).length;
    const balanceTools = Object.keys(
      createTools(ctx, { domains: balance.toolDomains }),
    ).length;
    const tradeInstructions = buildSystemPrompt({
      ...ctx,
      domains: trade.domains,
    }).length;
    const tradeTools = Object.keys(
      createTools(ctx, { domains: trade.toolDomains }),
    ).length;

    expect(balanceTools).toBeLessThan(fullTools);
    expect(balanceInstructions).toBeLessThan(fullInstructions);
    expect(tradeTools).toBeLessThan(fullTools);
    expect(tradeInstructions).toBeLessThan(fullInstructions);
    // A balance question never registers the trading tools (the wallet
    // context prose may still name them; the registry is what matters).
    expect(
      Object.keys(createTools(ctx, { domains: balance.toolDomains })),
    ).not.toContain("get_quote");
    // ...but it does register the status read, because "what happened to my
    // transaction" is a portfolio question and the tool is the answer.
    expect(
      Object.keys(createTools(ctx, { domains: balance.toolDomains })),
    ).toContain("get_transaction_status");
  });

  it("keeps the settlement read for a follow-up that names no action", () => {
    for (const text of [
      "What happened?",
      "Did it go through?",
      "Is it refunded?",
      "why did it fail?",
    ]) {
      const intent = routeIntent(text);
      expect(intent.toolDomains).toContain("trading");
      expect(intent.toolDomains).toContain("portfolio");
      expect(
        Object.keys(createTools(ctx, { domains: intent.toolDomains })),
      ).toContain("get_transaction_status");
    }
  });

  it("never scopes out trading+intents for money intents", () => {
    for (const text of [
      "send 5 USDC to alice",
      "withdraw my funds",
      "bridge to base",
    ]) {
      const intent = routeIntent(text);
      expect(intent.toolDomains).toContain("trading");
      expect(intent.toolDomains).toContain("intents");
      expect(
        Object.keys(createTools(ctx, { domains: intent.toolDomains }),
      )).toContain("prepare_swap");
    }
  });
});
