import { afterEach, describe, expect, it, vi } from "vitest";
import {
  diffSubscriptions,
  observeVisibility,
  selectLiveQuote,
} from "./usePrice";
import { __resetPriceStoreForTests, seedQuote } from "./priceStore";

afterEach(() => {
  __resetPriceStoreForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("diffSubscriptions", () => {
  it("keeps the shared ids and reports only the difference", () => {
    expect(diffSubscriptions(["a", "b"], ["b", "c"])).toEqual({
      added: ["c"],
      removed: ["a"],
    });
  });

  it("subscribes everything on the first key", () => {
    expect(diffSubscriptions([], ["a", "b"])).toEqual({
      added: ["a", "b"],
      removed: [],
    });
  });

  it("releases everything when the set empties", () => {
    expect(diffSubscriptions(["a", "b"], [])).toEqual({
      added: [],
      removed: ["a", "b"],
    });
  });

  it("does nothing when the key is unchanged", () => {
    expect(diffSubscriptions(["a", "b"], ["a", "b"])).toEqual({
      added: [],
      removed: [],
    });
  });
});

describe("selectLiveQuote", () => {
  it("reads the store when the rollout flag is on", () => {
    vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "1");
    seedQuote("a", 1.5, Date.now(), "oneclick", true);

    expect(selectLiveQuote("a")?.usd).toBe(1.5);
  });

  it("returns undefined with the flag off even when a quote is stored", () => {
    vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "1");
    seedQuote("a", 1.5, Date.now(), "oneclick", true);
    vi.stubEnv("NEXT_PUBLIC_PRICES_LIVE", "0");

    expect(selectLiveQuote("a")).toBeUndefined();
  });

  it("returns undefined for an empty id", () => {
    expect(selectLiveQuote("  ")).toBeUndefined();
    expect(selectLiveQuote(null)).toBeUndefined();
  });
});

describe("observeVisibility", () => {
  it("calls onEnter immediately when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(typeof IntersectionObserver).toBe("undefined");

    const onEnter = vi.fn();
    const stop = observeVisibility({} as Element, onEnter);

    expect(onEnter).toHaveBeenCalledTimes(1);
    // The cleanup is always a function so a caller can return it from an effect.
    expect(() => stop()).not.toThrow();
  });

  it("watches through one shared observer and calls onEnter on every entry", () => {
    const constructed: IntersectionObserverCallback[] = [];
    const observed: Element[] = [];
    const unobserved: Element[] = [];

    class FakeObserver {
      constructor(callback: IntersectionObserverCallback) {
        constructed.push(callback);
      }
      observe(element: Element) {
        observed.push(element);
      }
      unobserve(element: Element) {
        unobserved.push(element);
      }
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);

    const first = {} as Element;
    const second = {} as Element;
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    const stopFirst = observeVisibility(first, onFirst);
    const stopSecond = observeVisibility(second, onSecond);

    // Two chips, one observer: the module shares it across elements.
    expect(constructed).toHaveLength(1);
    expect(observed).toEqual([first, second]);

    const entries = (element: Element) => [
      { isIntersecting: true, target: element } as IntersectionObserverEntry,
    ];
    constructed[0]?.(entries(first), {} as IntersectionObserver);
    expect(onFirst).toHaveBeenCalledTimes(1);

    // Leaving does not consume the warm intent; a re-entry runs it again.
    constructed[0]?.(entries(first), {} as IntersectionObserver);
    expect(onFirst).toHaveBeenCalledTimes(2);

    stopFirst();
    expect(unobserved).toEqual([first]);
    // The second watcher keeps the shared observer alive.
    constructed[0]?.(entries(second), {} as IntersectionObserver);
    expect(onSecond).toHaveBeenCalledTimes(1);

    stopSecond();
    expect(unobserved).toEqual([first, second]);
  });
});
