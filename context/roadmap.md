# Roadmap

Ten days of preparation, fourteen days of build, and one submission. The hackathon runs from the first of November to the fourteenth of November 2026, and the jury includes language models, which means the readme is judged as carefully as the demonstration.

## Preparation, 22 to 31 October

The build window is short enough that this week is part of the build rather than a warm-up.

**Accounts and keys.** Create a NEAR AI Cloud account, add credits, and generate an API key. Request a 1Click partner key, which lowers the platform fee on stablecoin pairs and is required for the off-chain signed intent endpoints. Create a WalletConnect project id, which the EVM wallet picker needs in order to show WalletConnect wallets alongside injected ones.

**The demonstration account.** Create a named NEAR account to receive prize money. You no longer need to fund it with gas for the product to work, because a user signs an intent rather than a transaction, but keep a small balance of a common token so that the demonstration has something to trade. Have an EVM wallet and a Solana wallet ready as well, so that the cross-chain route can be shown without a second onboarding session in the middle of a demonstration.

**Prove the chain works.** Send a self-transfer of a thousandth of a NEAR from the demonstration account through the application code. This exercises the RPC provider, the key handling, the signing, the finality wait, and the receipt inspection in a single step, and it will find most integration problems in an afternoon.

**Scaffold the application.** Create the Next.js project with Bun, install the pinned dependencies, set the engine requirement, and copy the the design system foundation from the repository rather than from the registry. Check that `bun run build` produces a Bun build rather than a silent Node one.

**Read the official agent skills.** Install them, because they are current and the documentation sites are not.

```bash
npx skills add near/agent-skills --skill near-intents --skill near-ai-cloud --skill near-dapp --skill near-api-js
```

**Write the readme skeleton.** Write it as a sequence of instructions a stranger could follow, because that is how an automated jury will read it. Include a section that lets a reader verify the claims independently.

**Decide the model.** Test tool calling on the real prompts against two or three candidates and pick one. Verify capabilities in the catalogue rather than assuming.

## Phase A, 1 to 4 November

The spine, and the first thing that could be submitted on its own.

Wallet connection for EVM, Solana, and NEAR behind one adapter, with the chain picker that decides which wallet list to show. Sign-in with a thirty-two byte nonce, signed in whatever standard the user's chain uses and verified server-side, producing a session that every other route requires. The challenge is bound to the chain, so a signature captured on one chain cannot be replayed on another.

The chat route against NEAR AI Cloud, with streaming into the transcript and the tool registry in place. The read-only tools come first: balances, supported assets, quote, transaction status, transaction history.

The approval flow, using the SDK's tool approval with a secret that lets the server verify that it issued the approval. The quote card, the approval card, and the transcript rendering of tool parts.

Persistence of conversations and messages to Postgres through the connection pooler.

## Phase B, 5 to 8 November

The money path.

The settlement service, with the quote, the signed intent, and the status polling. The user signs one message, in their own chain's format, and the trade settles inside the verifier contract. No gas, no account creation, and no on-chain transaction from the user.

The swap lifecycle as a durable workflow. The route that handles the approval starts it, and the workflow owns the submission, the polling, and the reconciliation, with a sleep between status checks that costs nothing. This replaces the scheduled poller entirely.

Asset resolution by chain, so the application knows which of the three USDC contracts the account holds and which route works for it.

The transaction timeline, the balance list, the fee breakdown, and the risk badge.

## Phase C, 9 to 11 November

The part that makes the project worth more than a wallet demonstration.

The agent key, created as a function-call key scoped to a single method on the verifier contract, and registered with the verifier so that it can sign intents. The policy engine with a per-transaction cap, a daily cap, an asset allowlist, a destination allowlist, and an expiry. The limits panel showing the remaining allowance and the ledger balance, with a button that revokes the key on-chain.

The agent executing within its limits without a per-transaction prompt, and stopping to ask when a request would exceed them.

The cross-chain route through Intents, so that a user holding USDC on another chain can bring it to NEAR through the same interface.

**Limit orders and perpetuals come last, and only if the schedule allows.** Both are already on the same API as the swap, so neither is a new integration, and both reuse the quote card and the approval card with different inputs. A limit order is a quote plus a price and a side, and the order endpoint answers with a fill status rather than a settlement status, so the timeline needs one more state. A perpetual position routes through the same quote endpoint against a different asset, with a flat fee on the way in and a minimum deposit of half a USDC. Neither is worth building before the swap path is solid, because a swap that works is worth more to a jury than a swap that does not.

If the schedule allows, the chat moves to the durable agent with resumable streams, so that a user who refreshes mid-answer reconnects to the same stream rather than losing it. This is the last thing added rather than the first, because it is an improvement to something that already works rather than a missing capability.

## Phase D, 12 to 13 November

Hardening and the demonstration.

Test the refresh, the disconnection, the duplicated submission, the timeout, and the ambiguous submission. The durable workflow absorbs most of the refresh and disconnection cases, so what remains to test is the boundary between the chat and the transaction record.

Add error monitoring, rate limits, redaction, and the ownership checks on every read.

Write the readme properly, with the verification section and the instructions a stranger can follow.

Record the demonstration. Record it early and record it again if the product improves, because a recorded demonstration that does not match the build is worse than no demonstration.

## Submission, 14 November

The repository has to be public, because the jury cannot open a private one.

The demonstration post has to be on X, with the video or the screenshots attached, and it has to say the project was built at the hackathon.

The submission form takes the project name, the team lead's name, the contact email, the team size, the track ids, a mainnet NEAR account for the prize, the repository link, the demonstration link, and a description of between twenty and two thousand characters.

There is one attempt. A duplicate project name or a duplicate email is rejected outright, so read the payload before sending it, and send it once the repository is public and the post is live.

## Track selection

Submit against `privacy`, `security`, and `agents`, and add `defi` if the work supports it.

The privacy track covers confidential computation and private AI, which is what the NEAR AI Cloud provider delivers. The security track covers spending limits, policy engines, sandboxed wallets, and attestation, which is what the agent key and the policy panel deliver. The agent economy track covers agents that spend and pay through NEAR Intents, which is what the swap service delivers.

## What to cut, in order

If the schedule slips, these go first, in this order.

**Limit orders and perpetuals.** They are extra surface area on a path that already works, and a swap that works is worth more to a jury than a swap that does not.

**The Solana adapter.** EVM and NEAR cover most of the audience, and the third adapter is the one that is most likely to have a wallet library behaving unexpectedly.

**The chat history.** A single conversation demonstrates the product as well as a history does.

**The insight cards and the portfolio chart.** A balance list carries the same information.

**The cross-chain route.** The same-chain route already demonstrates the money path.

**The durable agent.** The project is then a chat interface over NEAR AI Cloud that moves money with human approval, which is still worth submitting but will not win.

Never cut the approval flow, the server-side validation, or the settlement read. Those are the parts that make it safe, and they are the parts a jury is checking for.

## Costs

| Item | Estimate |
|---|---|
| NEAR AI Cloud | Twenty-five to fifty dollars of credits, more if the demonstration model is the strong one |
| Vercel | Free tier to begin with, then the first paid plan |
| Supabase | Free tier, with the project un-paused before the demonstration |
| 1Click | A twenty-five basis point platform fee without a partner key, and one basis point with one |
| Mainnet gas | A few NEAR across the demonstration account and the storage deposits |
| Domain | Optional, and only if a stable address matters more than the budget |

Set a spending cap on the NEAR AI Cloud dashboard before the demonstration, because a runaway tool loop is expensive and the SDK's step bound is the first line of defence rather than the last.
