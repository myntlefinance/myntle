import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, listMock, addMock, removeMock, findMock, getMock, setDefaultMock } = vi.hoisted(
  () => ({
    requireSessionMock: vi.fn(),
    listMock: vi.fn(),
    addMock: vi.fn(),
    removeMock: vi.fn(),
    findMock: vi.fn(),
    getMock: vi.fn(),
    setDefaultMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/db/watchlist", () => ({
  listWatchedAddresses: listMock,
  addWatchedAddress: addMock,
  removeWatchedAddress: removeMock,
  findWatchedAddress: findMock,
  getWatchedAddress: getMock,
  setDefaultWatchedAddress: setDefaultMock,
}));

import { DELETE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";

/**
 * The watchlist routes.
 *
 * Auth is required, every query is scoped by the session's user id, invalid
 * addresses never reach storage, and a duplicate add stays one row. Five
 * addresses at most: the sixth is rejected, while a duplicate still
 * returns its row. A caller can only ever see or delete their own rows.
 */

const USER_A = "user-a";
const CHECKSUMMED = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

const sessionA = {
  userId: USER_A,
  accountKind: "wallet" as const,
  walletId: "wallet-1",
  passkeyId: null,
  intentsAccountId: "alice.near",
  chain: "near" as const,
  address: "alice.near",
  createdAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "watch-1",
    user_id: USER_A,
    chain: "evm",
    address: CHECKSUMMED,
    label: "Vault",
    is_default: false,
    created_at: "2026-11-06T12:00:00.000Z",
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/watchlist/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(id: string): Request {
  return new Request(`http://localhost/api/watchlist/${id}`, {
    method: "DELETE",
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue(sessionA);
  findMock.mockResolvedValue(null);
  listMock.mockResolvedValue([]);
});

describe("GET /api/watchlist", () => {
  it("rejects an unauthenticated caller", async () => {
    requireSessionMock.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/watchlist"));

    expect(res.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("lists the caller's rows newest first", async () => {
    listMock.mockResolvedValue([row(), row({ id: "watch-2" })]);

    const res = await GET(new Request("http://localhost/api/watchlist"));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(USER_A);
    expect(body.entries).toHaveLength(2);
  });
});

describe("POST /api/watchlist", () => {
  it("rejects an unauthenticated caller", async () => {
    requireSessionMock.mockResolvedValue(null);

    const res = await POST(post({ chain: "evm", address: CHECKSUMMED }));

    expect(res.status).toBe(401);
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed address before storage", async () => {
    const res = await POST(post({ chain: "evm", address: "0x123" }));

    expect(res.status).toBe(400);
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects an over-length label", async () => {
    const res = await POST(
      post({ chain: "evm", address: CHECKSUMMED, label: "x".repeat(25) }),
    );

    expect(res.status).toBe(400);
    expect(addMock).not.toHaveBeenCalled();
  });

  it("stores the checksummed address with a default label", async () => {
    addMock.mockResolvedValue(row());

    const res = await POST(
      post({ chain: "evm", address: CHECKSUMMED.toLowerCase() }),
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(addMock).toHaveBeenCalledWith({
      userId: USER_A,
      chain: "evm",
      address: CHECKSUMMED,
      label: "0xaf88…5831",
    });
    expect(body.entry).toMatchObject({ chain: "evm", address: CHECKSUMMED });
  });

  it("returns the one row when the address is already tracked", async () => {
    findMock.mockResolvedValue(row());

    const first = await POST(post({ chain: "evm", address: CHECKSUMMED }));
    const second = await POST(post({ chain: "evm", address: CHECKSUMMED }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(addMock).not.toHaveBeenCalled();
    expect(
      ((await second.json()) as { entry: { id: string } }).entry.id,
    ).toBe("watch-1");
  });

  it("rejects a sixth address with a reason", async () => {
    findMock.mockResolvedValue(null);
    listMock.mockResolvedValue([
      row({ id: "w1" }),
      row({ id: "w2" }),
      row({ id: "w3" }),
      row({ id: "w4" }),
      row({ id: "w5" }),
    ]);

    const res = await POST(post({ chain: "evm", address: CHECKSUMMED }));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(409);
    expect(body.error).toBe("You can track up to 5 addresses.");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("returns the existing row at the limit instead of rejecting", async () => {
    findMock.mockResolvedValue(row());
    listMock.mockResolvedValue([
      row({ id: "w1" }),
      row({ id: "w2" }),
      row({ id: "w3" }),
      row({ id: "w4" }),
      row({ id: "w5" }),
    ]);

    const res = await POST(post({ chain: "evm", address: CHECKSUMMED }));

    expect(res.status).toBe(200);
    expect(addMock).not.toHaveBeenCalled();
    expect(
      ((await res.json()) as { entry: { id: string } }).entry.id,
    ).toBe("watch-1");
  });
});

describe("DELETE /api/watchlist/[id]", () => {
  it("rejects an unauthenticated caller", async () => {
    requireSessionMock.mockResolvedValue(null);

    const res = await DELETE(del("watch-1"), params("watch-1"));

    expect(res.status).toBe(401);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deletes only the caller's row", async () => {
    removeMock.mockResolvedValue(true);

    const res = await DELETE(del("watch-1"), params("watch-1"));

    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith(USER_A, "watch-1");
  });

  it("reports a row it cannot see as missing", async () => {
    removeMock.mockResolvedValue(false);

    const res = await DELETE(del("someone-elses-row"), params("someone-elses-row"));

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/watchlist/[id] isDefault", () => {
  it("marks the default a fresh visit opens to", async () => {
    getMock.mockResolvedValue(row());
    setDefaultMock.mockResolvedValue(row({ is_default: true }));

    const res = await PATCH(patch("watch-1", { isDefault: true }), params("watch-1"));
    const body = (await res.json()) as { entry: { isDefault: boolean } };

    expect(res.status).toBe(200);
    expect(setDefaultMock).toHaveBeenCalledWith({
      userId: USER_A,
      id: "watch-1",
    });
    expect(body.entry.isDefault).toBe(true);
  });

  it("unmarks only when the row holds the flag", async () => {
    getMock.mockResolvedValue(row({ is_default: true }));
    setDefaultMock.mockResolvedValue(null);

    const res = await PATCH(patch("watch-1", { isDefault: false }), params("watch-1"));
    const body = (await res.json()) as { entry: { isDefault: boolean } };

    expect(res.status).toBe(200);
    expect(setDefaultMock).toHaveBeenCalledWith({
      userId: USER_A,
      id: null,
    });
    expect(body.entry.isDefault).toBe(false);
  });

  it("leaves the flag alone when the row never held it", async () => {
    getMock.mockResolvedValue(row({ is_default: false }));

    const res = await PATCH(patch("watch-1", { isDefault: false }), params("watch-1"));

    expect(res.status).toBe(200);
    expect(setDefaultMock).not.toHaveBeenCalled();
  });

  it("reports a row it cannot see as missing", async () => {
    getMock.mockResolvedValue(null);

    const res = await PATCH(patch("someone-elses-row", { isDefault: true }), params("someone-elses-row"));

    expect(res.status).toBe(404);
    expect(setDefaultMock).not.toHaveBeenCalled();
  });
});
