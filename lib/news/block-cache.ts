/**
 * Per-turn block cache for news/social searches.
 *
 * Tools fetch a full result set (up to ~20-100 items) once, keep it in a
 * module-level Map for the life of the server process, and serve it back in
 * ~6k-char blocks. No DB, no client storage. Entries expire after a few
 * minutes; a miss simply tells the model to re-search.
 *
 * This works per-turn on serverless: every tool call inside one streamText
 * turn runs in the same function invocation, so the Map survives the whole
 * turn. Across turns it may be gone, which is the intended lifecycle.
 */

import type { NormalizedNewsItem } from "./fetcher";

export const BLOCK_BUDGET_CHARS = 6000;
const MAX_ITEMS_PER_BLOCK = 10;
const TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_ITEMS = 60;

export type CachedSearch = {
  query: string;
  source: string;
  blocks: NormalizedNewsItem[][];
  totalItems: number;
  createdAt: number;
  nextCursor?: string | null;
  hasNextPage?: boolean;
};

const cache = new Map<string, CachedSearch>();

function itemChars(item: NormalizedNewsItem): number {
  return (item.title?.length ?? 0) + (item.snippet?.length ?? 0);
}

function packBlocks(items: NormalizedNewsItem[]): NormalizedNewsItem[][] {
  const blocks: NormalizedNewsItem[][] = [];
  let current: NormalizedNewsItem[] = [];
  let currentChars = 0;
  for (const item of items.slice(0, MAX_CACHED_ITEMS)) {
    const chars = itemChars(item);
    if (
      current.length > 0 &&
      (currentChars + chars > BLOCK_BUDGET_CHARS ||
        current.length >= MAX_ITEMS_PER_BLOCK)
    ) {
      blocks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += chars;
  }
  if (current.length > 0) blocks.push(current);
  return blocks.length > 0 ? blocks : [[]];
}

function makeSearchId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function sweep(): void {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (now - entry.createdAt > TTL_MS) cache.delete(id);
  }
}

export function storeSearch(args: {
  query: string;
  source: string;
  items: NormalizedNewsItem[];
  nextCursor?: string | null;
  hasNextPage?: boolean;
}): { searchId: string; blocks: NormalizedNewsItem[][]; totalItems: number } {
  sweep();
  const blocks = packBlocks(args.items);
  const searchId = makeSearchId();
  cache.set(searchId, {
    query: args.query,
    source: args.source,
    blocks,
    totalItems: Math.min(args.items.length, MAX_CACHED_ITEMS),
    createdAt: Date.now(),
    nextCursor: args.nextCursor ?? null,
    hasNextPage: args.hasNextPage ?? false,
  });
  return { searchId, blocks, totalItems: Math.min(args.items.length, MAX_CACHED_ITEMS) };
}

export function getBlock(
  searchId: string,
  block: number,
): CachedSearch & { blockItems: NormalizedNewsItem[] } | null {
  const entry = cache.get(searchId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(searchId);
    return null;
  }
  if (block < 0 || block >= entry.blocks.length) return null;
  return { ...entry, blockItems: entry.blocks[block] };
}
