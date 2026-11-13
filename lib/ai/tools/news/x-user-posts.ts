import { tool } from "ai";
import { z } from "zod";
import type { Capability } from "../capability";
import { searchXUserPage } from "@/lib/news/twitterapi";
import { storeSearch, getBlock } from "@/lib/news/block-cache";

export const GET_X_USER_POSTS_CAPABILITY: Capability = {
  tool: "get_x_user_posts",
  tier: "read-public",
  subject: "none",
  approval: "none",
  attribution: "none",
  promptTerms: ["get_x_user_posts", "searchId", "block"],
};

export function createXUserPostsTool() {
  return tool({
    description:
      "Fetch an X account's latest posts by username or user ID, newest first. " +
      "First call returns block 0 plus searchId and totalBlocks. " +
      "Read more with searchId + block (0-based). After all blocks, fetch a " +
      "fresh page with searchId + nextPage true. May interleave with other " +
      "searches; each searchId stays live ~5 minutes. " +
      "Never use this as price truth (use get_quote) or settlement truth " +
      "(use get_transaction_status).",
    inputSchema: z.object({
      userName: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe("X handle with or without @. Omit when paging with searchId."),
      userId: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe("X user ID. Takes precedence over userName when both are set."),
      includeReplies: z
        .boolean()
        .default(false)
        .describe("Include replies in the account timeline."),
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
      nextPage: z
        .boolean()
        .optional()
        .describe("Fetch the next page for a cached searchId."),
    }),
    execute: async ({
      userName,
      userId,
      includeReplies,
      limit,
      searchId,
      block,
      nextPage,
    }) => {
      // Paging a cached account timeline.
      if (searchId) {
        if (nextPage) {
          const cached = getBlock(searchId, 0);
          if (!cached) {
            return {
              query: userName?.trim() ?? userId?.trim() ?? "",
              items: [],
              warnings: ["x: search expired. Re-run get_x_user_posts."],
              note: "No X posts found, or the source failed. Say so plainly.",
            };
          }
          if (!cached.hasNextPage || !cached.nextCursor) {
            return {
              query: cached.query,
              items: [],
              searchId,
              note: "No further pages. The account timeline is exhausted.",
            };
          }
          const [handle, id] = cached.query.startsWith("id:")
            ? [undefined, cached.query.slice(3)]
            : [cached.query.replace(/^@/, ""), undefined];
          try {
            const page = await searchXUserPage({
              userName: handle,
              userId: id,
              includeReplies,
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
            query: userName?.trim() ?? userId?.trim() ?? "",
            items: [],
            warnings: [
              "x: unknown or expired searchId, or block out of range. Re-run get_x_user_posts.",
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

      // Fresh account fetch.
      const handle = userName?.trim().replace(/^@/, "") ?? "";
      const id = userId?.trim() ?? "";
      if (!handle && !id) {
        return {
          query: "",
          items: [],
          warnings: ["Pass userName or userId, or a live searchId + block."],
        };
      }
      const label = id ? `id:${id}` : `@${handle}`;
      try {
        const page = await searchXUserPage({
          userName: handle || undefined,
          userId: id || undefined,
          includeReplies,
        });
        const stored = storeSearch({
          query: label,
          source: "x",
          items: page.items,
          nextCursor: page.nextCursor,
          hasNextPage: page.hasNextPage,
        });
        const first = stored.blocks[0] ?? [];
        return {
          query: label,
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
          query: label,
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

export const getXUserPosts = createXUserPostsTool();
