import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NETWORK_FILES, TOKEN_FILES } from "./iconFiles";

function svgNames(dir: "networks" | "tokens"): string[] {
  const path = fileURLToPath(
    new URL(`../../public/${dir}`, import.meta.url),
  );
  return readdirSync(path)
    .filter((name) => name.endsWith(".svg"))
    .map((name) => name.slice(0, -4))
    .sort();
}

describe("local icon manifest", () => {
  it("lists every network SVG in public/networks", () => {
    expect([...NETWORK_FILES].sort()).toEqual(svgNames("networks"));
  });

  it("lists every token SVG in public/tokens", () => {
    expect([...TOKEN_FILES].sort()).toEqual(svgNames("tokens"));
  });
});
