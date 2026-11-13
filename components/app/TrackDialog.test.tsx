import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import {
  previewWatchName,
  TrackAddressFields,
  type TrackForm,
} from "./TrackDialog";

/**
 * The track dialog's name preview.
 *
 * The preview reads through the resolve route and never throws: every
 * outcome maps to a status the dialog can show inline. The fields render
 * on their own (the dialog shell only mounts in the browser), so static
 * copy and resolve states assert against them directly: complete
 * sentences, short labels, and the muted standing line for a name read.
 */

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const BONFIDA = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubForm(overrides: Partial<TrackForm> = {}): TrackForm {
  return {
    tab: "EVM",
    setTab: () => {},
    address: "",
    setAddress: () => {},
    label: "",
    setLabel: () => {},
    chain: "evm",
    normalized: null,
    error: null,
    isName: false,
    resolving: false,
    resolvedAddress: null,
    resolvedName: null,
    ready: false,
    reset: () => {},
    ...overrides,
  };
}

function render(form: TrackForm): string {
  return ReactDOMServer.renderToString(
    <TrackAddressFields form={form} onSubmit={() => {}} />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TrackAddressFields copy", () => {
  it("names the domain hint with a short label", () => {
    const html = render(stubForm());

    expect(html).toContain("EVM address or domain name");
    expect(html).toContain("Label");
    expect(html).toContain("Address");
  });

  it("names the domain hint on the Solana tab with a short label", () => {
    const html = render(stubForm({ tab: "Solana", chain: "solana" }));

    expect(html).toContain("Solana address or domain name");
  });

  it("shows no resolve state for raw input", () => {
    const html = render(
      stubForm({ address: VITALIK, normalized: VITALIK, ready: true }),
    );

    expect(html).not.toContain("Resolving the name.");
    expect(html).not.toContain("Resolves to");
  });

  it("reads the resolving state in a complete sentence", () => {
    const html = render(
      stubForm({ address: "vitalik.eth", isName: true, resolving: true }),
    );

    expect(html).toContain("Resolving the name.");
    expect(html).not.toContain("Resolves to");
  });

  it("reads the resolved address once it lands", () => {
    const html = render(
      stubForm({
        address: "vitalik.eth",
        isName: true,
        resolvedAddress: VITALIK,
        resolvedName: "vitalik.eth",
        ready: true,
      }),
    );

    expect(html).toContain("Resolves to 0xd8dA…6045.");
  });

  it("reads a resolved Solana address once it lands", () => {
    const html = render(
      stubForm({
        tab: "Solana",
        chain: "solana",
        address: "bonfida.sns",
        isName: true,
        resolvedAddress: BONFIDA,
        resolvedName: "bonfida.sns",
        ready: true,
      }),
    );

    expect(html).toContain("Resolves to Fw1E…Lb1v.");
  });

  it("reads a failed name in the existing error voice", () => {
    const html = render(
      stubForm({
        address: "nobody12345.eth",
        isName: true,
        error: "That name is not registered. Check the spelling and try again.",
      }),
    );

    expect(html).toContain(
      "That name is not registered. Check the spelling and try again.",
    );
  });
});

describe("previewWatchName", () => {
  it("reads the resolve route with the trimmed input", async () => {
    const stub = vi.fn(async () =>
      json({
        address: VITALIK,
        name: "vitalik.eth",
        resolvedAt: "2026-11-08T12:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", stub);

    const read = await previewWatchName("  vitalik.eth ");

    expect(read).toEqual({
      ok: true,
      address: VITALIK,
      name: "vitalik.eth",
      resolvedAt: "2026-11-08T12:00:00.000Z",
    });
    expect(stub).toHaveBeenCalledWith(
      "/api/names/resolve?chain=evm&name=vitalik.eth",
      { cache: "no-store" },
    );
  });

  it("reads the resolve route on the Solana chain when asked", async () => {
    const stub = vi.fn(async () =>
      json({
        address: BONFIDA,
        name: "bonfida.sns",
        resolvedAt: "2026-11-08T12:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", stub);

    const read = await previewWatchName("  bonfida.sns ", "solana");

    expect(read).toEqual({
      ok: true,
      address: BONFIDA,
      name: "bonfida.sns",
      resolvedAt: "2026-11-08T12:00:00.000Z",
    });
    expect(stub).toHaveBeenCalledWith(
      "/api/names/resolve?chain=solana&name=bonfida.sns",
      { cache: "no-store" },
    );
  });

  it("maps an unregistered name to its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "That name is not registered." }, 404)),
    );

    await expect(previewWatchName("nobody12345.eth")).resolves.toEqual({
      ok: false,
      reason: "unregistered",
    });
  });

  it("maps a refused name to invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "That name is not valid." }, 400)),
    );

    await expect(previewWatchName("not_valid!.eth")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("maps a failed lookup, a broken body, and a dropped request to unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "Name lookup is unavailable." }, 503)),
    );
    await expect(previewWatchName("vitalik.eth")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });

    vi.stubGlobal("fetch", vi.fn(async () => json({ address: VITALIK })));
    await expect(previewWatchName("vitalik.eth")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(previewWatchName("vitalik.eth")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
