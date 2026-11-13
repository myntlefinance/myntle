import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isNearImplicitAccount,
  nearSetupGrantYocto,
  nearSetupMinBalanceYocto,
  yoctoToNear,
} from "./intents-keys";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("yoctoToNear", () => {
  it("formats the setup grant without rounding", () => {
    expect(yoctoToNear("1500000000000000000000")).toBe("0.0015");
  });

  it("keeps whole NEAR amounts plain", () => {
    expect(yoctoToNear("1000000000000000000000000")).toBe("1");
  });

  it("trims trailing zeroes but keeps significant decimals", () => {
    expect(yoctoToNear("1234500000000000000000000")).toBe("1.2345");
  });

  it("returns the input when it is not an integer", () => {
    expect(yoctoToNear("not-yocto")).toBe("not-yocto");
  });
});

describe("NEAR setup constants", () => {
  it("defaults to 0.0015 NEAR", () => {
    vi.stubEnv("NEAR_SETUP_GRANT_YOCTO", "");
    expect(nearSetupGrantYocto()).toBe("1500000000000000000000");
  });

  it("uses the gas threshold as the no-grant line", () => {
    vi.stubEnv("NEAR_SETUP_MIN_BALANCE_YOCTO", "");
    expect(nearSetupMinBalanceYocto()).toBe("1000000000000000000000");
  });

  it("recognises only a 64-hex implicit account", () => {
    expect(isNearImplicitAccount("0".repeat(64))).toBe(true);
    expect(isNearImplicitAccount("myntlefinance.near")).toBe(false);
    expect(isNearImplicitAccount("0".repeat(63))).toBe(false);
  });
});
