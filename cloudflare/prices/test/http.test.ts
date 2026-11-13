import { describe, expect, it } from "vitest";
import {
  parseRetryAfter,
  requestJson,
  type FetchLike,
} from "../src/lib/http";

const NOW = 1_762_000_000_000;

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("requestJson", () => {
  it("stops on its own deadline without retrying it", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      throw new DOMException("The operation was aborted", "TimeoutError");
    };

    const result = await requestJson({ url: "https://example.test/p", fetchImpl });

    expect(result).toEqual({ ok: false, error: "timeout", status: null });
    expect(calls).toBe(1);
  });

  it("retries a network failure once and returns the second answer", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return json({ ok: true });
    };

    const result = await requestJson({ url: "https://example.test/p", fetchImpl });

    expect(result).toEqual({ ok: true, status: 200, body: { ok: true } });
    expect(calls).toBe(2);
  });

  it("retries a 500 once and succeeds", async () => {
    const answers = [json({ error: "boom" }, 500), json({ price: 3.6 })];
    const fetchImpl: FetchLike = async () => answers.shift() as Response;

    const result = await requestJson({ url: "https://example.test/p", fetchImpl });

    expect(result).toEqual({ ok: true, status: 200, body: { price: 3.6 } });
  });

  it("gives up after the one retry on a repeated 5xx", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return json({ error: "boom" }, 500);
    };

    const result = await requestJson({ url: "https://example.test/p", fetchImpl });

    expect(result).toEqual({ ok: false, error: "http-500", status: 500 });
    expect(calls).toBe(2);
  });

  it("does not retry a 4xx", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return json({ error: "bad symbol" }, 400);
    };

    const result = await requestJson({ url: "https://example.test/p", fetchImpl });

    expect(result).toEqual({ ok: false, error: "http-400", status: 400 });
    expect(calls).toBe(1);
  });

  it("returns a 429 with Retry-After in milliseconds and does not rotate", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return json({}, 429, { "retry-after": "30" });
    };

    const result = await requestJson({
      url: "https://example.test/p",
      fetchImpl,
      now: () => NOW,
    });

    expect(result).toEqual({
      ok: false,
      error: "rate-limited",
      status: 429,
      retryAfterMs: 30_000,
    });
    expect(calls).toBe(1);
  });

  it("treats Binance's 418 ban the same way and reads its Retry-After", async () => {
    const fetchImpl: FetchLike = async () =>
      json({}, 418, { "retry-after": "120" });

    const result = await requestJson({
      url: "https://example.test/p",
      fetchImpl,
      now: () => NOW,
    });

    expect(result).toEqual({
      ok: false,
      error: "rate-limited",
      status: 418,
      retryAfterMs: 120_000,
    });
  });

  it("retries a 429 once only when the caller allows it and the wait is zero", async () => {
    const answers = [json({}, 429, { "retry-after": "0" }), json({ ok: 1 })];
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return answers.shift() as Response;
    };

    const result = await requestJson({
      url: "https://example.test/p",
      fetchImpl,
      retryOn429: true,
    });

    expect(result).toEqual({ ok: true, status: 200, body: { ok: 1 } });
    expect(calls).toBe(2);
  });

  it("does not retry a 429 early when Retry-After asks for a wait", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return json({}, 429, { "retry-after": "5" });
    };

    const result = await requestJson({
      url: "https://example.test/p",
      fetchImpl,
      retryOn429: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "rate-limited",
      status: 429,
      retryAfterMs: 5_000,
    });
    expect(calls).toBe(1);
  });

  it("keeps a non-JSON body out of the result", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("<html>blocked</html>", { status: 200 });

    const result = await requestJson({ url: "https://example.test/p", fetchImpl });

    expect(result).toEqual({ ok: true, status: 200, body: undefined });
  });

  it("maps an aborted body read to a timeout without throwing", async () => {
    const response = {
      ok: true,
      status: 200,
      text: async () => {
        throw new DOMException("body aborted", "TimeoutError");
      },
    } as unknown as Response;
    const fetchImpl: FetchLike = async () => response;

    const result = await requestJson({ url: "https://example.test/p", fetchImpl });

    expect(result).toEqual({ ok: false, error: "timeout", status: null });
  });

  it("maps a broken body read to network and does not retry the request", async () => {
    let calls = 0;
    const response = {
      ok: true,
      status: 200,
      text: async () => {
        throw new Error("stream closed");
      },
    } as unknown as Response;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return response;
    };

    const result = await requestJson({ url: "https://example.test/p", fetchImpl });

    expect(result).toEqual({ ok: false, error: "network", status: null });
    expect(calls).toBe(1);
  });

  it("never embeds a URL or a response body in an error string", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError(
        "fetch failed for https://api.g.alchemy.com/prices/v1/seeded-key/tokens",
      );
    };

    const result = await requestJson({
      url: "https://api.g.alchemy.com/prices/v1/seeded-key/tokens",
      fetchImpl,
    });

    expect(result).toEqual({ ok: false, error: "network", status: null });
    expect(JSON.stringify(result)).not.toContain("seeded-key");
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds", () => {
    expect(parseRetryAfter("120", NOW)).toBe(120_000);
    expect(parseRetryAfter("0", NOW)).toBe(0);
    expect(parseRetryAfter("1.5", NOW)).toBe(1_500);
  });

  it("reads an HTTP date relative to now", () => {
    const date = new Date(NOW + 45_000).toUTCString();

    expect(parseRetryAfter(date, NOW)).toBe(45_000);
  });

  it("returns undefined for a missing, empty, or nonsense value", () => {
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
    expect(parseRetryAfter("  ", NOW)).toBeUndefined();
    expect(parseRetryAfter("soon", NOW)).toBeUndefined();
    expect(parseRetryAfter("-5", NOW)).toBeUndefined();
  });

  it("clamps a date already in the past to zero", () => {
    const date = new Date(NOW - 45_000).toUTCString();

    expect(parseRetryAfter(date, NOW)).toBe(0);
  });
});
