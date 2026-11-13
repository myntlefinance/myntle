import { tool } from "ai";
import { z } from "zod";
import {
  getConnectedWalletBalances,
  groupBalancesByNetwork,
  isPhishingToken,
  type SupportedNetwork,
  type AssetCategory,
  type TokenBalance,
} from "@/lib/wallet/balances";
import { normalizeWatchedAddress } from "@/lib/wallet/addresses";
import { getIntentsLedgerBalances } from "@/lib/intents/balances";
import { getLivePrices, type LivePrice } from "@/lib/prices/server";
import { NameInputError, resolveInputAddress } from "@/lib/names/binding";
import { isNameLikeValue } from "@/lib/names/detect";
import {
  SupportedNetworkEnum,
  SupportedChainEnum,
  type ToolContext,
} from "../context";
import type { Capability } from "../capability";

export const GET_WALLET_BALANCES_CAPABILITY: Capability = {
  tool: "get_wallet_balances",
  tier: "read-public",
  subject: "any-address",
  approval: "none",
  attribution: "required",
  promptTerms: ["get_wallet_balances", "any public address"],
};

/**
 * Reads token balances for an account.
 */
export async function readBalances(accountId: string, chain = "near") {
  return getConnectedWalletBalances(chain, accountId);
}

/** The ids a set of balances can be priced by, without duplicates. */
function pricedAssetIds(balances: readonly TokenBalance[]): string[] {
  return [
    ...new Set(
      balances
        .map((balance) => balance.assetId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
}

/**
 * Rewrites a balance's unit price and value from a live quote.
 *
 * The quantity the balance layer derived is exact, so it is preferred over
 * re-parsing the display string. A row without an asset id, or without a
 * quote, keeps the price the provider or the catalogue settled.
 */
function withLivePrice(
  balance: TokenBalance,
  live: ReadonlyMap<string, LivePrice>,
): TokenBalance {
  if (!balance.assetId) return balance;
  const quote = live.get(balance.assetId);
  if (!quote || !Number.isFinite(quote.usd)) return balance;

  const quantity =
    typeof balance.quantity === "number" && Number.isFinite(balance.quantity)
      ? balance.quantity
      : Number.parseFloat(balance.balance.replace(/,/g, ""));
  if (!Number.isFinite(quantity)) {
    return balance.priceUsd === quote.usd &&
      balance.priceAsOf === quote.asOf
      ? balance
      : { ...balance, priceUsd: quote.usd, priceAsOf: quote.asOf };
  }

  const valueUsd = Number.parseFloat((quantity * quote.usd).toFixed(2));
  if (!Number.isFinite(valueUsd)) {
    return balance.priceUsd === quote.usd &&
      balance.priceAsOf === quote.asOf
      ? balance
      : { ...balance, priceUsd: quote.usd, priceAsOf: quote.asOf };
  }
  if (
    balance.priceUsd === quote.usd &&
    balance.valueUsd === valueUsd &&
    balance.priceAsOf === quote.asOf
  ) {
    return balance;
  }
  return {
    ...balance,
    priceUsd: quote.usd,
    valueUsd,
    priceAsOf: quote.asOf,
  };
}

export function createWalletBalancesTool(context?: ToolContext) {
  const accountKind = context?.accountKind ?? "wallet";

  return tool({
    description:
      accountKind === "passkey"
        ? "Read this account's token balances. A passkey account has no chain wallet, so this " +
          "reads the account's NEAR Intents ledger only and never a wallet. The private " +
          "balance is read with get_super_balances. Use this whenever the user asks " +
          "what the account holds or what is available to trade. Pass symbol for a single-token " +
          "check and omit it for an inventory."
        : "Read the user's public token balances. Returns on-chain balances in their connected wallet " +
          "(EVM, Solana, or NEAR) and their public NEAR Intents settlement ledger balance. " +
          "This tool cannot see private funds: for the private balance inside the super account, " +
          "call get_super_balances instead. " +
          "Use this whenever the user asks about their balances, portfolio, or what they have available to trade. " +
          "A single-token question should pass symbol, and the one network when the user named one; a portfolio " +
          "question should omit both. An address argument may be a name such as vitalik.eth or example.sns; " +
          "it resolves server-side before the read.",
    inputSchema: z.object({
      address: z
        .string()
        .optional()
        .describe(
          "The wallet address to check. Defaults to the connected wallet if omitted.",
        ),
      chain: SupportedChainEnum.optional().describe(
        "The blockchain network family (evm, solana, near). Defaults to the connected wallet chain.",
      ),
      networks: z
        .array(SupportedNetworkEnum)
        .optional()
        .describe(
          "Specific networks to query (e.g. ['arbitrum'], ['base', 'ethereum']). " +
            "When the user asks for a single network like 'my arbitrum balances', pass ['arbitrum']. " +
            "A single-token check should name the network when the user named one.",
        ),
      category: z
        .enum(["all", "stables", "dust", "native"])
        .optional()
        .describe(
          "Filter by asset category: 'stables' for stablecoins (USDC, USDT, USDS, AUSD, DAI), " +
            "'dust' for balances under $1, 'native' for gas tokens (ETH, SOL, NEAR).",
        ),
      symbol: z
        .string()
        .optional()
        .describe(
          "Specific token symbol to filter by (e.g. 'USDC', 'ETH'). Pass it for a " +
            "single-token check; omit it when the user asked to see their holdings.",
        ),
      includeZeroValue: z
        .boolean()
        .optional()
        .describe(
          "Whether to include zero-value or unpriced tokens. Defaults to false (hidden by default). " +
            "Only set to true if the user explicitly asks to see zero-value tokens, unpriced assets, or fresh airdrops.",
        ),
      includeSettlementLedger: z
        .boolean()
        .optional()
        .describe(
          "Whether to include the public NEAR Intents settlement ledger. Defaults to false when specific non-NEAR networks are queried, or true for general portfolio queries.",
        ),
    }),
    execute: async ({
      address,
      chain,
      networks,
      category,
      symbol,
      includeZeroValue,
      includeSettlementLedger,
    }) => {
      // A passkey account has no chain wallet. The session names the only
      // account this tool may read, so an address or chain from the model is
      // ignored rather than pointed at someone else's holdings.
      if (accountKind === "passkey") {
        const accountId = context?.intentsAccountId?.trim();
        if (!accountId) {
          return {
            source: "none" as const,
            message:
              "No account is signed in. Sign in with a passkey to read the account balance.",
          };
        }

        const ledger = await getIntentsLedgerBalances(accountId, "near");
        const allowZero = Boolean(includeZeroValue || symbol);
        const wantedSymbol = symbol?.trim().toLowerCase() || null;

        // Price the whole ledger once, then filter. A live quote can make a
        // row valuable that the catalogue priced at zero or not at all.
        const live = await getLivePrices(
          ledger.balances.map((balance) => balance.assetId),
        );
        const priced = ledger.balances.map((b) =>
          withLivePrice(
            {
              chain: "near",
              network: "intents",
              symbol: b.symbol,
              name: b.symbol,
              contractAddress: b.assetId,
              decimals: b.decimals,
              balance: b.balance,
              rawBalance: b.rawBalance,
              priceUsd: b.priceUsd,
              valueUsd: b.valueUsd,
              assetId: b.assetId,
              ...(b.quantity !== undefined ? { quantity: b.quantity } : {}),
              ...(b.priceAsOf !== undefined ? { priceAsOf: b.priceAsOf } : {}),
            },
            live,
          ),
        );

        const balances: TokenBalance[] = [];
        for (const b of priced) {
          if (isPhishingToken(b.symbol, b.symbol)) continue;
          if (wantedSymbol && b.symbol.toLowerCase() !== wantedSymbol) continue;
          if (!allowZero && (!b.valueUsd || b.valueUsd <= 0)) continue;
          balances.push(b);
        }

        const totalValueUsd = balances.reduce(
          (sum, balance) => sum + (balance.valueUsd ?? 0),
          0,
        );
        const initialFilter =
          category && category !== "all" ? category : "all";
        const groups = groupBalancesByNetwork(balances);
        // A single token is a check, not an inventory: the reply carries the
        // figure and the interface leaves the table off. Derived from the
        // query rather than chosen by the model, so an inventory question can
        // never lose its table.
        const showCard = !(
          symbol &&
          groups.length === 1 &&
          groups[0].items.length === 1
        );

        return {
          source: "session" as const,
          accountKind: "passkey" as const,
          // The account id is not a wallet address, so it is returned as
          // `accountId` and never as the wallet `address` field.
          accountId,
          chain: "near",
          title:
            category === "stables"
              ? "Stablecoin balances"
              : category === "dust"
                ? "Dust balances"
                : "Account balances",
          showFilters: !category || category === "all",
          initialFilter,
          singleNetwork: null,
          category: category ?? "all",
          totalValueUsd: Number.parseFloat(totalValueUsd.toFixed(2)),
          groups,
          showCard,
          // A passkey account has no wallet section. The ledger is the
          // account, so nothing on this result is a chain wallet.
          wallet: { balances: [], totalValueUsd: 0 },
          settlementLedger: {
            balances,
            totalValueUsd: Number.parseFloat(totalValueUsd.toFixed(2)),
            status: ledger.status,
            message: ledger.message,
          },
          // The public ledger is not the private balance. A locked or
          // unread private balance must never be presented as zero funds.
          privateBalance: "separate" as const,
          privateBalanceNote:
            "This tool reads the public account ledger only. The private balance is separate; call get_super_balances before concluding the account has no funds.",
          ...(ledger.status === "empty"
            ? { message: "No public balances. The private balance is separate." }
            : {}),
        };
      }

      const targetChain = chain || context?.activeChain;

      // A model-supplied address may be a name. It resolves server-side
      // before any provider read, so the model never binds an address
      // itself. Anything else keeps the raw path exactly as before.
      let resolvedName: string | null = null;
      let targetAddress = address || context?.activeAddress;
      if (
        address &&
        (targetChain === "evm" || targetChain === "solana") &&
        isNameLikeValue(address)
      ) {
        try {
          const hit = await resolveInputAddress({
            value: address,
            scope: targetChain,
            isDirectAddress: (value) =>
              normalizeWatchedAddress(targetChain, value),
          });
          targetAddress = hit.address;
          resolvedName = hit.name;
        } catch (error) {
          if (error instanceof NameInputError) {
            if (error.reason === "unregistered") {
              return {
                source: "none" as const,
                message:
                  "That name is not registered. Ask the user for the full address.",
              };
            }
            if (error.reason === "unavailable") {
              return {
                source: "none" as const,
                message: "Name lookup is unavailable. Try again shortly.",
              };
            }
            return {
              source: "none" as const,
              message:
                "That name is not valid. Ask the user for the full address.",
            };
          }
          throw error;
        }
      }

      if (!targetAddress || !targetChain) {
        return {
          source: "none" as const,
          message:
            "No wallet is connected. Please connect a wallet to view balances.",
        };
      }

      const shouldIncludeLedger =
        includeSettlementLedger ??
        (networks && networks.length > 0 && !networks.includes("near")
          ? false
          : true);

      const [walletRes, intentsRes] = await Promise.all([
        getConnectedWalletBalances(targetChain, targetAddress, {
          networks: networks as SupportedNetwork[] | undefined,
          category: category as AssetCategory | undefined,
          symbol,
          includeZeroValue,
        }),
        shouldIncludeLedger
          ? getIntentsLedgerBalances(targetAddress, targetChain ?? undefined)
          : Promise.resolve(null),
      ]);

      // One live read for everything this answer shows. Wallet rows carry an
      // assetId from the balance layer; ledger rows already carry one. A
      // quote overrides the stored price, and a missing quote leaves it.
      const live = await getLivePrices([
        ...pricedAssetIds(walletRes.balances),
        ...(intentsRes?.balances ?? []).map((balance) => balance.assetId),
      ]);

      const walletBalances = walletRes.balances.map((balance) =>
        withLivePrice(balance, live),
      );
      const allBalances: TokenBalance[] = [...walletBalances];
      // The ledger is a second section of the same answer, so it obeys the
      // same symbol filter. Otherwise a single-token check could pull every
      // ledger token into the result and turn the card back on.
      const wantedSymbol = symbol?.trim().toLowerCase() || null;
      const ledgerBalances: TokenBalance[] = [];
      if (intentsRes?.balances) {
        const allowZero = Boolean(includeZeroValue || symbol);
        for (const b of intentsRes.balances) {
          const entry = withLivePrice(
            {
              chain: "near",
              network: "intents",
              symbol: b.symbol,
              name: b.symbol,
              contractAddress: b.assetId,
              decimals: b.decimals,
              balance: b.balance,
              rawBalance: b.rawBalance,
              priceUsd: b.priceUsd,
              valueUsd: b.valueUsd,
              assetId: b.assetId,
              ...(b.quantity !== undefined ? { quantity: b.quantity } : {}),
              ...(b.priceAsOf !== undefined ? { priceAsOf: b.priceAsOf } : {}),
            },
            live,
          );
          if (isPhishingToken(entry.symbol, entry.symbol)) continue;
          if (wantedSymbol && entry.symbol.toLowerCase() !== wantedSymbol) {
            continue;
          }
          if (!allowZero && (!entry.valueUsd || entry.valueUsd <= 0)) continue;

          ledgerBalances.push(entry);
          allBalances.push(entry);
        }
      }

      const singleNetwork =
        networks && networks.length === 1 ? networks[0] : null;

      let suggestedTitle = "Portfolio balances";
      if (singleNetwork) {
        suggestedTitle = `${singleNetwork.charAt(0).toUpperCase() + singleNetwork.slice(1)} balances`;
      } else if (category === "stables") {
        suggestedTitle = "Stablecoin balances";
      } else if (category === "dust") {
        suggestedTitle = "Dust balances";
      } else if (targetChain === "evm" && (!networks || networks.length > 1)) {
        suggestedTitle = "EVM balances";
      }

      const showFilters = !singleNetwork && (!category || category === "all");
      const initialFilter = category && category !== "all" ? category : "all";
      const totalCombinedUsd = allBalances.reduce(
        (sum, balance) => sum + (balance.valueUsd ?? 0),
        0,
      );

      const groups = groupBalancesByNetwork(allBalances);
      // A check is one asset, read for the connected wallet. The result shape
      // carries the scope: if the token sits on more than one network, the
      // groups keep the table. An address that names someone else also keeps
      // the card, so their number never loses its attribution.
      const isSessionAddress =
        !address ||
        (!!context?.activeAddress &&
          address.trim().toLowerCase() ===
            context.activeAddress.trim().toLowerCase());
      const singleAssetCheck =
        Boolean(symbol) &&
        isSessionAddress &&
        groups.length === 1 &&
        groups[0].items.length === 1;

      return {
        // `session` means the connected wallet; `requested` means the model
        // passed an address. The distinction stops a card from being read as
        // the user's own holdings when it is someone else's.
        source: address ? "requested" : "session",
        address: targetAddress,
        // The name the address resolved from, when the model passed one.
        // The model already supplied it, so echoing it leaks nothing.
        ...(resolvedName ? { resolvedName } : {}),
        chain: targetChain,
        title: suggestedTitle,
        showFilters,
        initialFilter,
        singleNetwork,
        category: category ?? "all",
        totalValueUsd: Number.parseFloat(totalCombinedUsd.toFixed(2)),
        groups,
        showCard: !singleAssetCheck,
        wallet: {
          balances: walletBalances.slice(0, 30),
          totalValueUsd: Number.parseFloat(
            walletBalances
              .reduce((sum, balance) => sum + (balance.valueUsd ?? 0), 0)
              .toFixed(2),
          ),
          error: walletRes.error,
        },
        settlementLedger: intentsRes
          ? {
              balances: ledgerBalances,
              totalValueUsd: Number.parseFloat(
                ledgerBalances
                  .reduce((sum, balance) => sum + (balance.valueUsd ?? 0), 0)
                  .toFixed(2),
              ),
              status: intentsRes.status,
              message: intentsRes.message,
            }
          : null,
      };
    },
  });
}

export const getWalletBalances = createWalletBalancesTool();
