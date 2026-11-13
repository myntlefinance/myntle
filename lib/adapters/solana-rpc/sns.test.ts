import { describe, expect, it } from "vitest";
import { NotFound, ProviderUnavailable } from "@/lib/ports";
import { resolveSnsAddress, resolveSnsViaProxy } from "./sns";

const BONFIDA = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
const ENDPOINT = "https://example.invalid/";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { fetchImpl, urls };
}

const base = {
  rpcEndpoint: ENDPOINT,
  timeoutMs: 5_000,
};

describe("sns proxy reads", () => {
  // URL-shape pins target the proxy reader directly: the failover entry
  // (`resolveSnsAddress`) attempts the on-chain read first, so its fetch
  // log carries the RPC call too (covered in `sns-corpus.test.ts`).
  it("returns the canonical address and keeps the endpoint override", async () => {
    const { fetchImpl, urls } = stubFetch(() =>
      jsonResponse({ s: "ok", result: BONFIDA }),
    );
    const hit = await resolveSnsViaProxy("bonfida.sns", { ...base, fetchImpl });
    expect(hit.address).toBe(BONFIDA);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/resolve/bonfida.sns");
    expect(url.searchParams.get("rpc")).toBe(ENDPOINT);
  });

  it("omits the override when no endpoint is passed", async () => {
    const { fetchImpl, urls } = stubFetch(() =>
      jsonResponse({ s: "ok", result: BONFIDA }),
    );
    const hit = await resolveSnsViaProxy("bonfida.sns", {
      fetchImpl,
      timeoutMs: 5_000,
    });
    expect(hit.address).toBe(BONFIDA);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0] as string);
    expect(url.pathname).toBe("/resolve/bonfida.sns");
    expect(url.searchParams.has("rpc")).toBe(false);
  });

  it("throws NotFound when the name is unregistered", async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse({ ok: false }, 404));
    const failure = await resolveSnsAddress("unregistered-xyz.sns", {
      ...base,
      fetchImpl,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotFound);
  });

  it("throws NotFound on the domain-not-found envelope", async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse({ s: "error", error: "Domain not found" }),
    );
    const failure = await resolveSnsAddress("unregistered-xyz.sns", {
      ...base,
      fetchImpl,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotFound);
  });

  it("throws ProviderUnavailable on the unsupported-TLD rejection", async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse({ s: "error", error: "Unsupported TLD" }, 400),
    );
    const failure = await resolveSnsAddress("bonfida.sns", {
      ...base,
      fetchImpl,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
    expect((failure as ProviderUnavailable).retryable).toBe(true);
  });

  it("throws ProviderUnavailable on HTTP 5xx", async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse({ ok: false }, 500));
    const failure = await resolveSnsAddress("bonfida.sns", {
      ...base,
      fetchImpl,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("throws ProviderUnavailable on a network failure", async () => {
    const fetchImpl = (async () => {
      throw new Error("fetch failed");
    }) as typeof fetch;
    const failure = await resolveSnsAddress("bonfida.sns", {
      ...base,
      fetchImpl,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
    expect((failure as ProviderUnavailable).message).not.toMatch(
      /bonfida|proxy host/i,
    );
  });

  it("throws ProviderUnavailable when the read hangs", async () => {
    const fetchImpl = (async () => new Promise<Response>(() => {})) as typeof fetch;
    const failure = await resolveSnsAddress("bonfida.sns", {
      rpcEndpoint: ENDPOINT,
      fetchImpl,
      timeoutMs: 20,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });

  it("throws ProviderUnavailable when the address leaves the encoding", async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse({ s: "ok", result: "!!!" }),
    );
    const failure = await resolveSnsAddress("bonfida.sns", {
      ...base,
      fetchImpl,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailable);
  });
});
