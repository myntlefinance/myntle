import { describe, expect, it } from "vitest";
import { corsHeaders, parseAllowlist, pickAllowedOrigin } from "../src/cors";

const requestFrom = (origin?: string) =>
  new Request("https://prices.myntle.xyz/health", {
    headers: origin === undefined ? {} : { origin },
  });

describe("parseAllowlist", () => {
  it("falls back to localhost:3000 when APP_ORIGINS is unset", () => {
    expect(parseAllowlist(undefined)).toEqual(["http://localhost:3000"]);
    expect(parseAllowlist("")).toEqual([]);
  });

  it("trims whitespace around entries", () => {
    expect(
      parseAllowlist("  http://localhost:3000 ,  https://myntle.xyz  "),
    ).toEqual(["http://localhost:3000", "https://myntle.xyz"]);
  });

  it("drops empty entries without leaving holes", () => {
    expect(parseAllowlist("https://myntle.xyz,,   ,")).toEqual([
      "https://myntle.xyz",
    ]);
  });

  it("strips trailing slashes", () => {
    expect(
      parseAllowlist("https://myntle.xyz///,http://localhost:3000/"),
    ).toEqual(["https://myntle.xyz", "http://localhost:3000"]);
  });

  it("lowercases every entry", () => {
    expect(parseAllowlist("https://Myntle.XYZ")).toEqual(["https://myntle.xyz"]);
  });
});

describe("pickAllowedOrigin", () => {
  const allowlist = parseAllowlist("https://myntle.xyz,http://localhost:3000");

  it("returns the canonical entry for an allowed origin", () => {
    expect(pickAllowedOrigin(requestFrom("https://myntle.xyz"), allowlist)).toBe(
      "https://myntle.xyz",
    );
  });

  it("still matches when the request origin has different case", () => {
    expect(pickAllowedOrigin(requestFrom("https://MYNTLE.xyz"), allowlist)).toBe(
      "https://myntle.xyz",
    );
  });

  it("returns null for an origin outside the allowlist", () => {
    expect(
      pickAllowedOrigin(requestFrom("https://evil.example"), allowlist),
    ).toBeNull();
  });

  it("returns null when the request carries no Origin", () => {
    expect(pickAllowedOrigin(requestFrom(), allowlist)).toBeNull();
  });

  it("treats a wildcard entry as one literal origin, never a match-all", () => {
    const wildcard = parseAllowlist("*");

    expect(
      pickAllowedOrigin(requestFrom("https://evil.example"), wildcard),
    ).toBeNull();
    expect(
      pickAllowedOrigin(requestFrom("https://myntle.xyz"), wildcard),
    ).toBeNull();
  });
});

describe("wildcard preview origins", () => {
  const allowlist = parseAllowlist(
    "http://localhost:3000,https://myntle.xyz,https://myntle-*.vercel.app",
  );

  it("allows a Myntle Vercel preview subdomain and echoes its own origin", () => {
    expect(
      pickAllowedOrigin(
        requestFrom("https://myntle-git-branch.vercel.app"),
        allowlist,
      ),
    ).toBe("https://myntle-git-branch.vercel.app");
  });

  it("does not allow another Vercel project, the apex, a lookalike, or a path trick", () => {
    expect(
      pickAllowedOrigin(requestFrom("https://evil.vercel.app"), allowlist),
    ).toBeNull();
    expect(pickAllowedOrigin(requestFrom("https://vercel.app"), allowlist)).toBeNull();
    expect(
      pickAllowedOrigin(requestFrom("https://foo.vercel.app.evil.com"), allowlist),
    ).toBeNull();
    expect(
      pickAllowedOrigin(requestFrom("https://evil.com/foo.vercel.app"), allowlist),
    ).toBeNull();
  });

  it("still matches exact entries alongside a wildcard", () => {
    expect(pickAllowedOrigin(requestFrom("https://myntle.xyz"), allowlist)).toBe(
      "https://myntle.xyz",
    );
    expect(
      pickAllowedOrigin(requestFrom("http://localhost:3000"), allowlist),
    ).toBe("http://localhost:3000");
  });

  it("never lets a bare star through for an https origin", () => {
    expect(
      pickAllowedOrigin(
        requestFrom("https://anything.example"),
        parseAllowlist("*"),
      ),
    ).toBeNull();
  });

  it("rejects a bare star for null, scheme-less, and literal-star origins", () => {
    const star = parseAllowlist("*");

    expect(pickAllowedOrigin(requestFrom("null"), star)).toBeNull();
    expect(pickAllowedOrigin(requestFrom("myntle.xyz"), star)).toBeNull();
    expect(pickAllowedOrigin(requestFrom("*"), star)).toBeNull();
  });
});

describe("corsHeaders", () => {
  it("echoes the resolved origin and always varies on Origin", () => {
    const headers = corsHeaders("https://myntle.xyz");

    expect(headers["access-control-allow-origin"]).toBe("https://myntle.xyz");
    expect(headers.vary).toBe("Origin");
    expect(headers["access-control-allow-headers"]).toContain("x-probe-key");
  });

  it("sends no allow-origin header when the origin is not allowed", () => {
    const headers = corsHeaders(null);

    expect(headers["access-control-allow-origin"]).toBeUndefined();
    expect(headers.vary).toBe("Origin");
  });

  it("never answers with a wildcard", () => {
    expect(Object.values(corsHeaders("*"))).not.toContain("*");
  });

  it("advertises POST for the gated registry sync", () => {
    expect(corsHeaders(null)["access-control-allow-methods"]).toContain("POST");
  });
});
