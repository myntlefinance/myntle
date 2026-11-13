import { afterEach, describe, expect, it, vi } from "vitest";
import { isPricesLive, PRICES_LIVE_ENV } from "./flags";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPricesLive", () => {
  it("turns on only for the exact value 1", () => {
    vi.stubEnv(PRICES_LIVE_ENV, "1");
    expect(isPricesLive()).toBe(true);
  });

  it.each(["", "0", "true", "yes", " 1 ", "01"])(
    "treats %p as off",
    (value) => {
      vi.stubEnv(PRICES_LIVE_ENV, value);
      expect(isPricesLive()).toBe(false);
    },
  );

  it("treats an unset value as off", () => {
    vi.stubEnv(PRICES_LIVE_ENV, undefined);
    expect(isPricesLive()).toBe(false);
  });
});
