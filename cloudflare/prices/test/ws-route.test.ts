import { describe, expect, it } from "vitest";
import { wsRouteError } from "../src/ws-route";

const GET_UPGRADE = {
  method: "GET",
  upgrade: "websocket",
  origin: null,
  allowedOrigin: null,
};

describe("wsRouteError", () => {
  it("rejects a non-GET even when it carries an upgrade", () => {
    expect(
      wsRouteError({
        ...GET_UPGRADE,
        method: "POST",
        origin: "http://localhost:3000",
        allowedOrigin: "http://localhost:3000",
      }),
    ).toEqual({
      status: 405,
      error: "method-not-allowed",
      allow: "GET",
    });
  });

  it("rejects a GET without an upgrade", () => {
    expect(wsRouteError({ ...GET_UPGRADE, upgrade: null })).toEqual({
      status: 426,
      error: "upgrade-required",
      upgrade: "websocket",
    });
  });

  it("accepts an upgrade header in any case", () => {
    expect(wsRouteError({ ...GET_UPGRADE, upgrade: "WebSocket" })).toBeNull();
  });

  it("rejects a present origin outside the allowlist", () => {
    expect(
      wsRouteError({
        ...GET_UPGRADE,
        origin: "https://evil.example",
        allowedOrigin: null,
      }),
    ).toEqual({ status: 403, error: "forbidden" });
  });

  it("allows a missing origin and a matching one", () => {
    expect(wsRouteError(GET_UPGRADE)).toBeNull();
    expect(
      wsRouteError({
        ...GET_UPGRADE,
        origin: "http://localhost:3000",
        allowedOrigin: "http://localhost:3000",
      }),
    ).toBeNull();
  });
});
