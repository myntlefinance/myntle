import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderNotConfigured, ProviderUnavailable } from "@/lib/ports";
import { groupBalancesByNetwork } from "@/lib/wallet/balances";
import {
  alchemyBalancesPort,
  FAST_EVM_NETWORKS,
  fetchAlchemyBalances,
} from "./balances";

const EVM_ADDRESS = "0x1234567890123456789012345678901234567890";
const SOL_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

type RecordedBody = {
  addresses: Array<{ address: string; networks: string[] }>;
  pageKey?: string;
};

let originalFetch: typeof fetch;
let originalKey: string | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(handler: (body: RecordedBody) => Response): RecordedBody[] {
  const bodies: RecordedBody[] = [];
  globalThis.fetch = (async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const parsed = JSON.parse(String(init?.body)) as RecordedBody;
    bodies.push(parsed);
    return handler(parsed);
  }) as typeof fetch;
  return bodies;
}

const EMPTY_PAGE = { data: { tokens: [] } };

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalKey = process.env.ALCHEMY_API_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ALCHEMY_API_KEY;
  else process.env.ALCHEMY_API_KEY = originalKey;
});

describe("Alchemy network selection", () => {
  it("short-circuits EVM reads filtered to non-EVM networks", async () => {
    delete process.env.ALCHEMY_API_KEY;
    const bodies = stubFetch(() => jsonResponse(EMPTY_PAGE));

    const res = await fetchAlchemyBalances(EVM_ADDRESS, "evm", {
      networks: ["solana"],
    });

    expect(res.balances).toEqual([]);
    expect(res.totalValueUsd).toBe(0);
    expect(bodies).toHaveLength(0);
    // Port results carry no string-error channel; failures throw.
    expect("error" in res).toBe(false);
  });

  it("asks for solana-mainnet, which is the only slug the API accepts", async () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    const bodies = stubFetch(() => jsonResponse(EMPTY_PAGE));

    const res = await fetchAlchemyBalances(SOL_ADDRESS, "solana");

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.addresses[0]?.networks).toEqual(["solana-mainnet"]);
    expect("error" in res).toBe(false);
  });

  it("chunks a full EVM read into 5-network requests", async () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    const bodies = stubFetch(() => jsonResponse(EMPTY_PAGE));

    const res = await fetchAlchemyBalances(EVM_ADDRESS, "evm");

    // 16 networks at 5 per request.
    expect(bodies).toHaveLength(4);
    const requested = bodies.flatMap((b) => b.addresses[0]?.networks ?? []);
    expect(requested).toHaveLength(16);
    expect(requested).toContain("polygon-mainnet");
    for (const body of bodies) {
      expect(body.addresses[0]?.networks.length).toBeLessThanOrEqual(5);
    }
    expect(res.balances).toEqual([]);
    expect(res.totalValueUsd).toBe(0);
  });

  it("keeps the fast-network shortlist to the first five slugs", () => {
    expect(FAST_EVM_NETWORKS).toEqual([
      "eth-mainnet",
      "base-mainnet",
      "arb-mainnet",
      "opt-mainnet",
      "polygon-mainnet",
    ]);
  });
});

describe("Alchemy response mapping", () => {
  it("maps a matic-mainnet answer onto the Polygon group", async () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    // The provider takes polygon-mainnet on the request and answers
    // matic-mainnet; both spellings resolve to the same group.
    const bodies = stubFetch((body) => {
      const networks = body.addresses[0]?.networks ?? [];
      if (!networks.includes("polygon-mainnet")) {
        return jsonResponse(EMPTY_PAGE);
      }
      return jsonResponse({
        data: {
          tokens: [
            {
              network: "matic-mainnet",
              address: EVM_ADDRESS,
              tokenAddress: null,
              tokenBalance: "2000000000000000000",
              tokenMetadata: {
                name: "Polygon",
                symbol: "POL",
                decimals: 18,
                logo: null,
              },
              tokenPrices: [{ currency: "USD", value: "0.5" }],
            },
          ],
        },
      });
    });

    const res = await fetchAlchemyBalances(EVM_ADDRESS, "evm");

    expect(
      bodies.flatMap((b) => b.addresses[0]?.networks ?? []),
    ).toContain("polygon-mainnet");
    expect(res.balances).toHaveLength(1);
    expect(res.balances[0]).toMatchObject({
      symbol: "POL",
      balance: "2",
      valueUsd: 1,
      network: "matic",
    });
    const groups = groupBalancesByNetwork(res.balances);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("Polygon");
  });
});

describe("Alchemy error taxonomy", () => {
  it("throws ProviderNotConfigured when the key is missing", async () => {
    delete process.env.ALCHEMY_API_KEY;
    stubFetch(() => jsonResponse(EMPTY_PAGE));

    const failure = await fetchAlchemyBalances(EVM_ADDRESS, "evm").catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ProviderNotConfigured);
    const err = failure as ProviderNotConfigured;
    expect(err.provider).toBe("alchemy");
    expect(err.retryable).toBe(false);
    // The message stays generic: no provider names reach callers.
    expect(err.message).not.toMatch(/alchemy/i);
  });

  it("throws ProviderUnavailable when every network fails", async () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    stubFetch((body) => {
      const networks = body.addresses[0]?.networks ?? [];
      return jsonResponse({
        data: { tokens: [] },
        error: {
          partialErrors: networks.map((network) => ({ network })),
        },
      });
    });

    const failure = await fetchAlchemyBalances(EVM_ADDRESS, "evm").catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ProviderUnavailable);
    const err = failure as ProviderUnavailable;
    expect(err.retryable).toBe(true);
    expect(err.message).not.toMatch(/alchemy/i);
  });

  it("throws ProviderUnavailable on HTTP failure", async () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    stubFetch(() => jsonResponse({ ok: false }, 500));

    await expect(fetchAlchemyBalances(EVM_ADDRESS, "evm")).rejects.toThrowError(
      ProviderUnavailable,
    );
  });
});

describe("alchemyBalancesPort", () => {
  it("serves Solana through the port signature", async () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    const bodies = stubFetch(() => jsonResponse(EMPTY_PAGE));

    const res = await alchemyBalancesPort.getBalances("solana", SOL_ADDRESS);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.addresses[0]?.networks).toEqual(["solana-mainnet"]);
    expect(res.balances).toEqual([]);
    expect("error" in res).toBe(false);
  });

  it("normalizes the sol alias to the Solana slug", async () => {
    process.env.ALCHEMY_API_KEY = "test-key";
    const bodies = stubFetch(() => jsonResponse(EMPTY_PAGE));

    await alchemyBalancesPort.getBalances("sol", SOL_ADDRESS);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.addresses[0]?.networks).toEqual(["solana-mainnet"]);
  });
});
