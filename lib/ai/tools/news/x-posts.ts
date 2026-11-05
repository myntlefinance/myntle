import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../context";
import type { Capability } from "../capability";
import { searchXPage } from "@/lib/news/twitterapi";
import { storeSearch, getBlock } from "@/lib/news/block-cache";

export const GET_X_POSTS_CAPABILITY: Capability = {
  tool: "get_x_posts",
  tier: "read-public",
  subject: "none",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_x_posts", "searchId", "block"],
};

const QueryTypeEnum = z.enum(["Latest", "Top"]).default("Latest");

export function createXPostsTool(_context?: ToolContext) {
  return tool({
    description:
      "Search X for public posts about a crypto token, protocol, or event. " +
      "First call with query returns block 0 plus searchId and totalBlocks. " +
      "Read more with searchId + block (0-based). After all blocks, fetch a " +
      "fresh page with searchId + nextPage true. May interleave with other " +
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
      queryType: QueryTypeEnum.describe("Latest for recency, Top for reach."),
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
      nextPage: z
        .boolean()
        .optional()
        .describe("Fetch the next API page for a cached searchId."),
    }),
    execute: async ({ query, limit, queryType, searchId, block, nextPage }) => {
      // Paging a cached search.
      if (searchId) {
        if (nextPage) {
          const cached = getBlock(searchId, 0);
          if (!cached) {
            return {
              query: query?.trim() ?? "",
              items: [],
              warnings: ["x: search expired. Re-run get_x_posts with query."],
              note: "No X posts found, or the source failed. Say so plainly.",
            };
          }
          if (!cached.hasNextPage || !cached.nextCursor) {
            return {
              query: cached.query,
              items: [],
              searchId,
              note: "No further pages. Refine the query for more.",
            };
          }
          try {
            const page = await searchXPage(cached.query, {
              queryType,
              cursor: cached.nextCursor,
            });
            const stored = storeSearch({
              query: cached.query,
              source: "x",
              items: page.items,
              nextCursor: page.nextCursor,
              hasNextPage: page.hasNextPage,
            });
            const first = stored.blocks[0] ?? [];
            return {
              query: cached.query,
              items: first.slice(0, limit),
              searchId: stored.searchId,
              block: 0,
              totalBlocks: stored.blocks.length,
              totalItems: stored.totalItems,
              hasNextPage: page.hasNextPage,
              note: "Public X posts. Not a price, not a settlement record.",
            };
          } catch (error) {
            return {
              query: cached.query,
              items: [],
              warnings: [
                `x: ${error instanceof Error ? error.message : String(error)}`,
              ],
              note: "No X posts found, or the source failed. Say so plainly.",
            };
          }
        }
        const cached = getBlock(searchId, block ?? 0);
        if (!cached) {
          return {
            query: query?.trim() ?? "",
            items: [],
            warnings: [
              "x: unknown or expired searchId, or block out of range. Re-run get_x_posts with query.",
            ],
            note: "No X posts found, or the source failed. Say so plainly.",
          };
        }
        return {
          query: cached.query,
          items: cached.blockItems.slice(0, limit),
          searchId,
          block: block ?? 0,
          totalBlocks: cached.blocks.length,
          totalItems: cached.totalItems,
          hasNextPage: cached.hasNextPage ?? false,
          note: "Public X posts. Not a price, not a settlement record.",
        };
      }

      // Fresh search.
      const keyword = query?.trim() ?? "";
      if (keyword.length < 2) {
        return {
          query: keyword,
          items: [],
          warnings: ["Query is too short, or pass a live searchId + block."],
        };
      }
      try {
        const page = await searchXPage(keyword, { queryType });
        const stored = storeSearch({
          query: keyword,
          source: "x",
          items: page.items,
          nextCursor: page.nextCursor,
          hasNextPage: page.hasNextPage,
        });
        const first = stored.blocks[0] ?? [];
        return {
          query: keyword,
          items: first.slice(0, limit),
          searchId: stored.searchId,
          block: 0,
          totalBlocks: stored.blocks.length,
          totalItems: stored.totalItems,
          hasNextPage: page.hasNextPage,
          note: "Public X posts. Not a price, not a settlement record.",
        };
      } catch (error) {
        return {
          query: keyword,
          items: [],
          warnings: [
            `x: ${error instanceof Error ? error.message : String(error)}`,
          ],
          note: "No X posts found, or the source failed. Say so plainly.",
        };
      }
    },
  });
}

export const getXPosts = createXPostsTool();
