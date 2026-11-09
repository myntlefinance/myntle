import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPrivateBalances,
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

describe("fetchPrivateBalances", () => {
  const fresh = (address: string) => {
    saveIntentsSession({
      chain: "evm",
      address,
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 900,
      refreshExpiresIn: 3600,
    });
  };

  it("reports an unreachable service as an error and keeps the session", async () => {
    const { events } = fakeBrowser();
    vi.stubGlobal("window", events);
    const address = "0xAbC0000000000000000000000000000000000002";
    fresh(address);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(fetchPrivateBalances("evm", address)).resolves.toEqual({
      ok: false,
      reason: "error",
    });
    expect(isSuperUnlocked("evm", address)).toBe(true);
  });

  it("forgets a session the service refuses even after a refresh", async () => {
    const { events } = fakeBrowser();
    vi.stubGlobal("window", events);
    const address = "0xAbC0000000000000000000000000000000000003";
    fresh(address);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        // The balance read refuses the access token, then the refresh
        // token itself is refused: the session is dead, not the service.
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 })),
    );

    await expect(fetchPrivateBalances("evm", address)).resolves.toEqual({
      ok: false,
      reason: "locked",
    });
    expect(isSuperUnlocked("evm", address)).toBe(false);
  });

  it("keeps the session when only the refresh service fails", async () => {
    const { events } = fakeBrowser();
    vi.stubGlobal("window", events);
    const address = "0xAbC0000000000000000000000000000000000004";
    fresh(address);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 503 })),
    );

    await expect(fetchPrivateBalances("evm", address)).resolves.toEqual({
      ok: false,
      reason: "error",
    });
    expect(isSuperUnlocked("evm", address)).toBe(true);
  });
});
