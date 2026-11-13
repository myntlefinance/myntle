/**
 * Request-scoped name cache. Names are mutable pointers, so nothing here
 * is authoritative: success entries live 10 minutes, unregistered
 * (`null`) entries live 1 hour, and failures are never cached. The money
 * path stays TTL 0 — approval and signing always resolve fresh and never
 * accept a cached `resolvedAt`. Long-lived freshness is governed by
 * `resolved_at` in the database (steps 07–08), not by this module.
 *
 * Typical use is one cache per chat turn: repeated mentions of the same
 * name inside a turn hit memory instead of the network, and the next
 * turn starts clean.
 */

import {
  RESOLVED_NAME_TTL_MS,
  UNREGISTERED_NAME_TTL_MS,
  type NameChain,
  type ResolvedName,
} from "@/lib/ports";

export type CachedNameValue = ResolvedName | null;

type CacheEntry = {
  value: CachedNameValue;
  expiresAt: number;
};

export function nameCacheKey(chain: NameChain, normalized: string): string {
  return `${chain}:${normalized}`;
}

export function ttlForNameValue(value: CachedNameValue): number {
  return value === null ? UNREGISTERED_NAME_TTL_MS : RESOLVED_NAME_TTL_MS;
}

export class NameCache {
  private entries = new Map<string, CacheEntry>();

  get(
    chain: NameChain,
    normalized: string,
    now: number = Date.now(),
  ): { hit: true; value: CachedNameValue } | { hit: false } {
    const key = nameCacheKey(chain, normalized);
    const entry = this.entries.get(key);
    if (!entry) return { hit: false };
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return { hit: false };
    }
    return { hit: true, value: entry.value };
  }

  set(
    chain: NameChain,
    normalized: string,
    value: CachedNameValue,
    now: number = Date.now(),
  ): void {
    this.entries.set(nameCacheKey(chain, normalized), {
      value,
      expiresAt: now + ttlForNameValue(value),
    });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * One memo per chat turn. The first mention of a name runs the fresh
 * read; later mentions in the same turn reuse it. A rejected read
 * propagates and is never stored, so the next mention retries.
 */
export function createRequestMemo() {
  const cache = new NameCache();
  return {
    resolve(
      chain: NameChain,
      normalized: string,
      fresh: () => Promise<CachedNameValue>,
    ): Promise<CachedNameValue> {
      const cached = cache.get(chain, normalized);
      if (cached.hit) return Promise.resolve(cached.value);
      return fresh().then((value) => {
        cache.set(chain, normalized, value);
        return value;
      });
    },
  };
}

export type RequestMemo = ReturnType<typeof createRequestMemo>;
