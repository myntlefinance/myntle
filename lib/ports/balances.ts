/**
 * Balances port. Domain vocabulary (`TokenBalance`, `AssetGroup`, …) is
 * reused from `lib/wallet/balances.ts` and never redefined here.
 *
 * Adapters return port types and throw the taxonomy from `./errors.ts`
 * on failure — they never return the legacy `{ error }` string shape.
 * The facade in step 05 maps a thrown port error back to that shape so
 * existing callers stay unchanged.
 */

import type {
  AssetGroup,
  BalanceFilterOptions,
  SupportedNetwork,
  TokenBalance,
  WalletBalancesResult,
} from "@/lib/wallet/balances";

export type {
  AssetGroup,
  BalanceFilterOptions,
  SupportedNetwork,
  TokenBalance,
  WalletBalancesResult,
};

/** Port result: balances without the legacy string-error channel. */
export type BalancesResult = Omit<WalletBalancesResult, "error">;

export interface BalancesPort {
  getBalances(
    chain: string,
    address: string,
    options?: BalanceFilterOptions,
  ): Promise<BalancesResult>;
}
