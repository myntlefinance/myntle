import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

import { createNearSetupGrant } from "./near-setup";

const ROW = {
  id: "grant-1",
  user_id: "user-1",
  account_id: "myntlefinance.near",
  public_key: "ed25519:Cnt4Fm9Td6fBiKe6uK9t1gzAC5T6JZHbF5nCTTeAchSC",
  amount: "1500000000000000000000",
  status: "pending",
  tx_hash: null,
  error: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const INPUT = {
  userId: "user-1",
  accountId: "myntlefinance.near",
  publicKey: "ed25519:Cnt4Fm9Td6fBiKe6uK9t1gzAC5T6JZHbF5nCTTeAchSC",
  amount: "1500000000000000000000",
};

function insertResult(data: unknown, error: unknown = null) {
  return {
    insert: () => ({
      select: () => ({
        maybeSingle: async () => ({ data, error }),
      }),
    }),
  };
}

function selectRowResult(data: unknown) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data, error: null }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  fromMock.mockReset();
});

describe("createNearSetupGrant", () => {
  it("reports the insert winner", async () => {
    fromMock.mockReturnValueOnce(insertResult(ROW));

    const result = await createNearSetupGrant(INPUT);

    expect(result.created).toBe(true);
    expect(result.grant.id).toBe("grant-1");
  });

  it("returns the existing row on a unique conflict and reports no send", async () => {
    fromMock
      .mockReturnValueOnce(insertResult(null, { code: "23505" }))
      .mockReturnValueOnce(selectRowResult(ROW));

    const result = await createNearSetupGrant(INPUT);

    expect(result.created).toBe(false);
    expect(result.grant.accountId).toBe("myntlefinance.near");
  });

  it("does not treat another write error as a conflict", async () => {
    fromMock.mockReturnValueOnce(insertResult(null, { code: "42501" }));

    await expect(createNearSetupGrant(INPUT)).rejects.toThrow(
      "The NEAR setup record could not be written.",
    );
    expect(fromMock).toHaveBeenCalledTimes(1);
  });
});
