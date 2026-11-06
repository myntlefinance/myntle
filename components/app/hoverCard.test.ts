import { describe, it, expect } from "vitest";
import {
  claimHoverCard,
  dismissHoverCard,
  releaseHoverCard,
} from "@/components/app/hoverCard";

describe("hoverCard coordinator", () => {
  it("closes the previous card when another chip claims the surface", () => {
    let closed = 0;
    claimHoverCard("a", () => {
      closed += 1;
    });
    claimHoverCard("b", () => {});
    expect(closed).toBe(1);
    releaseHoverCard("b");
  });

  it("does not close the active card when it re-claims itself", () => {
    let closed = 0;
    claimHoverCard("a", () => {
      closed += 1;
    });
    claimHoverCard("a", () => {});
    expect(closed).toBe(0);
    releaseHoverCard("a");
  });

  it("closes the active card when a different chip starts hovering", () => {
    let closed = 0;
    claimHoverCard("a", () => {
      closed += 1;
    });
    dismissHoverCard("b");
    expect(closed).toBe(1);
  });

  it("ignores a release from a card that no longer owns the surface", () => {
    let closed = 0;
    claimHoverCard("a", () => {
      closed += 1;
    });
    claimHoverCard("b", () => {});
    releaseHoverCard("a");
    dismissHoverCard("c");
    expect(closed).toBe(1);
    releaseHoverCard("b");
  });
});
