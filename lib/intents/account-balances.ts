/**
 * The raw confidential-ledger read behind the Myntle balance.
 *
 * Both the `get_super_balances` tool and the `get_quote` balance gate use
 * this path, so there is exactly one place that knows the endpoint, the
 * auth scheme, and the entry shape. Callers decide what a failure means:
 * the balance tool reports locked/error, the quote gate fails open and
 * prices without the check.
 */

const ONE_CLICK =
  process.env.NEXT_PUBLIC_ONE_CLICK_BASE_URL ??
  "https://1click.chaindefuser.com";

export type AccountBalanceEntry = {
  tokenId: string;
  available: string;
};

export class AccountBalancesError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("The Myntle balance could not be read.");
    this.name = "AccountBalancesError";
    this.status = status;
  }
}

/**
 * Reads the raw available amounts for every token the account holds.
 *
 * Throws AccountBalancesError on any non-OK response (401 included, so the
 * caller can tell a locked account from a broken read). Never returns
 * partial data: a malformed body is an error, not an empty balance, because
 * an empty balance would wrongly refuse a trade the account can afford.
 */
export async function fetchAccountBalances(
  token: string,
): Promise<AccountBalanceEntry[]> {
  const res = await fetch(`${ONE_CLICK}/v0/account/balances`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new AccountBalancesError(res.status);

  // A body that is not JSON is an error, never an empty balance: an empty
  // balance would wrongly refuse a trade the account can afford.
  let data: { balances?: unknown } | null;
  try {
    data = (await res.json()) as { balances?: unknown } | null;
  } catch {
    throw new AccountBalancesError(res.status);
  }
  const entries = Array.isArray(data?.balances) ? data.balances : [];
  const out: AccountBalanceEntry[] = [];
  for (const entry of entries) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { tokenId?: unknown }).tokenId === "string" &&
      typeof (entry as { available?: unknown }).available === "string"
    ) {
      out.push({
        tokenId: (entry as { tokenId: string }).tokenId,
        available: (entry as { available: string }).available,
      });
    }
  }
  return out;
}
