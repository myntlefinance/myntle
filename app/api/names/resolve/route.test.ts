import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requireSession: vi.fn(),
  resolveName: vi.fn(),
  registryThrows: false,
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: state.requireSession,
}));

vi.mock("@/lib/adapters/registry", () => ({
  getNameResolverPort: () => {
    if (state.registryThrows) {
      throw new Error("Required key is missing.");
    }
    return { resolveName: state.resolveName };
  },
}));

import { GET } from "./route";
import { nameError } from "@/lib/ports/names";

/**
 * The name resolve route.
 *
 * Reads run server-side through the name port on every call — the client
 * never resolves for itself. Unregistered names report 404 with a complete
 * sentence, refused names report 400, and every failure is masked to one
 * fixed sentence. There is no per-request provider override: a `?rpc=`
 * value travels nowhere and changes nothing.
 */

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const sessionA = {
  userId: "user-a",
  accountKind: "wallet" as const,
  walletId: "wallet-1",
  passkeyId: null,
  intentsAccountId: "alice.near",
  chain: "near" as const,
  address: "alice.near",
  createdAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
};

function get(query: string): Request {
  return new Request(`http://localhost/api/names/resolve${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.registryThrows = false;
  state.requireSession.mockResolvedValue(sessionA);
  state.resolveName.mockResolvedValue({
    address: VITALIK,
    name: "vitalik.eth",
    resolvedAt: "2026-11-08T12:00:00.000Z",
  });
});

describe("GET /api/names/resolve", () => {
  it("rejects an unauthenticated caller", async () => {
    state.requireSession.mockResolvedValue(null);

    const res = await GET(get("?chain=evm&name=vitalik.eth"));

    expect(res.status).toBe(401);
    expect(state.resolveName).not.toHaveBeenCalled();
  });

  it("returns the address, name, and read time for a registered name", async () => {
    const res = await GET(get("?chain=evm&name=vitalik.eth"));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(state.resolveName).toHaveBeenCalledWith("evm", "vitalik.eth");
    expect(body).toEqual({
      address: VITALIK,
      name: "vitalik.eth",
      resolvedAt: "2026-11-08T12:00:00.000Z",
    });
  });

  it("trims the input before the read", async () => {
    await GET(get("?chain=evm&name=%20%20vitalik.eth%20"));

    expect(state.resolveName).toHaveBeenCalledWith("evm", "vitalik.eth");
  });

  it("reports an unregistered name with a complete sentence", async () => {
    state.resolveName.mockResolvedValue(null);

    const res = await GET(get("?chain=evm&name=unregistered12345.eth"));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(404);
    expect(body.error).toBe(
      "That name is not registered. Check the spelling and try again.",
    );
  });

  it("reports a refused suffix with a complete sentence", async () => {
    state.resolveName.mockRejectedValue(
      nameError("invalid_input", "bad_suffix", "Only .eth names resolve here."),
    );

    const res = await GET(get("?chain=evm&name=vitalik.com"));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      "Only .eth names resolve here. Check the ending and try again.",
    );
  });

  it("returns the address, name, and read time for a registered Solana name", async () => {
    const BONFIDA = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
    state.resolveName.mockResolvedValue({
      address: BONFIDA,
      name: "bonfida.sns",
      resolvedAt: "2026-11-08T12:00:00.000Z",
    });

    const res = await GET(get("?chain=solana&name=bonfida.sns"));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(state.resolveName).toHaveBeenCalledWith("solana", "bonfida.sns");
    expect(body).toEqual({
      address: BONFIDA,
      name: "bonfida.sns",
      resolvedAt: "2026-11-08T12:00:00.000Z",
    });
  });

  it("reports a refused Solana suffix with a complete sentence", async () => {
    state.resolveName.mockRejectedValue(
      nameError("invalid_input", "bad_suffix", "Only .sns names resolve here."),
    );

    const res = await GET(get("?chain=solana&name=bonfida.com"));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      "Only .sns names resolve here. Check the ending and try again.",
    );
  });

  it("reports a refused name with a complete sentence", async () => {
    state.resolveName.mockRejectedValue(
      nameError("invalid_input", "bad_name", "That name is not valid."),
    );

    const res = await GET(get("?chain=evm&name=not_valid!.eth"));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("That name is not valid. Check it and try again.");
  });

  it("masks a failed lookup behind a retryable sentence", async () => {
    state.resolveName.mockRejectedValue(
      nameError("unavailable", "ens_rpc", "Name lookup is unavailable."),
    );

    const res = await GET(get("?chain=evm&name=vitalik.eth"));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(503);
    expect(body.error).toBe("Name lookup is unavailable. Try again shortly.");
  });

  it("names the suspended suffix on its own", async () => {
    state.resolveName.mockRejectedValue(
      nameError("unavailable", "sns_sol_transition", ".sol names cannot be read."),
    );

    const res = await GET(get("?chain=solana&name=vitalik.sol"));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(503);
    expect(body.error).toBe(".sol names cannot be read right now. Try again later.");
  });

  it("masks an unexpected failure without leaking detail", async () => {
    state.resolveName.mockRejectedValue(new Error("socket hung up"));

    const res = await GET(get("?chain=evm&name=vitalik.eth"));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(500);
    expect(body.error).toBe("An error occurred.");
  });

  it("masks a missing provider key without leaking detail", async () => {
    state.registryThrows = true;

    const res = await GET(get("?chain=evm&name=vitalik.eth"));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(503);
    expect(body.error).toBe("Name lookup is unavailable. Try again shortly.");
  });

  it("ignores a per-request provider override", async () => {
    const res = await GET(
      get("?chain=evm&name=vitalik.eth&rpc=https://example.invalid/"),
    );
    const body = (await res.json()) as Record<string, unknown>;

    // The read travels the registry-wired client only: the override value
    // changes nothing and the resolution still lands.
    expect(res.status).toBe(200);
    expect(state.resolveName).toHaveBeenCalledWith("evm", "vitalik.eth");
    expect(body.address).toBe(VITALIK);
  });

  it("rejects an unknown chain and an empty or over-length name", async () => {
    const chain = await GET(get("?chain=bitcoin&name=vitalik.eth"));
    expect(chain.status).toBe(400);

    const empty = await GET(get("?chain=evm&name=%20%20"));
    expect(empty.status).toBe(400);

    const long = await GET(
      get(`?chain=evm&name=${"a".repeat(125)}.eth`),
    );
    expect(long.status).toBe(400);
    expect(state.resolveName).not.toHaveBeenCalled();
  });
});
