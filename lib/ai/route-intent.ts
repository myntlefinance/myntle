import type { PromptDomain } from "./prompts/builder";
import type { ToolDomain } from "./tools/context";

export type RouteIntent = {
  domains: PromptDomain[];
  toolDomains: ToolDomain[];
};

const FULL_PROMPT: PromptDomain[] = ["trading", "portfolio", "news", "names"];
const FULL_TOOLS: ToolDomain[] = [
  "portfolio",
  "trading",
  "assets",
  "news",
  "intents",
  "names",
];

const TRADE_RE =
  /\b(swap|trade|trading|exchange|convert|quote|deposit|withdraw|bridge|send|transfer|buy|sell|wrap|unwrap|price|slippage|limit|order|earn|yield|vault|apy|savings|invest|interest)\b/i;
const BALANCE_RE =
  /\b(balanc|portfolio|holding|position|worth|wallets?|histor|transaction|activit)\b/i;
const NEWS_RE =
  /\b(news|headline|reddit|tweets?|x\s?posts?|search|latest|happen|announc|rumo[ur])\b/i;
/**
 * A follow-up about something already submitted. "What happened?" and
 * "did it go through?" name no asset and no action, so without this they
 * route to the news domain and lose the settlement read entirely.
 */
const SETTLEMENT_RE =
  /\b(status|settl(?:e|es|ed|ing|ement)|refund(?:ed|ing)?|fail(?:ed|ing|ure)?|pending|stuck|(?:go|goes|going|went) through|what happened)\b/i;

/**
 * Lightweight per-turn scoping for the system prompt and tool registry.
 * Keyword heuristic only: ambiguous or empty input falls back to the full
 * set (today's behavior), and any money-adjacent word keeps trading+intents
 * so `prepare_swap` is never scoped out from under a trade.
 */
export function routeIntent(text: string): RouteIntent {
  const trade = TRADE_RE.test(text);
  const balance = BALANCE_RE.test(text);
  const news = NEWS_RE.test(text);
  const settlement = SETTLEMENT_RE.test(text);
  if (!trade && !balance && !news && !settlement) {
    return { domains: [...FULL_PROMPT], toolDomains: [...FULL_TOOLS] };
  }
  const domains: PromptDomain[] = [];
  const toolSet = new Set<ToolDomain>();
  if (trade) {
    domains.push("trading");
    toolSet.add("trading");
    toolSet.add("intents");
    toolSet.add("assets");
  }
  if (balance) {
    domains.push("portfolio");
    toolSet.add("portfolio");
    toolSet.add("intents");
    toolSet.add("assets");
  }
  if (news) {
    domains.push("news");
    toolSet.add("news");
  }
  if (settlement) {
    // A settlement follow-up needs the record, the live status, and the
    // history that names the trade the user means.
    if (!domains.includes("trading")) domains.push("trading");
    if (!domains.includes("portfolio")) domains.push("portfolio");
    toolSet.add("trading");
    toolSet.add("portfolio");
    toolSet.add("intents");
    toolSet.add("assets");
  }
  return { domains, toolDomains: [...toolSet] };
}
