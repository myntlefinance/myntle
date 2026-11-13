import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EarnVault } from "./catalogue";

function vault(overrides: Partial<EarnVault> & { id: string }): EarnVault {
  const { id, ...rest } = overrides;
  return {
    id,
    name: "Test vault",
    protocol: "Test",
    chain: "base",
    receiptAssetId: `nep141:receipt-${id}`,
    receiptSymbol: "R",
    receiptDecimals: 18,
    paymentAssetId: "nep141:payment",
    paymentSymbol: "USDC",
    paymentDecimals: 6,
    ...rest,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** The module keeps its cache for the process, so every test starts fresh. */
beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("readEarnApy", () => {
  it("picks the matching pool out of the document and keeps the percent", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { pool: "pool-other", apy: 9.1 },
          { pool: "pool-1", apy: 4.50508 },
          { pool: "pool-null", apy: null },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { readEarnApy } = await import("./apy");
    const apy = await readEarnApy(vault({ id: "v1", apyPoolId: "pool-1" }));

    expect(apy).toBe(4.50508);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://yields.llama.fi/pools");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts a bare array body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([{ pool: "pool-1", apy: 3.25 }]),
      ),
    );

    const { readEarnApy } = await import("./apy");

    await expect(
      readEarnApy(vault({ id: "v1", apyPoolId: "pool-1" })),
    ).resolves.toBe(3.25);
  });

  it("returns null when the request fails and logs no body or message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret upstream detail")),
    );

    const { readEarnApy } = await import("./apy");
    const apy = await readEarnApy(vault({ id: "v1", apyPoolId: "pool-1" }));

    expect(apy).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("request failed");
    expect(line).not.toContain("secret upstream detail");
  });

  it("returns null on a non-2xx response and names only the status", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [{ pool: "pool-1", apy: 4 }] }, 503)),
    );

    const { readEarnApy } = await import("./apy");
    const apy = await readEarnApy(vault({ id: "v1", apyPoolId: "pool-1" }));

    expect(apy).toBeNull();
    expect(String(warn.mock.calls[0][0])).toContain("HTTP 503");
  });

  it("ignores an APY that is missing, null, a string, or not finite", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [
            { pool: "pool-null", apy: null },
            { pool: "pool-string", apy: "4.2" },
            { pool: "pool-nan", apy: Number.NaN },
            { pool: "pool-infinite", apy: Number.POSITIVE_INFINITY },
            { apy: 4.2 },
          ],
        }),
      ),
    );

    const { readEarnApy } = await import("./apy");

    for (const apyPoolId of [
      "pool-null",
      "pool-string",
      "pool-nan",
      "pool-infinite",
      "pool-missing",
    ]) {
      await expect(
        readEarnApy(vault({ id: apyPoolId, apyPoolId })),
      ).resolves.toBeNull();
    }
  });
});

describe("readEarnApys caching", () => {
  it("reads the document once for repeated calls", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ pool: "pool-1", apy: 4.5 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { readEarnApy } = await import("./apy");
    const target = vault({ id: "v1", apyPoolId: "pool-1" });

    await expect(readEarnApy(target)).resolves.toBe(4.5);
    await expect(readEarnApy(target)).resolves.toBe(4.5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one request between concurrent callers", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { pool: "pool-1", apy: 4.5 },
          { pool: "pool-2", apy: 7.25 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { readEarnApy } = await import("./apy");
    const [first, second] = await Promise.all([
      readEarnApy(vault({ id: "v1", apyPoolId: "pool-1" })),
      readEarnApy(vault({ id: "v2", apyPoolId: "pool-2" })),
    ]);

    expect([first, second]).toEqual([4.5, 7.25]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads again once the ten-minute window has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T00:00:00.000Z"));

    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ pool: "pool-1", apy: 4.5 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { readEarnApy } = await import("./apy");
    const target = vault({ id: "v1", apyPoolId: "pool-1" });

    await readEarnApy(target);
    vi.setSystemTime(new Date("2026-11-13T00:10:01.000Z"));
    await readEarnApy(target);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ pool: "pool-1", apy: 4.2 }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { readEarnApy } = await import("./apy");
    const target = vault({ id: "v1", apyPoolId: "pool-1" });

    await expect(readEarnApy(target)).resolves.toBeNull();
    await expect(readEarnApy(target)).resolves.toBe(4.2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("readEarnApys", () => {
  it("answers every vault from one read and keeps unknown pools null", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { pool: "pool-1", apy: 4.5 },
          { pool: "pool-2", apy: 7.25 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { readEarnApys } = await import("./apy");
    const apys = await readEarnApys([
      vault({ id: "v1", apyPoolId: "pool-1" }),
      vault({ id: "v2", apyPoolId: "pool-2" }),
      vault({ id: "v3", apyPoolId: "pool-missing" }),
      vault({ id: "v4" }),
    ]);

    expect(Object.fromEntries(apys)).toEqual({
      v1: 4.5,
      v2: 7.25,
      v3: null,
      v4: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips the network entirely when no vault has a pool id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { readEarnApys } = await import("./apy");
    const apys = await readEarnApys([vault({ id: "tlo" })]);

    expect(apys.get("tlo")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
