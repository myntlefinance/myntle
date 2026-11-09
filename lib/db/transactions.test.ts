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
            return Promise.resolve({ data: state.rows, error: null });
          },
        };
        return query;
      },
      update(patch: Record<string, unknown>) {
        return {
          eq: () => {
            state.updates.push(patch);
            if (
              state.missingColumn &&
              "status_checked_at" in patch
            ) {
              return Promise.resolve({
                error: {
                  code: "42703",
                  message:
                    "column transactions.status_checked_at does not exist",
                },
              });
            }
            return Promise.resolve({ error: null });
          },
        };
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
