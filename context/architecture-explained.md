# The architecture, explained plainly

This document is for reading without any blockchain or AI background. The technical version lives in `architecture.md` and `build-playbook.md`; this one exists so you can understand the shape of the product and open any file knowing what it is for.

---

## The whole idea in one paragraph

Myntle is an assistant you talk to about your money. You connect a wallet you already have, you ask it to do something like "swap 100 USDC for NEAR", and it shows you exactly what it is about to do before it does it. You approve it, your wallet signs it, and then the application watches until it can tell you what actually happened. The assistant never touches your keys and never holds your money.

You do not need a NEAR account, and you do not need to pay for gas. The wallet you already have is enough.

---

## The cast of characters

Imagine Myntle is a butler working in a house with a safe in the study.

| Character | What it is in the real product | Which technology |
|---|---|---|
| **You** | The person who owns the money | A browser |
| **Your wallet** | The safe, and the only key that opens it. Could be MetaMask, Phantom, or MyNearWallet | `wagmi` for EVM, the Solana wallet adapter, `near-connect` for NEAR |
| **The assistant** | The butler. Reads your balances, works out prices, writes a plan. Cannot open the safe | NEAR AI Cloud, reached through the Vercel AI SDK |
| **The settlement desk** | The office that actually carries out the trade, on any chain, once you approve it | NEAR Intents |
| **The clerk** | The person who keeps working on your trade while you have the app closed | A durable workflow on Vercel |
| **The court record** | The public ledger of what actually happened | The NEAR blockchain |
| **The notebook** | Where everything that happened is written down | Supabase Postgres |
| **The floor plan** | The design system the screens are built from | The design system we took as the starting point, plus components we write ourselves |

---

## Why it works with any wallet

This is the part that makes the product usable by anyone.

Most blockchain applications need you to have an account on their particular chain, funded with that chain's gas, before you can do anything. Myntle does not, because the trades settle through a system that already knows how to work across chains.

When you connect MetaMask, the application asks you to sign a message. Not a transaction, and not a payment, just a message saying "I approve this trade". That message is what authorises the trade to happen. The settlement desk then does the rest, and the money arrives in whatever form you asked for, on whatever chain you asked for.

The same thing happens if you connect Phantom, or a NEAR wallet. The only difference is the format the message takes, and there are three small adapter files that handle that.

**The payoff is simple.** A judge at a hackathon can connect the wallet already in their browser and use the product in under a minute. There is no faucet, no account creation, and no waiting.

---

## The one thing that makes this different from a chatbot

A normal chatbot can tell you it did something. Myntle cannot.

The butler may propose anything, but the settlement desk executes it, and the court record says what really happened. If the butler says "I swapped your USDC", and the record says the trade failed, the screen shows a failure, not a success.

That rule — the record decides the outcome, not the assistant — is the spine of the whole design, and you will see it repeated in every file.

---

## What happens when you type "swap 100 USDC for NEAR"

### Step 1 — you ask

You type into a chat box and press send.

**Where it happens:** `app/api/chat/route.ts`
**What runs:** Next.js, on Vercel

Your message goes to the server, not directly to the model. That matters for one reason: the model never receives your wallet, because your wallet is not on the server either. It stays in your browser.

### Step 2 — the butler thinks out loud

The server asks the assistant for a response, and the assistant starts talking back. You watch the words arrive as they are written, because the assistant writes into the page as it goes.

**Where it happens:** the same route, plus `lib/ai/provider.ts`
**What runs:** NEAR AI Cloud, which is an OpenAI-compatible service

The model is not special by virtue of being clever. What is special is where it runs: inside a confidential virtual machine, on hardware whose identity can be checked. Your balances are read in there and go nowhere else.

### Step 3 — the butler goes and looks things up

The assistant needs real numbers, so it asks for them. These are the "tools". Each one does a single job and returns a small amount of information.

| The butler asks for | What it actually does |
|---|---|
| "What have I got?" | Reads your balances and values them using a live price list |
| "What can I trade?" | Works out which routes work for the tokens you actually hold |
| "What would I get?" | Asks the settlement desk for a price, including the minimum you'll receive, the fee, and how long the price holds |
| "Did my trade go through?" | Checks the authoritative source for that particular trade |

**Where it happens:** `lib/ai/tools/`

Each of these is read-only. None of them moves money.

### Step 4 — the plan appears

The assistant decides it wants to propose a swap, and something that looks like a quote appears in the conversation.

It shows the amount going out, the amount coming back, the *minimum* amount you are guaranteed, the rate, the fee, and a countdown of how long that price is held for.

**Where it happens:** `components/finance/SwapQuoteCard.tsx`

The minimum amount and the fee are on there because those are the two numbers that decide whether you should approve. Everything else is either obvious or decoration, and decoration gets removed.

### Step 5 — you approve

The quote turns into a question with two buttons. Nothing happens until you press one.

**Where it happens:** `components/finance/TxApprovalCard.tsx`

You might close the tab here and come back tomorrow. The approval is still waiting for you, because it was recorded server-side before you were shown it.

### Step 6 — your wallet signs

Your wallet pops open and asks you to sign a message. This is the real moment of authorisation, and it happens in your wallet, not in our application.

**Where it happens:** your browser, through `lib/wallet/`

Three different wallets, three different message formats, one interface the rest of the application talks to. The format matters, and it is the kind of detail that is easy to get subtly wrong, so each format has its own file with its own verification.

The application is careful about what it shows you here. The thing you sign must be the same thing the application intends to execute, so the parameters are recomputed on the server from its own stored record rather than taken from whatever the browser sends back. A modified browser cannot talk the server into signing something else.

### Step 7 — the clerk takes over

Now the application hands the job to a background process that will keep working even if you close the tab, even if the server restarts, even if a new version of the application is deployed while it is running.

**Where it happens:** `workflows/swap-lifecycle.ts`
**What runs:** the Workflow SDK on Vercel

The clerk's job is simple and boring, which is the point. It submits the trade, waits, checks whether it worked, waits again, and keeps going until it has a definite answer. When it waits, it costs nothing and holds nothing open.

### Step 8 — the truth comes out

Two possible endings.

Either the record confirms the trade, and the screen shows the amount that actually arrived. Or it does not, and the screen shows a failure, with the reason and what happens to your money.

**Where it happens:** `components/finance/TxStatusTimeline.tsx`, reading from the transaction record

A detail worth knowing: a successful deposit is not a successful trade. If your funds arrive but the trade is never filled, your money comes back to you. The screen tells you that, rather than showing a green tick for a step that is not the whole story.

---

## What happens if something goes wrong

These are the four ways things break, and what each one does about it.

**You refresh the page mid-answer.** The conversation and the trade are both stored in the database, so the page reloads into the same state. The trade keeps running in the background either way.

**Your connection drops while the assistant is talking.** The application reconnects to the same stream and carries on from where it left off, rather than starting over.

**The network is flaky while the trade is running.** The clerk retries, because a failed status check is not the same thing as a failed trade. But if the trade genuinely failed on-chain, that is recorded as final and is not retried.

**The deployment changes while a trade is running.** The running trade stays on the version of the code it started with, because resuming a decision into different code is how approvals go wrong. If a bug needs fixing, the running trade is cancelled and restarted on the new code.

---

## The folders, one at a time

### `app/` — the screens and the doors

This is the part people see, plus the doorways the browser talks to.

```
app/
├── layout.tsx              wraps the whole app, sets up the wallet providers
├── page.tsx                the chat screen
├── globals.css             the design foundation (tokens, colours, spacing)
│
├── api/
│   ├── chat/route.ts       THE DOOR FOR CONVERSATIONS. The model, the tools,
│   │                       and the approval rules all live here.
│   ├── approve/route.ts    THE DOOR FOR SPENDING. Starts the background job
│   │                       that does the actual trade.
│   ├── tx/[id]/route.ts    reads the state of one trade
│   ├── auth/               signing in, per chain
│   ├── wallet/             balances, available assets, session
│   └── agent/              the agent's key, its limits, and revoking it
│
└── .well-known/workflow/   generated at build time, do not edit
```

Every folder under `api/` is a **door**. The browser may knock on some of them. The one that moves money is `approve`, and it does not open without a signature you produced.

### `lib/ai/` — the brain

```
lib/ai/
├── provider.ts     points at NEAR AI Cloud and lists the models
├── prompts.ts      the standing instructions the assistant follows
└── tools/          one file per tool, each doing exactly one thing
```

The `tools/` folder is where the boundary between *reading* and *acting* lives. Five of the six tools only read. The sixth proposes. None of them can sign anything, and none of them can see your wallet.

### `lib/wallet/` — talking to the user's wallet

```
lib/wallet/
├── types.ts      the one interface all three wallets answer to
├── registry.ts   picks the right one
├── evm.ts        MetaMask and friends
├── solana.ts     Phantom and friends
├── near.ts       MyNearWallet and friends
└── intent.ts     builds and signs the message each chain expects
```

This folder is the reason the product works for everyone rather than only for people who already use NEAR.

### `lib/intents/` — the settlement desk

```
lib/intents/
├── service.ts    quotes, submits, and tracks trades
├── assets.ts     the catalogue of what can be traded, with live prices
├── orders.ts     limit orders
├── hyperliquid.ts perps
└── types.ts
```

### `lib/near/` — talking to NEAR directly

```
lib/near/
├── contracts.ts  the exact contract addresses, and the exact token ids
├── rpc.ts        how we reach a node and ask it questions
├── receipts.ts   reading whether something really worked
└── nep413.ts     the message format NEAR wallets use
```

`contracts.ts` is the file to be careful with. There is no `usdc.near` on this chain, and there are three different real USDC contracts that hold different balances. Everything in the application refers to tokens by their chain and their full contract id, because the short names genuinely lie.

### `lib/auth/` — proving you are you

```
lib/auth/
├── session.ts    checking who is signed in
├── challenge.ts  issuing a one-time random number
└── verify.ts     checking the signature, per chain
```

Connecting a wallet tells us an address. It does not prove the person is you, so the application asks the wallet to sign a random message and checks the signature before creating a session. The message is bound to the chain, so a signature captured on one chain cannot be replayed on another.

### `lib/db/` — the notebook

```
lib/db/
├── schema.ts    what the tables look like
├── queries.ts   how we read and write them
└── client.ts    the connection
```

The database is never reached from the browser. Everything goes through the server, where the ownership check happens. Every table is keyed by an internal id, and every address sits next to the chain it belongs to, because the same wallet on two chains is two different accounts.

### `workflows/` — the clerk

```
workflows/
└── swap-lifecycle.ts    the one background job: submit, wait, check, repeat
```

This is the only file in the project that runs on its own schedule. It holds no state of its own; everything it knows is written to the notebook as it goes.

### `components/` — the screens

```
components/
├── primitives/   The design system's building blocks, unmodified
├── atoms/        The design system's small pieces
├── finance/      OURS. The money-specific screens.
└── app/          OURS. The shell, the sidebar, the transcript.
```

The `finance/` folder holds the components the design system does not have, because the design system is a general-purpose kit and this is a specific product. Everything there is built on the same foundation, so it all looks like one thing.

### `context/` — the notes

The documents that explain the decisions, the traps, and the plan. Read `architecture-explained.md` (this file) first, then `roadmap.md` to see the schedule, then the others as you need them.

---

## The words you will keep seeing

| The word | What it means |
|---|---|
| **contract** | A program living on a blockchain with an address. You call it by name, like a function |
| **token** | A digital asset. USDC and NEAR are both tokens |
| **chain** | Which blockchain an asset or a wallet lives on. The same ticker can mean different contracts on different chains |
| **wallet** | The software holding your key. The key never leaves it |
| **sign** | Using your key to authorise something. The wallet asks you first, every time |
| **intent** | A signed statement of what outcome you want. It is the thing that authorises a trade |
| **settlement** | The actual moving of the money, as opposed to the agreement to do it |
| **quote** | A price, with an expiry. It is not a promise |
| **revert** | Something that failed. The money does not move and you get it back |
| **RPC** | The way the application asks a blockchain node questions |
| **receipt** | The record of what actually happened when something ran on chain |
| **finality** | The point after which a result cannot be reversed |
| **slippage** | How much worse the price can get between agreeing and executing |
| **TEE** | A confidential virtual machine. The code and data inside are encrypted and the hardware can be proven genuine |

---

## The two rules the interface follows

Both are written out in full in `AGENTS.md`, and both come from the same place: a user about to authorise a spend should not have to parse decoration.

**No staccato.** Headlines and marketing copy are written as complete sentences, not as fragments. "Fast. Scalable. Decentralized." is the sound of marketing, and this product should not sound like marketing.

**Less is more.** Nothing is on screen unless it helps the user decide. No tag above a heading that says nothing the heading did not already say. No badge that carries no state. If removing an element loses the user nothing they need, it goes.

---

## Where to start reading the code

If you want to follow one action through the whole product, this is the path:

```
lib/ai/tools/get-quote.ts        the assistant asks for a price
  → lib/intents/service.ts        the settlement desk is asked
    → lib/intents/assets.ts       the catalogue and the live prices
```

And for the money path:

```
components/finance/TxApprovalCard.tsx    what you approve
  → app/api/approve/route.ts              the door that starts the work
    → workflows/swap-lifecycle.ts          the clerk doing the work
      → lib/wallet/intent.ts               how your chain signs
        → lib/intents/service.ts           the trade is submitted
```
