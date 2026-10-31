# Architecture

How Myntle is put together, and why each piece is where it is. This document assumes you have read `verification-report.md`, because several decisions here exist because that research overturned something in the original brief.

## The shape of the product

A user connects an existing NEAR wallet, asks for something in plain language, reads a quote the assistant prepared, approves it, and watches the transaction resolve against the chain. The conversation is the entire interface. There is no dashboard, no portfolio page, and no settings screen in the first release.

The application holds no private key and no funds. It holds records: conversations, quotes, approvals, and settlement outcomes. That separation is what makes the product safe to demo in front of strangers.

The user may arrive on any chain. An EVM wallet, a Solana wallet, and a NEAR wallet all reach the same conversation, and the account the application records is the one the verifier knows, which is derived from the public key rather than from the chain the user happened to pick. `context/wallets.md` covers that layer.

## Four layers

### Presentation

A Next.js App Router client application. It renders the conversation transcript, the assistant's tool activity, the quote card, the approval card, the transaction timeline, and the balance list.

The transcript is the spine of the interface. Tool calls appear inline where they happened rather than in a separate panel, because the user's question is "what did it do with my money" and the answer is a sequence, not a table.

### Intelligence

One route handler, `app/api/chat/route.ts`, calls NEAR AI Cloud through the Vercel AI SDK. It owns the system instructions, the tool registry, and the approval policy.

The model may do three things: read state through read-only tools, ask the user a question, and request a swap through a single write tool. It cannot construct a transaction, choose a contract, or reach a wallet. Everything it returns is a proposal that the server validates before acting.

### Authorization and execution

Deterministic application code. The `prepare_swap` tool is configured with `toolApproval: { prepare_swap: 'user-approval' }`, which means the tool call pauses and waits for the user before its body executes at all. The approval is bound to the exact parameters of the quote, and the server recomputes those parameters before signing rather than trusting the stored ones.

This layer is the reason the product is worth anything. It is also the reason it is boring: validation, an allowlist, a wallet prompt, a record.

### Durability and verification

Supabase Postgres holds users, wallets, sessions, conversations, messages, quotes, approvals, and transactions. The transaction lifecycle itself runs as a durable workflow in the Workflow SDK, on the Vercel World, which is selected automatically because the application is deployed to Vercel.

The split matters. Postgres is the record of what happened, and it is queryable by the interface at any time. The workflow is the thing that is currently happening, and it owns the execution, the polling, and the reconciliation. The interface reads the record, so a refresh never loses the state of a transaction, and the workflow keeps running whether or not anyone is looking at it.

The authoritative source for the outcome depends on the engine. For RHEA swaps it is the NEAR chain itself, read with `wait_until: "FINAL"`. For NEAR Intents it is the 1Click status endpoint. In both cases the rule is the same, and it is the rule that the original brief got right: the network decides the outcome, not the assistant.

`context/durability.md` covers the engine, where it runs, and the traps.

## The settlement engine

Protocol integration sits behind a single TypeScript interface so that the AI layer and the chat UI never learn which protocol is underneath.

```ts
export interface SettlementEngine {
  id: string;
  label: string;

  supportedAssets(): Promise<Asset[]>;

  quote(req: QuoteRequest): Promise<Quote>;

  prepare(req: QuoteRequest, ctx: SwapContext): Promise<PreparedSwap>;

  status(ref: SwapRef): Promise<SwapStatus>;
}
```

**NEAR Intents is the only engine in the first release.** It talks to the 1Click API. It quotes with `POST /v0/quote`, and execution happens either as an on-chain transfer to a deposit address that a solver then fills, or as an off-chain signature in the user's own chain's standard, submitted with `POST /v0/submit-intent`. It settles inside the ledger of the `intents.near` verifier contract.

The signed-intent path is the one that matters, because it needs no gas, no account creation, and no on-chain transaction from the user. The wallet signs a message, the verifier checks the signature against the account it already knows, and the solver network does the rest. The same path works for an EVM wallet, a Solana wallet, and a NEAR wallet, because the verifier speaks all three signing standards.

**The RHEA engine is not built in the first release.** It talks to `v2.ref-finance.near`, and executing a swap through it takes two wallet transactions and two one-time storage deposits. It settles entirely on the NEAR chain with no solver in the middle, which is a genuinely better property for a user who wants it and a worse one for everybody else. The interface above is kept so that it can be added back as a second implementation.

### Why two engines

The two protocols do not share assets. RHEA pools list the Rainbow-bridged USDC, `a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near`, and the 1Click asset list contains a different USDC entirely, `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. There is no `usdc.near`. A user holding one contract cannot use the other protocol's route.

Rather than hide that, the application detects which contract the connected account actually holds and offers the route that works. A judge with a Rainbow USDC balance sees the RHEA route, and a judge who has never touched NEAR sees an explanation of what to acquire and which engine will take it from there.

### The asset problem, stated once

Every asset in the system is addressed by chain and by contract id, never by ticker. The tickers `USDC`, `USDC.e`, and `wNEAR` are display strings only. This is not pedantry: the same ticker means different contracts on different chains, a swap that names the wrong contract spends the wrong balance, and the balance the user sees in the interface will not be the one that moved.

## The AI layer in practice

The provider is NEAR AI Cloud, reached through `createOpenAICompatible` with the base URL `https://cloud-api.near.ai/v1`. It speaks the OpenAI Chat Completions shape, including streaming and tool calling, which means the AI SDK's tool-call streaming, multi-step loops, and approval machinery all work normally.

The tool registry is deliberately small.

| Tool | Kind | Approval | Purpose |
|---|---|---|---|
| `get_wallet_balances` | read | none | On-chain NEP-141 balances plus the `intents.near` ledger balance, valued with the price list from the 1Click token endpoint. |
| `get_supported_assets` | read | none | Which assets the connected account can actually route, and through which engine. |
| `get_quote` | read | none | A price quote for a proposed swap, including minimum output, fees, and deadline. |
| `get_transaction_status` | read | none | The authoritative status of a transaction the user already started. |
| `get_transaction_history` | read | none | Past transactions for this account. |
| `prepare_swap` | write | `user-approval` | Creates the quote, records the approval, and returns the exact parameters the wallet will sign. |

`prepare_swap` is the only tool that leads to money moving, and it does not move money itself. It produces a signed-ready description; the wallet produces the signature; the execution route submits it.

The model runs with `stopWhen: isStepCount(N)` set explicitly, because the default of one step would end the conversation after a single tool round, and a question like "swap 100 USDC for NEAR and tell me my balance" needs at least two.

## Sessions and authentication

Connecting a wallet establishes an address, but an address is not proof of ownership. The application issues a random 32-byte nonce, asks the wallet to sign a message that binds the nonce to the application and to the chain, and verifies that signature server-side before issuing a session.

The verification is per chain, because the signing formats differ. EVM wallets sign with ERC-191 and the signature is verified by recovering the address. Solana wallets sign raw Ed25519 and the signature is verified against the public key. NEAR wallets sign with NEP-413 and the signature is verified against the account key on chain. The nonce is consumed once and expires after five minutes.

Two traps are worth writing down. The nonce must be exactly 32 bytes, because the official NEAR tutorial uses `Buffer.from(crypto.randomUUID())`, which produces 36 bytes of ASCII and yields a hash that never validates. And if a NEAR wallet signed with a `callbackUrl`, the verification payload must include it, byte for byte, or the hash will not match.

## Data model

```
users        id, created_at
wallets      id, user_id, account_id, network, created_at
sessions     id, user_id, expires_at, revoked_at
conversations id, user_id, title, created_at
messages     id, conversation_id, role, parts, created_at
quotes       id, user_id, engine, request, response, expires_at
approvals    id, quote_id, user_id, approved_at, parameters
transactions id, user_id, approval_id, engine, state, refs, outcome, updated_at
agent_keys   id, user_id, public_key, scope, allowance, expires_at, revoked_at
```

Two rules hold across all of them. The primary key is always an internal id, never a wallet address, because a user may connect several wallets and a wallet address is not an identity. And every read of a user's data goes through an ownership check, which is why the application talks to Postgres from the server only, with the service role, and never from the browser.

## Transaction states

```
draft → quoted → awaiting_approval → authorized → submitted
      → confirming → settled
                  ↘ refunded | failed | expired
                  ↘ needs_reconciliation
```

`settled` is only ever set from an authoritative read. The reconciler moves transactions out of `confirming`, and anything still unconfirmed past its expected window moves to `needs_reconciliation`, which pages a human rather than guessing.

## What the bounded agent changes later

When autonomy arrives, almost nothing in the architecture moves. The agent gets its own key, registered with the `intents.near` verifier so that the verifier accepts its signatures, and a policy engine that decides which intents the agent may sign. The quote path, the approval records, and the state machine are identical.

What changes is who signs. Today the connected wallet signs. Later, either the agent key signs within its policy, or the user signs a delegated action once and a relayer submits within that grant. Both are additive.
