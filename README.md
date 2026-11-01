<img src="public/myntle-logo.svg" alt="Myntle logo" width="72" />

# Myntle

Myntle is a chat-first finance application where you connect the wallet you already have, ask for a trade in plain language, approve exactly what you see, and watch what actually happened.

## Overview

Myntle is for someone who already holds tokens and already has a wallet. You do not need to learn how the underlying networks work in order to ask for a trade, approve one, or read its outcome, and every technical detail stays available if you want it.

You connect an EVM wallet, a Solana wallet, or a NEAR wallet, and the same conversation works for all of them. You do not need a new account, you do not need gas on a new network, and you do not need a faucet. You type something like swapping a hundred USDC for NEAR, you see the quote before anything happens, you approve it once in your wallet, and the application follows the settlement until it can tell you what actually occurred.

Safety in Myntle comes from keeping the assistant away from money. The assistant can only propose a trade and look up information, and it never sees your wallet, your address, or your signature. The application checks every amount and asset against your connected account, builds the transaction from its own records rather than from anything the assistant wrote, and treats a trade as finished only when the settlement record says so. A signature, a network response, or a sentence from the assistant is never treated as proof that money moved.

## Installation

You need Bun 1.4.3 and Node 22 or newer. Bun manages packages and runs the local server, and Node is what runs the production build.

```bash
bun install
cp .env.example .env.local
bun run dev
```

Fill in `.env.local` before you expect trades to work. The secrets are the NEAR AI Cloud key, the 1Click partner key, the WalletConnect project id, the Supabase service role key, and the approval secret. The contract addresses and RPC URLs are configuration rather than secrets. Never commit the filled-in file.

```bash
bun run build      # production build
bun run typecheck  # TypeScript checks
bun run lint       # lint checks
bun run test       # test suite, which runs on Node
bunx workflow web  # inspector for the swap workflow
```

The project uses `"type": "module"` because the AI SDK is ESM only, and it pins React to 19.2 so the dependency range stays inside what the chat library supports.

## Features

You can trade by writing a sentence. You ask for a swap the way you would explain it to a person, and the assistant turns that into a concrete quote instead of guessing around a failure.

You can bring any of the three supported wallets. EVM wallets connect through wagmi and viem, Solana wallets connect through the Wallet Standard, and NEAR wallets connect through near-connect, and all three sit behind one interface so the conversation does not change with the wallet.

You always see the trade before you sign it. The quote shows what you would receive and the least you would accept, and the approval shows where the funds go, what the fee is, and when the quote expires. The approval is bound to those exact parameters, so what you sign is what you saw.

You can follow the trade after you approve it. The timeline is driven by the transaction record rather than by the conversation, so it moves through quoted, approved, submitted, and settled only as the settlement source confirms each step. When funds arrive but the trade is never filled, the screen says the money is coming back instead of showing a success for part of the story.

You keep your keys. The application holds no private keys and no funds, sign-in uses a single-use message bound to your address, chain, and expiry, and every movement of money in this release waits for a person to approve it.

## Architecture

The conversation runs in the browser, the assistant runs on the server, and settlement is read from the record of what happened rather than from what the assistant said.

```
Browser ──▶ /api/chat ──▶ NEAR AI Cloud, which proposes trades and looks things up
   │
   ├──▶ /api/approve ──▶ builds the transaction and asks your wallet to sign once
   │         │
   │         └──▶ swap workflow ──▶ submits, waits, checks, and reconciles
   │
   └──▶ /api/tx/[id] ──▶ Postgres record of the conversation and the transaction
```

The interface is a Next.js application that renders the conversation, the quote card, the approval card, and the transaction timeline. The chat route owns the model, the tool registry, and the approval policy, and it never sees a wallet. The registry has six tools, where five only read balances, assets, quotes, and status, and one proposes a swap and always asks for your approval first. The approval route validates the request against your connected account and starts a durable workflow that submits the trade, sleeps between checks, and records the outcome in Supabase Postgres. Amounts always carry their chain and contract identity, and an address is always read together with its chain, because the same ticker on two chains is a different asset and the same wallet on two chains is a different account.

The key paths are `app/api/chat/route.ts` for the assistant, `app/api/approve/route.ts` for approval, `workflows/swap-lifecycle.ts` for the durable swap lifecycle, `lib/intents/service.ts` for quotes and status, `lib/wallet/` for the three wallet adapters, and `lib/db/` for the conversation and transaction records.

## Contribution

Start from the documentation set in `context/` if it is present, and from `PRODUCT.md` and `AGENTS.md` in any case, because several early assumptions were overturned during research and the corrections live there.

Prototype interface work in the lab before building it into the product. Create a component in `components/lab/samples/` that takes an optional variant, register it in `components/lab/registry.ts`, iterate at `/lab`, and move the finished version into `components/finance/`. Nothing in the application imports from the lab, so a prototype cannot break anything that ships.

Keep tools narrow and keep the assistant away from money. Each tool does one job, only the swap tool changes anything, and no new signing or network tool may be added. Model output never reaches a signature without passing through server validation, approvals stay cryptographically checked, and every agent call sets an explicit step bound.

Do not commit secrets, do not sign a mainnet transaction or spend funds without an explicit instruction from the person in charge, and write interface copy as sentences a person could say out loud. If a line of text can be deleted without losing meaning, delete it, and keep numbers on screen to the ones the reader needs in order to decide.

## Credits

The interface foundation comes from BeautifulUI. The primitives in `components/atoms/` and `components/primitives/`, the harness in `components/site/Harness.tsx` that this application drives with the live assistant, and the design tokens the finance screens build on are adapted from that system, and the finance screens themselves were built for this project.
