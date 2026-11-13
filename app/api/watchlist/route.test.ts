import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, listMock, addMock, removeMock, findMock, getMock, setDefaultMock, updateMock, resolveNameMock } = vi.hoisted(
  () => ({
    requireSessionMock: vi.fn(),
    listMock: vi.fn(),
    addMock: vi.fn(),
    removeMock: vi.fn(),
    findMock: vi.fn(),
    getMock: vi.fn(),
    setDefaultMock: vi.fn(),
    updateMock: vi.fn(),
    resolveNameMock: vi.fn(),
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
  updateWatchedAddress: updateMock,
}));

vi.mock("@/lib/adapters/registry", () => ({
  getNameResolverPort: () => ({ resolveName: resolveNameMock }),
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
      resolvedName: null,
      resolvedAt: null,
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

  it("leaves the raw path on its own read", async () => {
    addMock.mockResolvedValue(row());

    const res = await POST(post({ chain: "evm", address: CHECKSUMMED }));

    expect(res.status).toBe(200);
    expect(resolveNameMock).not.toHaveBeenCalled();
    expect(addMock).toHaveBeenCalledWith({
      userId: USER_A,
      chain: "evm",
      address: CHECKSUMMED,
      label: "0xaf88…5831",
      resolvedName: null,
      resolvedAt: null,
    });
  });
});

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const VITALIK_HIT = {
  address: VITALIK,
  name: "vitalik.eth",
  resolvedAt: "2026-11-08T12:00:00.000Z",
};

describe("POST /api/watchlist with a name", () => {
  it("tracks a name through the server's own read with the name as label", async () => {
    resolveNameMock.mockResolvedValue(VITALIK_HIT);
    addMock.mockResolvedValue(
      row({
        address: VITALIK,
        label: "vitalik.eth",
        resolved_name: "vitalik.eth",
        resolved_at: VITALIK_HIT.resolvedAt,
      }),
    );

    const res = await POST(post({ chain: "evm", address: "vitalik.eth" }));
    const body = (await res.json()) as { entry: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(resolveNameMock).toHaveBeenCalledWith("evm", "vitalik.eth");
    expect(findMock).toHaveBeenCalledWith({
      userId: USER_A,
      chain: "evm",
      address: VITALIK,
    });
    expect(addMock).toHaveBeenCalledWith({
      userId: USER_A,
      chain: "evm",
      address: VITALIK,
      label: "vitalik.eth",
      resolvedName: "vitalik.eth",
      resolvedAt: VITALIK_HIT.resolvedAt,
    });
    expect(body.entry).toMatchObject({
      address: VITALIK,
      label: "vitalik.eth",
      resolvedName: "vitalik.eth",
      resolvedAt: VITALIK_HIT.resolvedAt,
    });
  });

  it("normalizes the name before the read", async () => {
    resolveNameMock.mockResolvedValue(VITALIK_HIT);
    addMock.mockResolvedValue(row({ address: VITALIK, label: "vitalik.eth" }));

    const res = await POST(post({ chain: "evm", address: "  VITALIK.ETH " }));

    expect(res.status).toBe(200);
    expect(resolveNameMock).toHaveBeenCalledWith("evm", "VITALIK.ETH");
    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({ address: VITALIK, label: "vitalik.eth" }),
    );
  });

  it("keeps a typed label ahead of the name", async () => {
    resolveNameMock.mockResolvedValue(VITALIK_HIT);
    addMock.mockResolvedValue(row({ address: VITALIK, label: "Founder" }));

    const res = await POST(
      post({ chain: "evm", address: "vitalik.eth", label: "Founder" }),
    );

    expect(res.status).toBe(200);
    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Founder", resolvedName: "vitalik.eth" }),
    );
  });

  it("falls back to the truncated address when the name exceeds the label cap", async () => {
    // A 30-character name: past the 24-character label cap, inside the
    // 128-character input cap. The label degrades to the truncated
    // address while the full name is still stored and returned.
    const longName = "abcdefghijklmnopqrstuvwxyz.eth";
    const longHit = {
      address: VITALIK,
      name: longName,
      resolvedAt: "2026-11-08T12:00:00.000Z",
    };
    resolveNameMock.mockResolvedValue(longHit);
    addMock.mockResolvedValue(
      row({
        address: VITALIK,
        label: "0xd8dA…6045",
        resolved_name: longName,
        resolved_at: longHit.resolvedAt,
      }),
    );

    const res = await POST(post({ chain: "evm", address: longName }));
    const body = (await res.json()) as { entry: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(addMock).toHaveBeenCalledWith({
      userId: USER_A,
      chain: "evm",
      address: VITALIK,
      label: "0xd8dA…6045",
      resolvedName: longName,
      resolvedAt: longHit.resolvedAt,
    });
    expect(body.entry).toMatchObject({
      label: "0xd8dA…6045",
      resolvedName: longName,
      resolvedAt: longHit.resolvedAt,
    });
  });

  it("rejects an unregistered name with a complete sentence", async () => {
    resolveNameMock.mockResolvedValue(null);

    const res = await POST(post({ chain: "evm", address: "nobody12345.eth" }));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      "That name is not registered. Check the spelling and try again.",
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("masks a failed name read without storing", async () => {
    resolveNameMock.mockRejectedValue({
      kind: "unavailable",
      reason: "ens_rpc",
      message: "Name lookup is unavailable.",
      retryable: true,
    });

    const res = await POST(post({ chain: "evm", address: "vitalik.eth" }));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(503);
    expect(body.error).toBe("Name lookup is unavailable. Try again shortly.");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("dedupes a name onto its resolved address", async () => {
    resolveNameMock.mockResolvedValue(VITALIK_HIT);
    findMock.mockResolvedValue(row({ address: VITALIK, label: "vitalik.eth" }));

    const res = await POST(post({ chain: "evm", address: "vitalik.eth" }));

    expect(res.status).toBe(200);
    expect(addMock).not.toHaveBeenCalled();
  });
});

const BONFIDA = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
const BONFIDA_HIT = {
  address: BONFIDA,
  name: "bonfida.sns",
  resolvedAt: "2026-11-08T12:00:00.000Z",
};

describe("POST /api/watchlist with a Solana name", () => {
  it("tracks a name through the server's own read with the name as label", async () => {
    resolveNameMock.mockResolvedValue(BONFIDA_HIT);
    addMock.mockResolvedValue(
      row({
        chain: "solana",
        address: BONFIDA,
        label: "bonfida.sns",
        resolved_name: "bonfida.sns",
        resolved_at: BONFIDA_HIT.resolvedAt,
      }),
    );

    const res = await POST(post({ chain: "solana", address: "bonfida.sns" }));
    const body = (await res.json()) as { entry: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(resolveNameMock).toHaveBeenCalledWith("solana", "bonfida.sns");
    expect(findMock).toHaveBeenCalledWith({
      userId: USER_A,
      chain: "solana",
      address: BONFIDA,
    });
    expect(addMock).toHaveBeenCalledWith({
      userId: USER_A,
      chain: "solana",
      address: BONFIDA,
      label: "bonfida.sns",
      resolvedName: "bonfida.sns",
      resolvedAt: BONFIDA_HIT.resolvedAt,
    });
    expect(body.entry).toMatchObject({
      address: BONFIDA,
      label: "bonfida.sns",
      resolvedName: "bonfida.sns",
      resolvedAt: BONFIDA_HIT.resolvedAt,
    });
  });

  it("normalizes the name before the read", async () => {
    resolveNameMock.mockResolvedValue(BONFIDA_HIT);
    addMock.mockResolvedValue(
      row({ chain: "solana", address: BONFIDA, label: "bonfida.sns" }),
    );

    const res = await POST(post({ chain: "solana", address: "  BONFIDA.SNS " }));

    expect(res.status).toBe(200);
    expect(resolveNameMock).toHaveBeenCalledWith("solana", "BONFIDA.SNS");
    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({ address: BONFIDA, label: "bonfida.sns" }),
    );
  });

  it("keeps a typed label ahead of the name", async () => {
    resolveNameMock.mockResolvedValue(BONFIDA_HIT);
    addMock.mockResolvedValue(
      row({ chain: "solana", address: BONFIDA, label: "Treasury" }),
    );

    const res = await POST(
      post({ chain: "solana", address: "bonfida.sns", label: "Treasury" }),
    );

    expect(res.status).toBe(200);
    expect(addMock).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Treasury", resolvedName: "bonfida.sns" }),
    );
  });

  it("falls back to the truncated address when the name exceeds the label cap", async () => {
    // A 30-character name: past the 24-character label cap, inside the
    // 128-character input cap. The label degrades to the truncated
    // address while the full name is still stored and returned.
    const longName = "abcdefghijklmnopqrstuvwxyz.sns";
    const longHit = {
      address: BONFIDA,
      name: longName,
      resolvedAt: "2026-11-08T12:00:00.000Z",
    };
    resolveNameMock.mockResolvedValue(longHit);
    addMock.mockResolvedValue(
      row({
        chain: "solana",
        address: BONFIDA,
        label: "Fw1E…Lb1v",
        resolved_name: longName,
        resolved_at: longHit.resolvedAt,
      }),
    );

    const res = await POST(post({ chain: "solana", address: longName }));
    const body = (await res.json()) as { entry: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(addMock).toHaveBeenCalledWith({
      userId: USER_A,
      chain: "solana",
      address: BONFIDA,
      label: "Fw1E…Lb1v",
      resolvedName: longName,
      resolvedAt: longHit.resolvedAt,
    });
    expect(body.entry).toMatchObject({
      label: "Fw1E…Lb1v",
      resolvedName: longName,
      resolvedAt: longHit.resolvedAt,
    });
  });

  it("rejects an unregistered name with a complete sentence", async () => {
    resolveNameMock.mockResolvedValue(null);

    const res = await POST(
      post({ chain: "solana", address: "unregistered-xyz.sns" }),
    );
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      "That name is not registered. Check the spelling and try again.",
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("masks a failed name read without storing", async () => {
    resolveNameMock.mockRejectedValue({
      kind: "unavailable",
      reason: "sns_proxy",
      message: "Name lookup is unavailable.",
      retryable: true,
    });

    const res = await POST(post({ chain: "solana", address: "bonfida.sns" }));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(503);
    expect(body.error).toBe("Name lookup is unavailable. Try again shortly.");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("dedupes a name onto its resolved address", async () => {
    resolveNameMock.mockResolvedValue(BONFIDA_HIT);
    findMock.mockResolvedValue(
      row({ chain: "solana", address: BONFIDA, label: "bonfida.sns" }),
    );

    const res = await POST(post({ chain: "solana", address: "bonfida.sns" }));

    expect(res.status).toBe(200);
    expect(addMock).not.toHaveBeenCalled();
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

describe("PATCH /api/watchlist/[id] with a name", () => {
  it("re-resolves on edit when the input is a name", async () => {
    getMock.mockResolvedValue(row());
    resolveNameMock.mockResolvedValue(VITALIK_HIT);
    updateMock.mockResolvedValue(
      row({
        address: VITALIK,
        label: "vitalik.eth",
        resolved_name: "vitalik.eth",
        resolved_at: VITALIK_HIT.resolvedAt,
      }),
    );

    const res = await PATCH(
      patch("watch-1", { chain: "evm", address: "vitalik.eth" }),
      params("watch-1"),
    );
    const body = (await res.json()) as { entry: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(resolveNameMock).toHaveBeenCalledWith("evm", "vitalik.eth");
    expect(updateMock).toHaveBeenCalledWith({
      userId: USER_A,
      id: "watch-1",
      label: "vitalik.eth",
      chain: "evm",
      address: VITALIK,
      resolved: { name: "vitalik.eth", at: VITALIK_HIT.resolvedAt },
    });
    expect(body.entry).toMatchObject({
      address: VITALIK,
      resolvedName: "vitalik.eth",
    });
  });

  it("clears the stored name when the edit lands on a raw address", async () => {
    getMock.mockResolvedValue(
      row({
        address: VITALIK,
        label: "vitalik.eth",
        resolved_name: "vitalik.eth",
        resolved_at: VITALIK_HIT.resolvedAt,
      }),
    );
    updateMock.mockResolvedValue(row());

    const res = await PATCH(
      patch("watch-1", { chain: "evm", address: CHECKSUMMED }),
      params("watch-1"),
    );

    expect(res.status).toBe(200);
    expect(resolveNameMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CHECKSUMMED,
        resolved: { name: null, at: null },
      }),
    );
  });

  it("leaves the stored name alone on a rename-only edit", async () => {
    getMock.mockResolvedValue(
      row({
        address: VITALIK,
        label: "vitalik.eth",
        resolved_name: "vitalik.eth",
        resolved_at: VITALIK_HIT.resolvedAt,
      }),
    );
    updateMock.mockResolvedValue(row({ label: "Desk" }));

    const res = await PATCH(
      patch("watch-1", { label: "Desk" }),
      params("watch-1"),
    );

    expect(res.status).toBe(200);
    expect(resolveNameMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({
      userId: USER_A,
      id: "watch-1",
      label: "Desk",
      chain: "evm",
      address: VITALIK,
    });
  });

  it("rejects an unregistered name on edit with a complete sentence", async () => {
    getMock.mockResolvedValue(row());
    resolveNameMock.mockResolvedValue(null);

    const res = await PATCH(
      patch("watch-1", { chain: "evm", address: "nobody12345.eth" }),
      params("watch-1"),
    );
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      "That name is not registered. Check the spelling and try again.",
    );
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/watchlist/[id] with a Solana name", () => {
  it("re-resolves on edit when the input is a name", async () => {
    getMock.mockResolvedValue(row({ chain: "solana" }));
    resolveNameMock.mockResolvedValue(BONFIDA_HIT);
    updateMock.mockResolvedValue(
      row({
        chain: "solana",
        address: BONFIDA,
        label: "bonfida.sns",
        resolved_name: "bonfida.sns",
        resolved_at: BONFIDA_HIT.resolvedAt,
      }),
    );

    const res = await PATCH(
      patch("watch-1", { chain: "solana", address: "bonfida.sns" }),
      params("watch-1"),
    );
    const body = (await res.json()) as { entry: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(resolveNameMock).toHaveBeenCalledWith("solana", "bonfida.sns");
    expect(updateMock).toHaveBeenCalledWith({
      userId: USER_A,
      id: "watch-1",
      label: "bonfida.sns",
      chain: "solana",
      address: BONFIDA,
      resolved: { name: "bonfida.sns", at: BONFIDA_HIT.resolvedAt },
    });
    expect(body.entry).toMatchObject({
      address: BONFIDA,
      resolvedName: "bonfida.sns",
    });
  });

  it("rejects an unregistered name on edit with a complete sentence", async () => {
    getMock.mockResolvedValue(row({ chain: "solana" }));
    resolveNameMock.mockResolvedValue(null);

    const res = await PATCH(
      patch("watch-1", { chain: "solana", address: "unregistered-xyz.sns" }),
      params("watch-1"),
    );
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      "That name is not registered. Check the spelling and try again.",
    );
    expect(updateMock).not.toHaveBeenCalled();
  });
});
