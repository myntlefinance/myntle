import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addWatchlistEntry,
  fetchWatchlist,
  insertWatchlistEntry,
  removeWatchlistEntry,
  updateWatchlistDefault,
  updateWatchlistEntry,
  type WatchlistEntry,
} from "./useWatchlist";

/**
 * The watchlist fetchers against mocked fetch.
 *
 * Each round-trips the route shape; failures surface as Error values with
 * the route's message, never as thrown Response objects or hangs.
 */

const ENTRY: WatchlistEntry = {
  id: "watch-1",
  chain: "evm",
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  label: "Vault",
  isDefault: false,
  createdAt: "2026-11-06T12:00:00.000Z",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ entries: [] })),
  );
});

describe("fetchWatchlist", () => {
  it("lists the entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ entries: [ENTRY] })),
    );

    const entries = await fetchWatchlist();

    expect(entries).toEqual([ENTRY]);
    expect(fetch).toHaveBeenCalledWith("/api/watchlist", {
      cache: "no-store",
    });
  });

  it("carries the tracked name through", async () => {
    const named = {
      ...ENTRY,
      label: "vitalik.eth",
      resolvedName: "vitalik.eth",
      resolvedAt: "2026-11-08T12:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ entries: [named] })),
    );

    const entries = await fetchWatchlist();

    expect(entries).toEqual([named]);
  });

  it("surfaces the route error without throwing the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "Not signed in." }, 401)),
    );

    await expect(fetchWatchlist()).rejects.toThrow("Not signed in.");
  });
});

describe("addWatchlistEntry", () => {
  it("posts the chain, address, and label", async () => {
    const stub = vi.fn(async () => json({ entry: ENTRY }));
    vi.stubGlobal("fetch", stub);

    const entry = await addWatchlistEntry({
      chain: "evm",
      address: ENTRY.address,
      label: "Vault",
    });

    expect(entry).toEqual(ENTRY);
    expect(stub).toHaveBeenCalledWith("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chain: "evm",
        address: ENTRY.address,
        label: "Vault",
      }),
    });
  });

  it("surfaces an invalid address without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "Invalid request." }, 400)),
    );

    await expect(
      addWatchlistEntry({ chain: "evm", address: "0x123" }),
    ).rejects.toThrow("Invalid request.");
  });
});

describe("insertWatchlistEntry", () => {
  it("appends a newly tracked row after the cards on screen", () => {
    const tracked = { ...ENTRY, id: "watch-2", label: "Desk" };

    expect(insertWatchlistEntry([ENTRY], tracked)).toEqual([ENTRY, tracked]);
  });

  it("keeps a duplicate add in its existing slot", () => {
    const renamed = { ...ENTRY, label: "Desk" };

    expect(insertWatchlistEntry([ENTRY], renamed)).toEqual([renamed]);
  });

  it("leaves a list that never landed to its own read", () => {
    expect(insertWatchlistEntry(undefined, ENTRY)).toBeUndefined();
  });
});

describe("removeWatchlistEntry", () => {
  it("deletes by encoded id", async () => {
    const stub = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", stub);

    await removeWatchlistEntry("watch-1");

    expect(stub).toHaveBeenCalledWith("/api/watchlist/watch-1", {
      method: "DELETE",
    });
  });

  it("surfaces a missing row without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "An error occurred." }, 404)),
    );

    await expect(removeWatchlistEntry("gone")).rejects.toThrow(
      "An error occurred.",
    );
  });
});

describe("updateWatchlistEntry", () => {
  it("patches the label by encoded id", async () => {
    const stub = vi.fn(async () =>
      json({ entry: { ...ENTRY, label: "Desk" } }),
    );
    vi.stubGlobal("fetch", stub);

    const entry = await updateWatchlistEntry("watch-1", {
      label: "Desk",
      chain: "evm",
      address: ENTRY.address,
    });

    expect(entry).toMatchObject({ id: "watch-1", label: "Desk" });
    expect(stub).toHaveBeenCalledWith("/api/watchlist/watch-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Desk",
        chain: "evm",
        address: ENTRY.address,
      }),
    });
  });

  it("surfaces a missing row without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "An error occurred." }, 404)),
    );

    await expect(
      updateWatchlistEntry("gone", { label: "Desk" }),
    ).rejects.toThrow("An error occurred.");
  });
});

describe("updateWatchlistDefault", () => {
  it("marks the default by encoded id", async () => {
    const stub = vi.fn(async () =>
      json({ entry: { ...ENTRY, isDefault: true } }),
    );
    vi.stubGlobal("fetch", stub);

    const entry = await updateWatchlistDefault("watch-1", true);

    expect(entry).toMatchObject({ id: "watch-1", isDefault: true });
    expect(stub).toHaveBeenCalledWith("/api/watchlist/watch-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
  });

  it("surfaces a missing row without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "An error occurred." }, 404)),
    );

    await expect(updateWatchlistDefault("gone", true)).rejects.toThrow(
      "An error occurred.",
    );
  });
});
