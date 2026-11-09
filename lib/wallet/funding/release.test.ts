import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  releaseFundingConnections,
  trackFundingConnection,
} from "./release";

describe("funding connection release", () => {
  beforeEach(async () => {
    // The registry lives for the module, so each test starts empty.
    await releaseFundingConnections();
  });

  it("releases every tracked connection exactly once", async () => {
    const first = vi.fn();
    const second = vi.fn();
    trackFundingConnection(first);
    trackFundingConnection(second);

    await releaseFundingConnections();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    // A second sign-out must not replay grants that are already gone.
    await releaseFundingConnections();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("releases the others when one wallet refuses", async () => {
    const failing = vi.fn(() => {
      throw new Error("revocation refused");
    });
    const working = vi.fn(async () => {});
    trackFundingConnection(failing);
    trackFundingConnection(working);

    await releaseFundingConnections();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(working).toHaveBeenCalledTimes(1);
  });
});
