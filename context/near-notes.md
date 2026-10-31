# Near mainnet notes

The facts and traps on this chain that will cost a demo if they are discovered late. Everything here was read from mainnet rather than from documentation.

## Contracts

```ts
export const CONTRACTS = {
  /** RHEA / Ref Finance exchange. The AMM we swap through. */
  rheaExchange: "v2.ref-finance.near",

  /** Wrapped NEAR. Every pool holds this, never native NEAR. */
  wrapNear: "wrap.near",

  /** NEAR Intents verifier. Holds the off-chain ledger and the key registry. */
  intentsVerifier: "intents.near",

  /** USDC bridged by Rainbow. This is the USDC that RHEA pools list. */
  usdcRainbow:
    "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",

  /** USDC as listed by the 1Click API. A different contract. */
  usdcIntents:
    "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",

  /** Portal Bridge USDC. A third flavour, also not interchangeable. */
  usdcPortal16: "16.contract.portalbridge.near",
  usdcPortal3: "3.contract.portalbridge.near",

  usdt: "usdt.tether-token.near",
  usdtRainbow: "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near",
  dai: "6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near",
} as const;
```

## There is no usdc.near

Calling `ft_metadata` on `usdc.near` and on `nusdc.near` both return `CompilationError(CodeDoesNotExist)`. Neither account exists.

At least three real USDC contracts exist on mainnet, and they hold different balances. A user holding one of them cannot spend it through a route that expects another. The application therefore resolves a route by inspecting which contract the connected account actually holds, and the interface shows the contract id rather than a ticker.

## The RHEA pool

Pool 3 on `v2.ref-finance.near` holds the bridged USDC against wNEAR.

```json
{
  "pool_kind": "SIMPLE_POOL",
  "token_account_ids": [
    "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
    "wrap.near"
  ],
  "amounts": ["48133784475", "9066137481030539301351402570"],
  "total_fee": 30,
  "amp": 0
}
```

That is 48,133,784.475 USDC against 9,066,137.481 wNEAR, with a pool fee of thirty basis points. A trade of a hundred USDC produces roughly 18.74 wNEAR at a rate near 5.34 USDC per NEAR, and the price impact at that size is about two tenths of a percent, so the all-in cost lands near half a percent.

Larger trades move the price quickly. A thousand USDC shifts the rate to about 5.44, and ten thousand USDC pushes it past 6.4, so the slippage tolerance has to be widened for larger sizes or the transaction reverts on the minimum output check.

## Swapping is two transactions

The deposit and the swap are separate calls, and both are payable.

```ts
// Transaction 1 — into the exchange
{
  receiverId: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
  actions: [{
    type: "FunctionCall",
    params: {
      methodName: "ft_transfer_call",
      args: { receiver_id: "v2.ref-finance.near", amount: "100000000", msg: "" },
      gas: "100000000000000",
      deposit: "1",
    },
  }],
}

// Transaction 2 — the swap
{
  receiverId: "v2.ref-finance.near",
  actions: [{
    type: "FunctionCall",
    params: {
      methodName: "swap",
      args: {
        actions: [{
          pool_id: 3,
          token_in: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
          amount_in: "100000000",
          token_out: "wrap.near",
          min_amount_out: "<quote x 0.99>",
        }],
      },
      gas: "300000000000000",
      deposit: "1",
    },
  }],
}
```

## Storage deposits

A user needs two storage registrations before their first swap against the exchange, and the total cost is a little over a tenth of a NEAR.

```ts
// On the exchange
await exchange.storage_deposit("");                      // 0.1 NEAR

// On the token contract, naming the exchange
await usdc.storage_deposit({ account_id: "v2.ref-finance.near" }); // 0.0125 NEAR
```

Check `storage_balance_of` first and skip the ones that are already registered. A user who hits an unexplained revert on their first swap will assume the application is broken, so the interface should surface this as a one-time setup step rather than letting it fail silently.

## The output is wNEAR

Pools hold `wrap.near`, so a swap produces wNEAR and never native NEAR. Converting back requires a third call to `near_withdraw` on the wrapper contract.

This is a copy problem as much as a technical one. The product should say that the output is wNEAR, or it should offer the unwrap as a step the user chooses. Promising native NEAR and delivering wNEAR is the kind of discrepancy a judge will notice on the receipt.

## Gas

The protocol floor is 0.0001 NEAR per tera-gas. A function call can attach up to a thousand tera-gas across a transaction and up to a thousand per receipt, with a hundred actions per receipt. A swap needs about three hundred.

Attach what you expect to burn. Since protocol version 78 there is a refund fee charged on unspent gas, so attaching a thousand tera-gas to a swap that burns two hundred costs more than attaching three hundred. The original brief's reference to a limit of one and a quarter tera-gas is stale.

Storage costs one NEAR per hundred kilobytes, and storage deposits are not refunded when the registration is removed.

## Reading the chain

The public nodes have changed which methods they expose.

| What you want | What to call |
|---|---|
| A view call | `EXPERIMENTAL_call_function` with a struct payload |
| A transaction status | `tx` with `wait_until`, or `EXPERIMENTAL_tx_status` |
| Changes in a block | `EXPERIMENTAL_changes` with `changes_type` and numeric `block_id` |

`call_function` was removed in favour of `EXPERIMENTAL_call_function`, and the arguments changed from an array to a struct.

```json
{
  "method": "EXPERIMENTAL_call_function",
  "params": {
    "account_id": "v2.ref-finance.near",
    "method_name": "get_return",
    "args_base64": "<base64 of the JSON args>",
    "finality": "final"
  }
}
```

The result of that call arrives as a raw byte array rather than base64, so it decodes with `Buffer.from(result)`.

`tx_status` is not registered on the public nodes, which returns a method-not-found error rather than anything helpful.

## Receipts

A transaction that touches two contracts produces an outer receipt and an inner one, and the inner one is where a swap actually executes. The outer transaction can report success while the inner receipt has failed.

```ts
const outerFailed =
  outcome.status && typeof outcome.status === "object" && "Failure" in outcome.status;

const innerFailed = outcome.receipts.some(
  (r) => r.outcome.status && "Failure" in r.outcome.status,
);

const ok = !outerFailed && !innerFailed;
```

Blocks arrive roughly every six hundred milliseconds and finality lands about a second later, so polling is inexpensive. There is no standard web socket endpoint for transaction status on NEAR, so poll with `tx` and a `wait_until` of `FINAL`.

## RPC providers

Measured on 22 October 2026 with parallel bursts.

| Endpoint | Result |
|---|---|
| `https://free.rpc.fastnear.com` | Handled every parallel request. The best free option. |
| `https://rpc.fastnear.com` | Handled every parallel request. Use as a backup. |
| `https://rpc.mainnet.near.org` | Answers light calls but is deprecated and returns rate limits under load. |
| `https://rpc.near.org` | Same deprecation. |
| `https://rpc.mainnet.pagoda.co` | Deprecated, even though the near-api-js readme still lists it. |
| `https://near-mainnet.public.blastapi.io` | Dead, the hostname does not resolve, though the documentation still lists it. |
| `https://near.drpc.org` | No view calls available. |
| `https://1rpc.io/near` | Limited method set, two hundred requests per day. |
| `https://rpc.ankr.com/near` | Needs an API key. |
| `https://near.blockpi.network/v1/rpc/public` | Needs an API key. |

Use the two fastnear endpoints inside a `FailoverRpcProvider` from near-api-js.

## NEAR Intents

The 1Click API is a separate system with its own asset universe.

| Endpoint | Purpose |
|---|---|
| `GET /v0/tokens` | The asset catalogue with live prices. No authentication needed. |
| `POST /v0/quote` | A quote. Unauthenticated works and adds twenty-five basis points. |
| `POST /v0/deposit/submit` | Tells the API about a deposit so processing starts sooner. |
| `GET /v0/status` | The authoritative status of a swap. |
| `POST /v0/generate-intent` | Builds the payload for an off-chain signed intent. Needs a partner key. |
| `POST /v0/submit-intent` | Submits a signed intent. Needs a partner key. |
| `POST /v0/auth/authenticate` | Exchanges a signed NEP-413 payload for a user session. |

A partner key from `partners.near-intents.org` drops the platform fee from twenty-five basis points to twenty, and to one basis point for stablecoin pairs.

The fees break down as a protocol fee of one pip collected by the verifier contract, the 1Click platform fee described above, and an optional application fee that this product can set and split with 1Click.

The deposit address is an implicit NEAR account, and the output settles as wNEAR in the recipient account. Depositing native NEAR requires wrapping it first.

The signed intent path is the one that a bounded agent will use, because it needs an off-chain signature rather than a transaction.

## The verifier key model

This is the mechanism that makes a bounded agent possible.

The verifier contract keeps its own mapping from account ids to public keys, populated through `add_public_key`. Any public key registered against an account may sign intents on behalf of that account, and the registration is independent of the key's permission on the NEAR account itself.

That separation is what makes the agent design safe. The agent's key is added to the account as a function-call key scoped to a single contract and a single non-payable method, which means its on-chain authority is almost nothing. It is separately registered with the verifier, which means it can sign intents that move funds inside the verifier's ledger. Revoking the registration stops those signatures from verifying immediately and provably.

What the chain enforces is isolation, revocability, and expiry. What it does not enforce is a numeric spending limit, because a registered key can sign any intent the account is entitled to. The spending cap is a policy decision made in application code, and the honest description is that the cap is enforced by the policy engine while the isolation, the revocation, and the expiry are enforced by the contract.

## Function-call access keys

A function-call key names one contract, optionally a list of methods, and optionally an allowance. It cannot attach a deposit, which means it can never call a payable method, and every token transfer and every swap is payable. A function-call key therefore cannot move tokens on its own.

Its allowance governs gas, not transfers. There is no documented cap on how many keys an account may hold; the number that circulates is a pagination size for a read method.

## Gas keys

Protocol version 86 introduced gas keys, which carry their own prepaid balance and up to a thousand and twenty-four independent nonce lanes. They are the right primitive for a programmatic sender that must not collide with itself on nonces.

## Meta-transactions

near-api-js version 7 ships `createSignedMetaTransaction`, which produces a NEP-366 delegated action. The user signs once and a relayer submits it and pays the gas. It is the cleanest expression of "the assistant can act, but the user signed for a bounded window", and it complements the verifier key model rather than competing with it.

## What to do before the demonstration

Prove the plumbing with a self-transfer of a thousandth of a NEAR before anything else. It exercises the RPC, the key, the signing, the finality wait, and the receipt inspection in one step, and it finds most integration bugs in an afternoon rather than a day.

Pre-register the storage deposits on the demonstration account, so that the first swap in the demonstration is a swap and not a setup transaction.

Keep a small balance of both USDC contracts on the demonstration account, so that either route can be shown without a treasury operation in the middle of a live demonstration.
