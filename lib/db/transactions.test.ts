import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The settlement read must survive a database that has not run migration 007.
 *
 * `status_checked_at` is an optional freshness stamp. When the select asks for
 * it and the column is missing, PostgREST fails the whole row: every card
 * loses its address and metadata, which hides the funding control. The fallback
 * keeps the record and drops only the timestamp.
 */

type Row = {
  id: string;
  state: string;
  deposit_address: string | null;
  refs: Record<string, unknown>;
  outcome: Record<string, unknown>;
  tool_approval_id: string;
  status_checked_at?: string | null;
};

const state = vi.hoisted(() => ({
  selectColumns: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
  rows: [] as Row[],
  missingColumn: true,
  missingConsumedColumn: true,
  consumeClaimed: false,
  transitionClaimed: false,
  readError: null as null | { code?: string; message?: string },
}));

vi.mock("./client", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select(columns: string) {
        state.selectColumns.push(columns);
        const query = {
          eq: () => query,
          in: () => query,
          order: () => {
            if (
              state.missingColumn &&
              columns.includes("status_checked_at")
            ) {
              return Promise.resolve({
                data: null,
                error: {
                  code: "42703",
                  message:
                    "column transactions.status_checked_at does not exist",
                },
              });
            }
            const ordered = {
              limit: (n: number) =>
                Promise.resolve(
                  state.readError
                    ? { data: null, error: state.readError }
                    : { data: state.rows.slice(0, n), error: null },
                ),
            };
            // Awaitable for the legacy list reads, chainable for the
            // newest-row lookup.
            return Object.assign(ordered, {
              then: (resolve: (v: unknown) => void) =>
                resolve({ data: state.rows, error: null }),
            });
          },
          limit: () =>
            Promise.resolve(
              state.readError
                ? { data: null, error: state.readError }
                : { data: state.rows.slice(0, 1), error: null },
            ),
        };
        return query;
      },
      update(patch: Record<string, unknown>) {
        // Chainable for the atomic guards (`consumeQuote`,
        // `transitionTransactionState`), awaitable for the legacy blind
        // writes. `select` resolves the guard reads; the bare awaited
        // chain resolves the legacy `{ error }` shape.
        const query = {
          eq: () => query,
          is: () => query,
          select: () => {
            if ("consumed_at" in patch) {
              if (state.missingConsumedColumn) {
                return Promise.resolve({
                  data: null,
                  error: {
                    code: "42703",
                    message: "column quotes.consumed_at does not exist",
                  },
                });
              }
              if (state.consumeClaimed) {
                return Promise.resolve({ data: [], error: null });
              }
              state.consumeClaimed = true;
              return Promise.resolve({ data: [{ id: "q-1" }], error: null });
            }
            if (state.transitionClaimed) {
              return Promise.resolve({ data: [], error: null });
            }
            state.transitionClaimed = true;
            return Promise.resolve({ data: [{ id: "tx-1" }], error: null });
          },
        };
        const legacy = Object.assign(query, {
          then: (resolve: (v: unknown) => void) => {
            state.updates.push(patch);
            if (
              state.missingColumn &&
              "status_checked_at" in patch
            ) {
              resolve({
                error: {
                  code: "42703",
                  message:
                    "column transactions.status_checked_at does not exist",
                },
              });
              return;
            }
            resolve({ error: null });
          },
        });
        return legacy;
      },
    }),
  }),
}));

const row: Row = {
  id: "tx-1",
  state: "pending",
  deposit_address: "0x4f3A3dd95b2baaF5Dd1ad81E1E953788B84f0825",
  refs: {
    mode: "confidential-external",
    amountInRaw: "10000000000000000000",
    tokenContract: null,
    chainId: 1,
    chainName: "Ethereum",
    chainSlug: "eth",
    decimals: 18,
    symbol: "ETH",
    expiresAt: "2026-11-07T21:23:30.002Z",
  },
  outcome: {},
  tool_approval_id: "aitxt-1",
};

beforeEach(() => {
  vi.resetModules();
  state.selectColumns = [];
  state.updates = [];
  state.rows = [row];
  state.missingColumn = true;
  state.missingConsumedColumn = true;
  state.consumeClaimed = false;
  state.transitionClaimed = false;
  state.readError = null;
});

describe("a database before migration 007", () => {
  it("still returns the settlement and its deposit metadata", async () => {
    const { listToolApprovalSettlements } = await import("./transactions");

    const [settlement] = await listToolApprovalSettlements("user-1", [
      "aitxt-1",
    ]);

    expect(settlement).toMatchObject({
      toolApprovalId: "aitxt-1",
      transactionId: "tx-1",
      state: "pending",
      statusCheckedAt: null,
      deposit: {
        address: row.deposit_address,
        amountInRaw: "10000000000000000000",
        chainId: 1,
        symbol: "ETH",
        decimals: 18,
      },
    });
    expect(state.selectColumns[0]).toContain("status_checked_at");
    expect(state.selectColumns[1]).not.toContain("status_checked_at");
  });

  it("records a settlement state without the missing timestamp", async () => {
    const { setTransactionStatus } = await import("./transactions");

    await setTransactionStatus(
      "tx-1",
      "processing",
      "2026-11-05T00:00:00.000Z",
    );

    expect(state.updates).toEqual([
      {
        state: "processing",
        status_checked_at: "2026-11-05T00:00:00.000Z",
      },
      { state: "processing" },
    ]);
  });
});

describe("the refusal guard read", () => {
  it("reports a transaction for the proposal", async () => {
    const { hasToolApprovalSettlement } = await import("./transactions");

    await expect(
      hasToolApprovalSettlement("user-1", "aitxt-1"),
    ).resolves.toBe(true);
  });

  it("reports none when the proposal never produced a transaction", async () => {
    state.rows = [];
    const { hasToolApprovalSettlement } = await import("./transactions");

    await expect(
      hasToolApprovalSettlement("user-1", "aitxt-1"),
    ).resolves.toBe(false);
  });

  it("throws instead of answering none when the read fails", async () => {
    // A refusal may not be written over a deposit whose record we could not
    // read, so the helper must not turn a database error into "no trade".
    state.readError = { message: "connection failure" };
    const { hasToolApprovalSettlement } = await import("./transactions");

    await expect(
      hasToolApprovalSettlement("user-1", "aitxt-1"),
    ).rejects.toThrow("The settlement could not be read.");
  });
});

describe("single-use dry quotes (migration 014)", () => {
  it("claims a preview exactly once", async () => {
    state.missingConsumedColumn = false;
    const { consumeQuote } = await import("./transactions");

    await expect(consumeQuote("q-1", "user-1")).resolves.toBe(true);
    await expect(consumeQuote("q-1", "user-1")).resolves.toBe(false);
  });

  it("proceeds unguarded with a warning before migration 014", async () => {
    state.missingConsumedColumn = true;
    const { consumeQuote } = await import("./transactions");

    await expect(consumeQuote("q-1", "user-1")).resolves.toBe(true);
  });
});

describe("conditional state transitions", () => {
  it("lets exactly one concurrent submit win", async () => {
    const { transitionTransactionState } = await import("./transactions");

    await expect(
      transitionTransactionState("tx-1", "awaiting_approval", "submitted"),
    ).resolves.toBe(true);
    await expect(
      transitionTransactionState("tx-1", "awaiting_approval", "submitted"),
    ).resolves.toBe(false);
  });
});

describe("deposit idempotency lookup", () => {
  it("returns the newest transaction for the proposal", async () => {
    const { getTransactionByToolApprovalId } = await import("./transactions");

    const found = await getTransactionByToolApprovalId("user-1", "aitxt-1");
    expect(found?.id).toBe("tx-1");
  });

  it("returns null when the proposal never produced a transaction", async () => {
    state.rows = [];
    const { getTransactionByToolApprovalId } = await import("./transactions");

    await expect(
      getTransactionByToolApprovalId("user-1", "aitxt-1"),
    ).resolves.toBeNull();
  });

  it("throws instead of minting over an unreadable record", async () => {
    state.readError = { message: "connection failure" };
    const { getTransactionByToolApprovalId } = await import("./transactions");

    await expect(
      getTransactionByToolApprovalId("user-1", "aitxt-1"),
    ).rejects.toThrow("The settlement could not be read.");
  });
});
