"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import {
  getPriceMap,
  getPriceVersion,
  getQuote,
  subscribeAssets,
  subscribeToPriceStore,
  unsubscribeAssets,
  type LiveQuote,
} from "./priceStore";
import { isPricesLive } from "@/lib/prices/flags";

/** An off-screen chip stops updating after this long, so scrolling back
 * and forth does not churn the socket. */
const GRACE_MS = 30_000;
const ROOT_MARGIN = "200px 0px";

const EMPTY_PRICE_MAP: Map<string, LiveQuote> = new Map();
const ZERO_VERSION = () => 0;

/**
 * The store read behind `usePrice`, kept separate so the rollout flag can be
 * tested without a React renderer. Flag off means undefined: every surface
 * falls back to the catalogue price it already received.
 */
export function selectLiveQuote(
  assetId: string | null | undefined,
): LiveQuote | undefined {
  const id = assetId?.trim() ?? "";
  return isPricesLive() && id ? getQuote(id) : undefined;
}

/** Read one quote. The object reference is stable until that quote changes.
 * With the rollout flag off there is no live read at all. */
export function usePrice(assetId: string | null | undefined): LiveQuote | undefined {
  const id = assetId?.trim() ?? "";
  return useSyncExternalStore(
    subscribeToPriceStore,
    () => selectLiveQuote(id),
    () => undefined,
  );
}

/**
 * The ids a key change adds and removes. Only the difference is sent, so a
 * card list that grows or shrinks never drops its whole set to zero.
 */
export function diffSubscriptions(
  previous: readonly string[],
  next: readonly string[],
): { added: string[]; removed: string[] } {
  const before = new Set(previous);
  const after = new Set(next);
  return {
    added: next.filter((id) => !before.has(id)),
    removed: previous.filter((id) => !after.has(id)),
  };
}

/**
 * Watch a set of assets while the component is mounted. This is the
 * portfolio's subscription: every holding is watched at once, including
 * the rows below the fold, so the hero total stays correct. A key change
 * subscribes only what is new and releases only what is gone.
 */
export function usePriceSubscription(ids: readonly string[]): void {
  const live = isPricesLive();
  const key = useMemo(
    () => [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort().join("\n"),
    [ids],
  );
  const subscribed = useRef<string[]>([]);

  useEffect(() => {
    if (!live) return;
    const next = key ? key.split("\n") : [];
    const { added, removed } = diffSubscriptions(subscribed.current, next);
    if (added.length > 0) subscribeAssets(added);
    if (removed.length > 0) unsubscribeAssets(removed);
    subscribed.current = next;
  }, [key, live]);

  useEffect(() => {
    if (!live) return;
    return () => {
      const current = subscribed.current;
      subscribed.current = [];
      if (current.length > 0) unsubscribeAssets(current);
    };
  }, [live]);
}

/** The live quotes for exactly these ids, in a map the overlay can read. */
export function usePriceMap(ids: readonly string[]): Map<string, LiveQuote> {
  const live = isPricesLive();
  const key = useMemo(
    () => [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort().join("\n"),
    [ids],
  );
  const version = useSyncExternalStore(
    subscribeToPriceStore,
    live ? getPriceVersion : ZERO_VERSION,
    ZERO_VERSION,
  );

  return useMemo(
    () =>
      live ? getPriceMap(key ? key.split("\n") : []) : EMPTY_PRICE_MAP,
    // `version` is the store invalidation counter: the quote map is mutable,
    // so the rule cannot see that the memo has to recompute when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, version, live],
  );
}

/* ── shared viewport observer ────────────────────────────── */

type ObserverCallbacks = {
  onEnter: () => void;
  onExit: () => void;
};

let observer: IntersectionObserver | null = null;
/** One element can be watched by more than one hook: a chip anchor warms on
 * entry while a popup root subscribes to the live price. A Set keeps both. */
const callbacks = new Map<Element, Set<ObserverCallbacks>>();

function sharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (!observer) {
    observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const entries = callbacks.get(record.target);
          if (!entries) continue;
          for (const entry of entries) {
            if (record.isIntersecting) entry.onEnter();
            else entry.onExit();
          }
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
  }
  return observer;
}

function releaseObserver(): void {
  if (callbacks.size > 0) return;
  observer?.disconnect();
  observer = null;
}

/**
 * Watch one asset while its element is on screen. Every chip shares one
 * observer, so a transcript with hundreds of chips does not create hundreds
 * of observers. Leaving the viewport schedules the unsubscribe, and coming
 * back inside the grace period cancels it.
 *
 * When `IntersectionObserver` is unavailable (tests, an old browser), the
 * subscription starts immediately and the hook behaves like `usePrice`.
 */
export function useVisiblePrice(
  assetId: string | null | undefined,
  ref: RefObject<Element | null>,
): LiveQuote | undefined {
  const live = isPricesLive();
  const id = assetId?.trim() ?? "";
  const quote = usePrice(id || null);
  const subscribed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!live || !id) return;
    const element = ref.current;
    const watcher = element ? sharedObserver() : null;

    const clearGrace = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const start = () => {
      clearGrace();
      if (subscribed.current) return;
      subscribed.current = true;
      subscribeAssets([id]);
    };

    const stop = () => {
      clearGrace();
      if (!subscribed.current) return;
      subscribed.current = false;
      unsubscribeAssets([id]);
    };

    if (!element || !watcher) {
      start();
      return () => {
        clearGrace();
        stop();
      };
    }

    const entry: ObserverCallbacks = {
      onEnter: start,
      onExit: () => {
        if (!subscribed.current) return;
        clearGrace();
        timer.current = setTimeout(() => {
          timer.current = null;
          stop();
        }, GRACE_MS);
      },
    };

    let entries = callbacks.get(element);
    if (!entries) {
      entries = new Set();
      callbacks.set(element, entries);
    }
    entries.add(entry);
    watcher.observe(element);

    return () => {
      watcher.unobserve(element);
      const current = callbacks.get(element);
      if (current) {
        current.delete(entry);
        if (current.size === 0) callbacks.delete(element);
      }
      clearGrace();
      stop();
      releaseObserver();
    };
  }, [id, ref, live]);

  return quote;
}

/**
 * Call `onEnter` whenever `element` first comes within 200px of the viewport,
 * and on every later re-entry. One shared observer serves every caller, so a
 * transcript full of chips still creates a single `IntersectionObserver`.
 *
 * When `IntersectionObserver` is unavailable (tests, an old browser), the
 * callback runs immediately so the caller's warm path is never skipped.
 * Returns the cleanup that stops watching the element.
 */
export function observeVisibility(
  element: Element | null | undefined,
  onEnter: () => void,
): () => void {
  if (!element) return () => {};
  const watcher = sharedObserver();
  if (!watcher) {
    onEnter();
    return () => {};
  }

  const entry: ObserverCallbacks = {
    onEnter,
    // Warming only needs the enter edge; leaving re-arms the next entry.
    onExit: () => {},
  };
  let entries = callbacks.get(element);
  if (!entries) {
    entries = new Set();
    callbacks.set(element, entries);
  }
  entries.add(entry);
  watcher.observe(element);

  return () => {
    watcher.unobserve(element);
    const current = callbacks.get(element);
    if (current) {
      current.delete(entry);
      if (current.size === 0) callbacks.delete(element);
    }
    releaseObserver();
  };
}

/**
 * Run `onVisible` each time the referenced element enters (or re-enters) the
 * viewport margin. This is the warm-up counterpart to `useVisiblePrice`:
 * it starts the work a hover or focus would otherwise start, just before the
 * user reaches the element.
 *
 * The callback lives in a ref so a new inline closure on every render does
 * not tear down and rebuild the observation, and `enabled` lets a caller
 * skip the watch when there is nothing to warm.
 */
export function useViewportIntent(
  ref: RefObject<Element | null>,
  onVisible: () => void,
  enabled = true,
): void {
  const callback = useRef(onVisible);

  useEffect(() => {
    callback.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    if (!enabled) return;
    return observeVisibility(ref.current, () => callback.current());
  }, [ref, enabled]);
}
