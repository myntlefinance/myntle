import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ col: string; value: string }>,
  orders: [] as string[],
  table: "",
  singles: 0,
  mode: "list-ok" as
    | "list-ok"
    | "insert-ok"
    | "insert-duplicate-then-found"
    | "insert-duplicate-then-missing"
    | "delete-ok"
    | "delete-missing"
    | "update-ok"
    | "update-missing",
  inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
}));

vi.mock("./client", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      state.table = table;
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.insert = (payload: Record<string, unknown>) => {
        state.inserted = payload;
        return query;
      };
      query.update = (payload: Record<string, unknown>) => {
        state.updated = payload;
        return query;
      };
      query.delete = () => query;
      query.eq = (col: string, value: string) => {
        state.calls.push({ col, value });
        return query;
      };
      query.order = (col: string) => {
        state.orders.push(col);
        return query;
      };
      query.then = (resolve: (value: unknown) => void) => {
        if (state.mode === "list-ok") {
          return resolve({
            data: [
              {
                id: "watch-1",
                user_id: "user-a",
                chain: "evm",
                address: "0xabc",
                label: "Vault",
                created_at: "2026-11-06T12:00:00.000Z",
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      };
      query.single = () => {
        state.singles += 1;
        switch (state.mode) {
          case "insert-ok":
            return Promise.resolve({ data: { id: "watch-1" }, error: null });
          case "insert-duplicate-then-found":
            // First single() is the failed insert; second is the scoped read.
            if (state.singles === 1) {
              return Promise.resolve({
                data: null,
                error: { code: "23505" },
              });
            }
            return Promise.resolve({ data: { id: "watch-1" }, error: null });
          case "insert-duplicate-then-missing":
            if (state.singles === 1) {
              return Promise.resolve({
                data: null,
                error: { code: "23505" },
              });
            }
            return Promise.resolve({
              data: null,
              error: { code: "PGRST116" },
            });
          case "delete-ok":
            return Promise.resolve({ data: { id: "watch-1" }, error: null });
          case "delete-missing":
            return Promise.resolve({
              data: null,
              error: { code: "PGRST116" },
            });
          case "update-ok":
            return Promise.resolve({
              data: { id: "watch-1", label: "Desk" },
              error: null,
            });
          case "update-missing":
            return Promise.resolve({
              data: null,
              error: { code: "PGRST116" },
            });
          default:
            return Promise.resolve({ data: null, error: null });
        }
      };
      return query;
    },
  }),
}));

import {
  addWatchedAddress,
  findWatchedAddress,
  getWatchedAddress,
  listWatchedAddresses,
  removeWatchedAddress,
  setDefaultWatchedAddress,
  updateWatchedAddress,
} from "./watchlist";

/**
 * The watchlist storage scope: every query carries the caller's user id,
 * so one watcher can never read or delete another's rows.
 */

beforeEach(() => {
  state.calls = [];
  state.orders = [];
  state.table = "";
  state.singles = 0;
  state.inserted = null;
  state.updated = null;
  state.mode = "list-ok";
});

describe("listWatchedAddresses", () => {
  it("scopes the read to the caller's user id", async () => {
    const rows = await listWatchedAddresses("user-a");

    expect(state.table).toBe("watched_addresses");
    expect(state.calls).toContainEqual({ col: "user_id", value: "user-a" });
    expect(rows).toHaveLength(1);
  });

  it("lists the default first, then newest", async () => {
    await listWatchedAddresses("user-a");

    expect(state.orders).toEqual(["is_default", "created_at"]);
  });
});

describe("addWatchedAddress", () => {
  it("inserts with the caller's user id", async () => {
    state.mode = "insert-ok";

    await addWatchedAddress({
      userId: "user-a",
      chain: "evm",
      address: "0xabc",
      label: "Vault",
    });

    expect(state.table).toBe("watched_addresses");
    expect(state.inserted).toMatchObject({
      user_id: "user-a",
      chain: "evm",
      address: "0xabc",
    });
  });

  it("returns the existing row when the address is already tracked", async () => {
    state.mode = "insert-duplicate-then-found";

    const row = await addWatchedAddress({
      userId: "user-a",
      chain: "evm",
      address: "0xabc",
      label: "Vault",
    });

    expect(row).toMatchObject({ id: "watch-1" });
    // The fallback read re-scopes to the caller, never to anyone else.
    expect(state.calls).toContainEqual({ col: "user_id", value: "user-a" });
    expect(state.calls).toContainEqual({ col: "chain", value: "evm" });
    expect(state.calls).toContainEqual({ col: "address", value: "0xabc" });
  });

  it("throws when the duplicate fallback finds nothing", async () => {
    state.mode = "insert-duplicate-then-missing";

    await expect(
      addWatchedAddress({
        userId: "user-a",
        chain: "evm",
        address: "0xabc",
        label: "Vault",
      }),
    ).rejects.toThrow("The address could not be tracked.");
  });
});

describe("removeWatchedAddress", () => {
  it("deletes only the caller's row", async () => {
    state.mode = "delete-ok";

    const removed = await removeWatchedAddress("user-a", "watch-1");

    expect(removed).toBe(true);
    expect(state.calls).toContainEqual({ col: "id", value: "watch-1" });
    expect(state.calls).toContainEqual({ col: "user_id", value: "user-a" });
  });

  it("reports another watcher's row as missing", async () => {
    state.mode = "delete-missing";

    const removed = await removeWatchedAddress("user-a", "someone-elses-row");

    expect(removed).toBe(false);
    expect(state.calls).toContainEqual({
      col: "user_id",
      value: "user-a",
    });
  });
});

describe("updateWatchedAddress", () => {
  it("updates the label on the caller's row", async () => {
    state.mode = "update-ok";

    const row = await updateWatchedAddress({
      userId: "user-a",
      id: "watch-1",
      label: "Desk",
    });

    expect(state.table).toBe("watched_addresses");
    expect(state.updated).toMatchObject({ label: "Desk" });
    expect(state.calls).toContainEqual({ col: "id", value: "watch-1" });
    expect(state.calls).toContainEqual({ col: "user_id", value: "user-a" });
    expect(row).toMatchObject({ id: "watch-1", label: "Desk" });
  });

  it("moves the row when the chain and address change", async () => {
    state.mode = "update-ok";

    await updateWatchedAddress({
      userId: "user-a",
      id: "watch-1",
      label: "Desk",
      chain: "near",
      address: "desk.near",
    });

    expect(state.updated).toMatchObject({
      label: "Desk",
      chain: "near",
      address: "desk.near",
    });
  });

  it("reports another watcher's row as missing", async () => {
    state.mode = "update-missing";

    const row = await updateWatchedAddress({
      userId: "user-a",
      id: "someone-elses-row",
      label: "Desk",
    });

    expect(row).toBeNull();
    expect(state.calls).toContainEqual({
      col: "user_id",
      value: "user-a",
    });
  });
});

describe("findWatchedAddress", () => {
  it("scopes the lookup to the caller", async () => {
    state.mode = "update-ok";

    const row = await findWatchedAddress({
      userId: "user-a",
      chain: "evm",
      address: "0xabc",
    });

    expect(state.calls).toContainEqual({ col: "user_id", value: "user-a" });
    expect(state.calls).toContainEqual({ col: "chain", value: "evm" });
    expect(state.calls).toContainEqual({ col: "address", value: "0xabc" });
    expect(row).toMatchObject({ id: "watch-1" });
  });

  it("returns null when nothing is tracked", async () => {
    state.mode = "update-missing";

    const row = await findWatchedAddress({
      userId: "user-a",
      chain: "evm",
      address: "0x000",
    });

    expect(row).toBeNull();
  });
});

describe("setDefaultWatchedAddress", () => {
  it("clears the old flag before marking the row", async () => {
    state.mode = "update-ok";

    const row = await setDefaultWatchedAddress({
      userId: "user-a",
      id: "watch-1",
    });

    expect(row).toMatchObject({ id: "watch-1" });
    expect(state.updated).toMatchObject({ is_default: true });
    expect(state.calls).toContainEqual({ col: "user_id", value: "user-a" });
    expect(state.calls).toContainEqual({ col: "id", value: "watch-1" });
  });

  it("clears without marking when the id is null", async () => {
    state.mode = "update-ok";

    const row = await setDefaultWatchedAddress({
      userId: "user-a",
      id: null,
    });

    expect(row).toBeNull();
    expect(state.singles).toBe(0);
    expect(state.updated).toMatchObject({ is_default: false });
  });
});

describe("getWatchedAddress", () => {
  it("reads only the caller's row", async () => {
    state.mode = "update-ok";

    const row = await getWatchedAddress({ userId: "user-a", id: "watch-1" });

    expect(state.calls).toContainEqual({ col: "id", value: "watch-1" });
    expect(state.calls).toContainEqual({ col: "user_id", value: "user-a" });
    expect(row).toMatchObject({ id: "watch-1" });
  });

  it("returns null for another watcher's row", async () => {
    state.mode = "update-missing";

    const row = await getWatchedAddress({
      userId: "user-a",
      id: "someone-elses-row",
    });

    expect(row).toBeNull();
  });
});
