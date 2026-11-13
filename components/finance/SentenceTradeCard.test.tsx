import { beforeEach, describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SentenceTradeCard, {
  AddressPopup,
  RefundToValue,
  TokenPopup,
  VenuePopup,
  YouPill,
  adoptRevisedQuote,
  directApprovalFailure,
  inkCorrection,
  locateLineIndex,
  resolveAbove,
} from "./SentenceTradeCard";
import { TokenAvatar } from "./TokenAvatar";

let mockAccount: {
  kind: "evm" | "solana" | "near";
  address: string;
  walletName?: string;
  walletIcon?: string;
} = { kind: "evm", address: "0x3259aBcDeF12345678901073" };

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({
    account: mockAccount,
    signMessage: vi.fn(),
    signNEP413: vi.fn(),
  }),
}));

const RECIPIENT = "0x3259aBcDeF12345678901073";

const swapProps = {
  action: "swap",
  fromSymbol: "USDT",
  fromChain: "near",
  toSymbol: "ETH",
  toChain: "near",
  amountIn: "55",
  amountOut: "0.05",
  minAmountOut: "0.0495",
  minAmountOutRaw: "49000000000000000",
  recipient: RECIPIENT,
  expiresAt: "2026-11-02T14:04:31.000Z",
  slippageBps: 100,
} as const;

describe("SentenceTradeCard", () => {
  it("renders the proposal as one sentence built from the signed parameters", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...swapProps} />,
    );
    // Verb, amounts, tickers, and venue in reading order.
    expect(html).toContain("Swap");
    expect(html).toContain("55");
    expect(html).toContain("USDT");
    expect(html).toContain("0.05");
    expect(html).toContain("ETH");
    expect(html).toContain("Near Account");
    // No ticket legs survive.
    expect(html).not.toContain("You send");
    expect(html).not.toContain("You receive");
  });

  it("binds the sentence to the signed figures, not model text", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...swapProps} />,
    );
    // Minimum received and recipient come from the quote and the approval.
    expect(html).toContain("0.0495");
    expect(html).toContain("0x3259…1073");
  });

  it("names the connected wallet as the sender", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...swapProps} action="deposit" />,
    );
    expect(html).toContain("Send");
    expect(html).toContain("0x3259…1073");
  });

  it("renders the withdraw grammar with the recipient as destination", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...swapProps} action="withdraw" />,
    );
    expect(html).toContain("Withdraw");
    expect(html).toContain("0x3259…1073");
  });

  it("offers Reject and Approve while awaiting", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...swapProps} state="awaiting" />,
    );
    expect(html).toContain("Reject");
    expect(html).toContain("Approve");
    expect(html).not.toContain("Rejected");
  });

  it("shows the status badge in place of the buttons once decided", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...swapProps} state="denied" />,
    );
    expect(html).toContain("Rejected");
    expect(html).not.toContain(">Approve<");
  });

  it("keeps detail cards closed until a chip is opened", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...swapProps} state="awaiting" />,
    );
    expect(html).not.toContain('role="dialog"');
    // Chips stay keyboard-focusable so hover is never the only path in.
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows a resolving state for a named refund while its preview lands", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard
        {...swapProps}
        refundTo="example.sns"
        swapInput={{
          fromAssetId: "nep141:usdc",
          toAssetId: "nep141:wrap.near",
          amount: "25000000",
          recipient: RECIPIENT,
          refundTo: "example.sns",
          slippageBps: 100,
        }}
      />,
    );
    // The effect never runs in static markup, so the preview is always
    // pending here: the row names the resolving state, never the raw name
    // as an address, and offers no copy of it.
    expect(html).toContain("Refund to");
    expect(html).toContain("Resolving example.sns.");
    expect(html).not.toContain(">example.sns<");
  });
});

describe("adopting a revised quote", () => {
  it("moves the figures, the preview, and the approval window together", () => {
    const next = adoptRevisedQuote(
      {
        amountOut: "0.05",
        minAmountOut: "0.0495",
        minAmountOutRaw: "49500000000000000",
        expiresAt: "2026-11-12T10:00:00.000Z",
        quoteId: "11111111-1111-4111-8111-111111111111",
        requestedAt: "2026-11-12T09:27:18.173Z",
      },
      {
        amountOut: "0.048",
        minAmountOut: "0.0475",
        minAmountOutRaw: "47500000000000000",
        expiresAt: "2026-11-15T09:57:52.936Z",
        quoteId: "22222222-2222-4222-8222-222222222222",
        requestedAt: "2026-11-12T09:28:04.000Z",
      },
    );

    expect(next).toMatchObject({
      amountOut: "0.048",
      minAmountOut: "0.0475",
      minAmountOutRaw: "47500000000000000",
      expiresAt: "2026-11-15T09:57:52.936Z",
      quoteId: "22222222-2222-4222-8222-222222222222",
      requestedAt: "2026-11-12T09:28:04.000Z",
    });
  });

  it("keeps the current preview and birth when the response omits them", () => {
    const next = adoptRevisedQuote(
      {
        amountOut: "0.05",
        quoteId: "11111111-1111-4111-8111-111111111111",
        requestedAt: "2026-11-12T09:27:18.173Z",
      },
      { amountOut: "0.048" },
    );

    expect(next.quoteId).toBe("11111111-1111-4111-8111-111111111111");
    expect(next.requestedAt).toBe("2026-11-12T09:27:18.173Z");
    expect(next.amountOut).toBe("0.048");
  });
});

describe("direct approval failure", () => {
  it("shows the message a 400 response carries", async () => {
    const res = new Response(
      JSON.stringify({
        error: "unavailable",
        message:
          "This trade can't be completed here. Please ask for a fresh quote.",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );

    expect(res.status).toBe(400);
    expect(directApprovalFailure(await res.json())).toBe(
      "This trade can't be completed here. Please ask for a fresh quote.",
    );
  });

  it("keeps the card's own fallback when the body has no real message", () => {
    expect(directApprovalFailure({ error: "An error occurred." })).toBe(
      "Unable to execute trade. Please try again.",
    );
    expect(directApprovalFailure(null)).toBe(
      "Unable to execute trade. Please try again.",
    );
    expect(directApprovalFailure({ message: "   " })).toBe(
      "Unable to execute trade. Please try again.",
    );
  });
});

describe("RefundToValue", () => {
  const TYPED = "example.sns";
  const RESOLVED = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
  const SHORT = "Fw1ETa…Lb1v";

  /** The value the copy control carries, read off the element tree. */
  function copyValueOf(element: React.JSX.Element): unknown {
    const children = React.Children.toArray(
      (element.props as { children?: React.ReactNode }).children,
    );
    const copies = children.filter(
      (child) =>
        React.isValidElement(child) &&
        (child.props as { value?: unknown }).value !== undefined,
    );
    expect(copies).toHaveLength(1);
    return (copies[0] as React.ReactElement<{ value?: unknown }>).props.value;
  }

  it("shows the typed name beside its resolved address", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <RefundToValue
        refundAddr={TYPED}
        typedName={TYPED}
        preview={{ address: RESOLVED, name: TYPED }}
      />,
    );

    expect(html).toContain(`${TYPED} · ${SHORT}`);
    expect(html).toContain(`title="${RESOLVED}"`);
    expect(html).toContain("Copy address");
    expect(html).not.toContain(`>${RESOLVED}<`);
  });

  it("hands the copy control the previewed resolved address", () => {
    const value = copyValueOf(
      RefundToValue({
        refundAddr: TYPED,
        typedName: TYPED,
        preview: { address: RESOLVED, name: TYPED },
      }),
    );

    expect(value).toBe(RESOLVED);
  });

  it("shows a resolving state, never the raw name, while the preview lands", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <RefundToValue refundAddr={TYPED} typedName={TYPED} preview={null} />,
    );

    expect(html).toContain(`Resolving ${TYPED}.`);
    expect(html).not.toContain(`>${TYPED}<`);
    expect(html).not.toContain("Copy address");
  });

  it("keeps the shortened address and its copy for a plain refund", () => {
    const raw = "0x3259aBcDeF12345678901073";
    const html = ReactDOMServer.renderToStaticMarkup(
      <RefundToValue refundAddr={raw} typedName={null} preview={null} />,
    );

    expect(html).toContain("0x3259…1073");
    expect(html).toContain("Copy address");
    const value = copyValueOf(
      RefundToValue({ refundAddr: raw, typedName: null, preview: null }),
    );
    expect(value).toBe(raw);
  });
});

function renderPopup(node: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ReactDOMServer.renderToStaticMarkup(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

describe("TokenPopup", () => {
  it("names the chain, the unit price, and the 24-hour chart", () => {
    const html = renderPopup(
      <TokenPopup symbol="USDC" chain="arb" price="$1.00" />,
    );
    expect(html).toContain("USDC");
    expect(html).toContain("Arbitrum");
    expect(html).toContain("$1.00");
    expect(html).toContain("24h");
    expect(html).toContain("<canvas");
    // Popup rows center; baselining lets image and truncation baselines
    // float the value above the label.
    expect(html).not.toContain("items-baseline");
  });

  it("keeps a price slot at the title edge when no price is known yet", () => {
    const html = renderPopup(<TokenPopup symbol="USDC" chain="arb" />);
    expect(html).toContain("Arbitrum");
    expect(html).toContain("—");
    expect(html).not.toContain("Price");
  });

  it("lets an explicit series and percent win over the fetched one", () => {
    const now = Math.floor(Date.now() / 1000);
    const html = renderPopup(
      <TokenPopup
        symbol="USDC"
        chain="arb"
        price="$1.00"
        history={[
          { time: now - 3600, value: 100 },
          { time: now, value: 110 },
        ]}
        changePct={10}
      />,
    );
    expect(html).toContain("+10.00%");
  });
});

describe("locateLineIndex", () => {
  it("finds first, middle, and last lines", () => {
    expect(locateLineIndex([100, 130, 160], 115)).toBe(0);
    expect(locateLineIndex([100, 130, 160], 145)).toBe(1);
    expect(locateLineIndex([100, 130, 160], 175)).toBe(2);
  });

  it("treats a lone line as first", () => {
    expect(locateLineIndex([100], 115)).toBe(0);
  });
});

describe("resolveAbove", () => {
  it("prefers the requested side when it fits", () => {
    expect(resolveAbove(true, true, true)).toBe(true);
    expect(resolveAbove(false, true, true)).toBe(false);
  });

  it("falls back to whichever side fits", () => {
    expect(resolveAbove(true, false, true)).toBe(false);
    expect(resolveAbove(false, true, false)).toBe(true);
  });

  it("keeps the legacy side when nowhere fits", () => {
    expect(resolveAbove(true, false, false)).toBe(true);
    expect(resolveAbove(false, false, false)).toBe(false);
  });
});

describe("YouPill", () => {
  it("pairs the green pill with a user glyph", () => {
    const html = ReactDOMServer.renderToStaticMarkup(<YouPill />);
    expect(html).toContain("You");
    expect(html).toContain("<svg");
    expect(html).toContain("text-green");
  });
});

describe("AddressPopup", () => {
  it("leads with you, the wallet row, then the address", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AddressPopup
        address={RECIPIENT}
        isSelf
        name="MetaMask"
        icon="https://example.com/mm.png"
      />,
    );
    expect(html).toContain("0x3259…1073");
    expect(html).toContain("You");
    expect(html).toContain("Connected wallet");
    expect(html).toContain(">Wallet<");
    expect(html).toContain("MetaMask");
    expect(html).toContain('src="https://example.com/mm.png"');
    expect(html).toContain(">Address<");
    expect(html).not.toContain("items-baseline");
  });

  it("falls back to connected wallet without a name", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AddressPopup address={RECIPIENT} isSelf />,
    );
    expect(html).toContain("You");
    expect(html).toContain("Connected wallet");
    expect(html).not.toContain(">Wallet<");
  });

  it("marks any other address external in blue with no you marker", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <AddressPopup address={RECIPIENT} isSelf={false} />,
    );
    expect(html).toContain("External Address");
    expect(html).not.toContain(">You<");
  });
});

describe("VenuePopup", () => {
  it("names the settlement ledger and its contract", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <VenuePopup address="0x3259aBcDeF12345678901073" />,
    );
    expect(html).toContain("You");
    expect(html).toContain("Near Account");
    expect(html).toContain("Near Intents");
    expect(html).toContain("intents.near");
    expect(html).toContain("0x3259…1073");
    expect(html).toContain(">Address<");
    expect(html).not.toContain("items-baseline");
  });

  it("leaves the address row out with no connected wallet", () => {
    const html = ReactDOMServer.renderToStaticMarkup(<VenuePopup />);
    expect(html).toContain("Near Intents");
    expect(html).not.toContain(">Address<");
  });

  it("renders the action it is given without reclassifying", () => {
    // Classification lives upstream in collectApprovals; the card renders.
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard
        {...swapProps}
        action="swap"
        fromSymbol="USDC"
        fromChain="arb"
        toSymbol="USDC"
        toChain="near"
        amountIn="14"
        amountOut="13.993034"
      />,
    );
    expect(html).toContain("Swap");
    expect(html).toContain(" for ");
  });
});

describe("wallet names", () => {
  beforeEach(() => {
    mockAccount = { kind: "evm", address: "0x3259aBcDeF12345678901073" };
  });

  const depositProps = {
    action: "deposit",
    fromSymbol: "USDC",
    fromChain: "arb",
    toSymbol: "USDC",
    toChain: "near",
    amountIn: "2",
    amountOut: "2.0",
    recipient: RECIPIENT,
  } as const;

  it("shows the wallet app name instead of hex", () => {
    mockAccount = {
      kind: "evm",
      address: "0x3259aBcDeF12345678901073",
      walletName: "MetaMask",
    };
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...depositProps} />,
    );
    expect(html).toContain("MetaMask");
  });

  it("leads with the wallet brand mark when known", () => {
    mockAccount = {
      kind: "evm",
      address: "0x3259aBcDeF12345678901073",
      walletName: "MetaMask",
      walletIcon: "https://example.com/mm.png",
    };
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...depositProps} />,
    );
    expect(html).toContain('src="https://example.com/mm.png"');
    expect(html).toContain('width="18" height="18"');
  });

  it("falls back to the generic glyph with no brand mark", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...depositProps} />,
    );
    expect(html).not.toContain("<img");
  });

  it("shows a NEAR named account in full", () => {
    mockAccount = { kind: "near", address: "verylongaccountname.near" };
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard
        {...depositProps}
        recipient="verylongaccountname.near"
      />,
    );
    expect(html).toContain("verylongaccountname.near");
  });

  it("shortens an implicit NEAR account", () => {
    const implicit = "a".repeat(64);
    mockAccount = { kind: "near", address: implicit };
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard {...depositProps} recipient={implicit} />,
    );
    expect(html).toContain("aaaaaa…aaaa");
    expect(html).not.toContain(implicit);
  });
});

describe("inkCorrection", () => {
  it("leaves centered art alone", () => {
    expect(
      inkCorrection(40, { minX: 4, maxX: 35, minY: 4, maxY: 35 }, 18),
    ).toBeNull();
  });

  it("lifts bottom-heavy art toward center", () => {
    // Ink spanning y 10..33 of 40: center sits 2px below canvas middle.
    expect(
      inkCorrection(40, { minX: 8, maxX: 31, minY: 10, maxY: 33 }, 18),
    ).toEqual({ x: 0, y: -1 });
  });

  it("rejects degenerate inputs", () => {
    expect(
      inkCorrection(0, { minX: 0, maxX: 0, minY: 0, maxY: 0 }, 18),
    ).toBeNull();
  });
});

describe("TokenAvatar badge", () => {
  it("shrinks the badge with a thin ring on small avatars", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar symbol="USDC" networkBadge="arb" size={18} />,
    );
    expect(html).toContain("width:7px");
    expect(html).toContain("ring-1");
  });

  it("keeps the wider badge and ring on large avatars", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <TokenAvatar symbol="USDC" networkBadge="near" size={36} />,
    );
    expect(html).toContain("width:14px");
    expect(html).toContain("ring-2");
  });
});
