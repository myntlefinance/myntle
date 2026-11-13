import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({
    account: null,
    signMessage: vi.fn(),
    sendDeposit: vi.fn(),
    signNEP413: vi.fn(),
  }),
}));

vi.mock("@/components/atoms/Button", async () => {
  const ReactModule = await import("react");
  return {
    Button: (props: { children?: React.ReactNode }) =>
      ReactModule.createElement("button", null, props.children),
  };
});

import SentenceTradeCard, {
  advanceCardState,
  approveThroughAdapter,
  polledState,
  type SentenceApprovalWiring,
  type SentenceCardState,
} from "./SentenceTradeCard";

function sentence(html: string): string {
  const match = html.match(/data-sentence[^>]*>([\s\S]*?)<\/div>/);
  return (match?.[1] ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("limit order on the sentence card", () => {
  it("reads the user's price and total as a sentence", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard
        action="limit"
        fromSymbol="wNEAR"
        fromChain="near"
        toSymbol="USDC"
        toChain="arb"
        amountIn="1"
        amountOut="5"
        recipient="0x0000000000000000000000000000000000000001"
        limit={{
          side: "SELL",
          price: "5",
          total: "5",
          funding: "account",
        }}
        runApproval={async () => ({
          ok: true,
          transactionId: "tx-limit",
          depositAddress: "0x0000000000000000000000000000000000000002",
        })}
      />,
    );

    expect(sentence(html)).toContain("Sell");
    expect(sentence(html)).toContain("wNEAR");
    expect(sentence(html)).toContain("at 5");
    expect(sentence(html)).toContain("USDC");
    expect(sentence(html)).toContain("each");
  });

  it("reads a yield deposit with the vault and APY", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <SentenceTradeCard
        action="earn"
        fromSymbol="USDC"
        fromChain="base"
        toSymbol="gtUSDCp"
        toChain="base"
        amountIn="100"
        amountOut="89003296"
        recipient="0x0000000000000000000000000000000000000001"
        earn={{ name: "USDC Prime", protocol: "Morpho", apy: 4.50508 }}
        runApproval={async () => ({
          ok: true,
          transactionId: "tx-earn",
          depositAddress: "0x0000000000000000000000000000000000000002",
        })}
      />,
    );

    const text = sentence(html);
    expect(text).toContain("Earn");
    expect(text).toContain("USDC");
    expect(text).toContain("USDC Prime");
    expect(text).toContain("4.51% APY");
  });

  it("maps a resting order to open and a fill to partial", () => {
    expect(polledState("submitted", "limit", true)).toBe("waiting");
    expect(polledState("pending", "limit", true)).toBe("open");
    expect(polledState("processing", "limit", true, "PARTIALLY_FILLED")).toBe(
      "partial",
    );
    expect(polledState("processing", "limit", true, "PENDING_CANCEL")).toBe(
      "cancelling",
    );
  });

  it("never regresses an open or partial order to waiting", () => {
    expect(advanceCardState("open", "waiting")).toBe("open");
    expect(advanceCardState("partial", "open")).toBe("partial");
    expect(advanceCardState("partial", "waiting")).toBe("partial");
    expect(advanceCardState("open", "settled")).toBe("settled");
  });

  it("lands a wallet-funded order in the funding panel", async () => {
    const wiring = {
      action: "limit" as const,
      expired: false,
      inFlight: { current: false },
      states: [] as SentenceCardState[],
      deposits: [] as string[],
      calls: 0,
      setState: (next: SentenceCardState) => wiring.states.push(next),
      setError: () => {},
      setTxId: () => {},
      setDeposit: (address: string) => wiring.deposits.push(address),
      setMemo: () => {},
      setFee: () => {},
      setFigures: () => {},
      setDestination: () => {},
      openDetails: () => {},
      runApproval: async () => {
        wiring.calls += 1;
        return {
          ok: true as const,
          transactionId: "tx-limit",
          depositAddress: "0x0000000000000000000000000000000000000002",
          deposit: {
            address: "0x0000000000000000000000000000000000000002",
            memo: null,
            expiresAt: "2099-01-01T00:00:00.000Z",
            amountInRaw: "5000000",
            tokenContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            chainId: 8453,
            chainName: "Base",
            chainSlug: "base",
            decimals: 6,
            symbol: "USDC",
          },
        };
      },
    } satisfies SentenceApprovalWiring & {
      states: SentenceCardState[];
      deposits: string[];
      calls: number;
    };

    await approveThroughAdapter(wiring);
    expect(wiring.calls).toBe(1);
    expect(wiring.states).toContain("waiting");
    expect(wiring.deposits).toContain(
      "0x0000000000000000000000000000000000000002",
    );
  });
});
