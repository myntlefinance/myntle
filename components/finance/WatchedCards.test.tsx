import { describe, expect, it } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { WatchedCards } from "./WatchedCards";

/**
 * The watchlist cards.
 *
 * One card per address with the label up top and the pill below it:
 * the network mark, the middle-truncated address, and the copy mark
 * hugging it. Edit and delete ride the title row's kebab; the
 * hollow slot at the end opens the same dialog as the header.
 */

const ENTRIES = [
  {
    id: "watch-1",
    chain: "evm" as const,
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    label: "Vault",
    isDefault: true,
  },
  {
    id: "watch-2",
    chain: "near" as const,
    address: "alice.near",
    label: null,
    isDefault: false,
  },
];

function render(props: Partial<React.ComponentProps<typeof WatchedCards>> = {}) {
  return ReactDOMServer.renderToString(
    <WatchedCards
      entries={ENTRIES}
      selectedId={null}
      onSelect={() => {}}
      onEdit={() => {}}
      onDeleteRequest={() => {}}
      onAdd={() => {}}
      onSetDefault={() => {}}
      {...props}
    />,
  );
}

describe("WatchedCards", () => {
  it("names each address once, with the pill middle-truncated", () => {
    const html = render();

    expect(html).toContain("Vault");
    expect(html).toContain("alice.near");
    // The EVM tail survives: first chars, ellipsis, last chars.
    expect(html).toContain(">0xaf88…5831<");
    // The uncut address only rides the tooltip, never the row.
    expect(html).toContain(
      'title="0xaf88d065e77c8cC2239327C5EDb3A432268e5831"',
    );
  });

  it("marks the selected card", () => {
    const html = render({ selectedId: "watch-1" });

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("carries a kebab, copy, and the add slot", () => {
    const html = render();

    // Edit and delete wait behind the kebab, never on hover.
    expect(html).toContain("Card actions for Vault");
    expect(html).not.toContain("Rename Vault");
    expect(html).not.toContain("Delete Vault");
    expect(html).toContain('aria-label="Copy address"');
    expect(html).toContain("Watch new");
  });

  it("leaves the delete gate to the tab", () => {
    const html = render();

    // The cards only ask; the confirm dialog renders in WatchedTab,
    // and the menu items render only once the kebab opens.
    expect(html).toContain("Card actions for Vault");
    expect(html).not.toContain("Delete Vault");
    expect(html).not.toContain("Delete address?");
  });

  it("marks the default card a fresh visit opens to", () => {
    const html = render();

    expect(html).toContain("Vault");
    expect(html).toContain("· Default");
    // Only the default row carries the mark.
    expect(html.match(/· Default/g)).toHaveLength(1);
  });
});
