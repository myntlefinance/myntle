import { describe, expect, it } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import {
  useWatchedDetailView,
  type WatchedDetailView,
} from "./useWatchedDetailView";
import type { PortfolioSnapshot } from "./portfolioCache";
import type { WatchlistEntry } from "./useWatchlist";

const ENTRY: WatchlistEntry = {
  id: "watch-1",
  chain: "evm",
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  label: "Vault",
  isDefault: true,
  createdAt: "2026-11-06T12:00:00.000Z",
};

const SNAPSHOT: PortfolioSnapshot = {
  groups: [
    {
      id: "base",
      name: "Base",
      icon: "base",
      items: [
        {
          id: "usdc",
          symbol: "USDC",
          name: "USD Coin",
          amount: "10.00",
          valueUsd: 10,
          category: "stables",
        },
        {
          id: "eth",
          symbol: "ETH",
          name: "Ether",
          amount: "1.00",
          valueUsd: 3000,
          category: "native",
        },
      ],
    },
  ],
  totalUsd: 3010,
};

function Probe({
  entry,
  snapshot,
  isPending = false,
  error = null,
}: {
  entry: WatchlistEntry | null;
  snapshot: PortfolioSnapshot | null;
  isPending?: boolean;
  error?: unknown;
}) {
  const view: WatchedDetailView | null = useWatchedDetailView({
    entry,
    snapshot,
    isPending,
    error,
    refresh: () => {},
  });
  if (!view) return <p>no-view</p>;
  return (
    <div>
      <p>{`subject:${view.subject}`}</p>
      <p>{`address:${view.address}`}</p>
      <p>{`total:${view.total}`}</p>
      <p>{`body:${view.bodyKey}`}</p>
      <p>{`pending:${view.pending}`}</p>
      <p>{`failed:${view.failed}`}</p>
      <p>{`data:${view.data ? "yes" : "no"}`}</p>
      <p>{`groups:${view.groups.flatMap((g) => g.items.map((i) => i.symbol)).join(",")}`}</p>
      <p>{`sample:${view.sample.groups.length > 0 ? "yes" : "no"}`}</p>
    </div>
  );
}

function render(props: React.ComponentProps<typeof Probe>) {
  return ReactDOMServer.renderToStaticMarkup(<Probe {...props} />);
}

describe("useWatchedDetailView", () => {
  it("shapes a selected account for the shared chrome", () => {
    const html = render({ entry: ENTRY, snapshot: SNAPSHOT });

    expect(html).toContain("subject:Vault");
    expect(html).toContain(`address:${ENTRY.address}`);
    expect(html).toContain("total:3010");
    expect(html).toContain("body:watch-1");
    expect(html).toContain("pending:false");
    expect(html).toContain("failed:false");
    expect(html).toContain("data:yes");
    expect(html).toContain("groups:USDC,ETH");
  });

  it("reads the tracked name when no label was given", () => {
    const html = render({
      entry: { ...ENTRY, label: null, resolvedName: "vitalik.eth" },
      snapshot: SNAPSHOT,
    });
    expect(html).toContain("subject:vitalik.eth");
  });

  it("prefers a custom label over the tracked name", () => {
    const html = render({
      entry: { ...ENTRY, label: "Founder", resolvedName: "vitalik.eth" },
      snapshot: SNAPSHOT,
    });
    expect(html).toContain("subject:Founder");
  });

  it("keeps the sample shape while the first read is on its way", () => {
    const html = render({
      entry: ENTRY,
      snapshot: null,
      isPending: true,
    });
    expect(html).toContain("pending:true");
    expect(html).toContain("data:no");
    expect(html).toContain("sample:yes");
  });

  it("keeps the error in the table while the address stays", () => {
    const html = render({
      entry: ENTRY,
      snapshot: null,
      error: new Error("Balances are unavailable."),
    });
    expect(html).toContain("failed:true");
    expect(html).toContain("data:yes");
    expect(html).toContain(`address:${ENTRY.address}`);
  });

  it("renders no view without a selection", () => {
    expect(render({ entry: null, snapshot: null })).toContain("no-view");
  });
});
