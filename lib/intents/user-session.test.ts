import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getValidAccessToken,
  isSuperUnlocked,
  lockSuperAccount,
  saveIntentsSession,
  SUPER_LOCK_EVENT,
} from "./user-session";

function fakeBrowser() {
  const events = new EventTarget();
  const store = new Map<string, string>();
  const localStorage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
  Object.defineProperty(events, "localStorage", { value: localStorage });
  return { events, localStorage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lockSuperAccount", () => {
  it("forgets the wallet's tokens and broadcasts the lock", async () => {
    const { events, localStorage } = fakeBrowser();
    vi.stubGlobal("window", events);

    const address = "0xAbC0000000000000000000000000000000000001";
    const key = `myntle:intents-session:evm:${address.toLowerCase()}`;

    saveIntentsSession({
      chain: "evm",
      address,
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 900,
      refreshExpiresIn: 3600,
    });

    expect(isSuperUnlocked("evm", address)).toBe(true);
    expect(localStorage.getItem(key)).not.toBeNull();

    let locked = 0;
    events.addEventListener(SUPER_LOCK_EVENT, () => {
      locked += 1;
    });

    lockSuperAccount("evm", address);

    expect(isSuperUnlocked("evm", address)).toBe(false);
    expect(localStorage.getItem(key)).toBeNull();
    expect(locked).toBe(1);
    await expect(getValidAccessToken("evm", address)).resolves.toBeNull();
  });
});
