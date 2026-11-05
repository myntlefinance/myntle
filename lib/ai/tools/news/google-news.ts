import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";
import { searchGoogleNews } from "@/lib/news/fetcher";
import { storeSearch, getBlock } from "@/lib/news/block-cache";

export const GET_GOOGLE_NEWS_CAPABILITY: Capability = {
  tool: "get_google_news",
  tier: "read-public",
  subject: "none",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_google_news", "searchId", "block"],
};

export function createGoogleNewsTool(_context?: ToolContext) {
  return tool({
    description:
      "Search Google News for recent public news about a crypto token, " +
      "protocol, or event — launches, outages, exploits, governance. " +
      "First call with query returns block 0 plus searchId and totalBlocks. " +
      "Read more with searchId + block (0-based). May interleave with other " +
      "searches; each searchId stays live ~5 minutes. " +
      "Never use this as price truth (use get_quote) or settlement truth " +
      "(use get_transaction_status).",
    inputSchema: z.object({
      query: z
        .string()
        .min(2)
        .max(120)
        .optional()
        .describe(
          "Token, protocol, or event to look up. Required for a fresh search, omit when paging with searchId.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(8)
        .default(5)
        .describe("Maximum items per block response."),
      searchId: z
        .string()
        .optional()
        .describe("Live search id from a prior block response."),
      block: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("0-based block index within the cached search."),
    }),
    execute: async ({ query, limit, searchId, block }) => {
      if (searchId) {
        const cached = getBlock(searchId, block ?? 0);
        if (!cached) {
          return {
            query: query?.trim() ?? "",
            items: [],
            warnings: [
              "google-news: unknown or expired searchId, or block out of range. Re-run get_google_news with query.",
            ],
            note: "No public news found, or the source failed. Say so plainly.",
          };
        }
        return {
          query: cached.query,
          items: cached.blockItems.slice(0, limit),
          searchId,
          block: block ?? 0,
          totalBlocks: cached.blocks.length,
          totalItems: cached.totalItems,
          note: "Public news. Not a price, not a settlement record.",
        };
      }

      const keyword = query?.trim() ?? "";
      if (keyword.length < 2) {
        return {
          query: keyword,
          items: [],
          warnings: ["Query is too short, or pass a live searchId + block."],
        };
      }
      try {
        const items = await searchGoogleNews(keyword);
        const stored = storeSearch({
          query: keyword,
          source: "google-news",
          items,
        });
        const first = stored.blocks[0] ?? [];
        return {
          query: keyword,
          items: first.slice(0, limit),
          searchId: stored.searchId,
          block: 0,
          totalBlocks: stored.blocks.length,
          totalItems: stored.totalItems,
          note: "Public news. Not a price, not a settlement record.",
        };
      } catch (error) {
        return {
          query: keyword,
          items: [],
          warnings: [
            `google-news: ${error instanceof Error ? error.message : String(error)}`,
          ],
          note: "No public news found, or the source failed. Say so plainly.",
        };
      }
    },
  });
}

export const getGoogleNews = createGoogleNewsTool();
