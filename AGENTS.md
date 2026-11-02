# AGENTS.md

Guidance for any agent or contributor working in this repository.

## What this is

Myntle is a chat-first finance application. A user connects a wallet they already have, talks to an AI assistant in natural language, approves the transactions it proposes, and watches the real settlement resolve. The assistant runs on NEAR AI Cloud, the trades settle through NEAR Intents, and the application never holds a user's keys or funds.

The product is multi-chain from the first release. The user may connect an EVM wallet, a Solana wallet, or a NEAR wallet, and the same conversation works for all of them, because every one of them can sign the intent that settles a trade. A user needs no NEAR account, no gas, and no faucet.

The product thesis is that an AI agent handling money should be verifiable at every layer: the model is identified, the quote is explicit, the approval is bound to concrete parameters, and the settlement is read from the record of what actually happened rather than asserted by the assistant.

## Confidential-only thesis

We expose only the confidential part of NEAR Intents. Users never see public versus private, never manage the distinction, and never move funds between public and confidential balances themselves.

Concretely: foreign-to-foreign flows always send `confidentiality: basic` or `advanced`, and embedded NEAR-account flows always use `INTENTS` balance types as `CONFIDENTIAL_INTENTS` with signed-intent execution (`generate-intent → sign → submit-intent`) plus User-Session auth (`POST /v0/auth/authenticate`). There is no public toggle in the product. The working plan is in `plans/confidential-intents.md` (gitignored working notes; re-derive from the `near-intents` skill + `docs.near-intents.org` if missing).

## Stack

Pinned versions, because the current major releases moved recently and several APIs were removed rather than deprecated.

| Layer | Choice | Version |
|---|---|---|
| Package manager | Bun | 1.4.3 |
| Framework | Next.js (App Router) | 16.4.x |
| UI | React | 19.2.x |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | 4.x |
| Components | BeautifulUI primitives + our own | — |
| Icons | `@tabler/icons-react` | 3.49.x |
| AI SDK | `ai` | 7.x |
| AI provider | `@ai-sdk/openai-compatible` → NEAR AI Cloud | 3.x |
| Durable workflows | `workflow` (Workflow SDK, Vercel World) | 5.2.x |
| Durable agent | `@ai-sdk/workflow` | 2.x |
| Validation | `zod` | 4.x |
| EVM wallets | `wagmi` and `viem` | 2.19.x / 2.57.x |
| Solana wallets | `@solana/wallet-standard` + `@wallet-standard/app` | 1.1.8 |
| NEAR wallets | `@hot-labs/near-connect` + `near-connect-hooks` | 0.11.x / 1.1.x |
| Server state | `@tanstack/react-query` | 5.x |
| Design foundation | `shadow-plugin` | 2.1.x |
| On-chain (NEAR only) | `near-api-js` | 7.3.x |
| Database | Supabase Postgres | — |
| Hosting | Vercel | — |

Node 22 or newer is required. `ai@7` declares `engines.node >= 22` and is ESM only, so the project uses `"type": "module"`.

**Bun is the package manager and the local runtime. Node is the production runtime on Vercel.** Bun is an officially verified Next.js adapter, and the whole stack was built and run under Bun 1.4.3 to confirm it: the install is clean, the build compiles the workflows, the page renders, and a durable workflow made real calls to the settlement API and completed.

**It is not the Vercel runtime yet**, because an open Bun defect causes Next 16.4 to log false client-hook errors during a build, and the fix is not shipped. The reasoning is in `context/durability.md`.

Five version notes worth remembering, and every one of them was found by installing rather than by reading.

`@ai-sdk/react@4` declares a peer of `react: ^18 || ~19.0.1 || ~19.1.2 || ~19.2.1`, which excludes React 19.3, so React is pinned to `~19.2.9` with a tilde rather than a caret. A caret would let 19.3 in.

`near-api-js@7` removed the v5 surface entirely, so `connect(keyStores, …)`, `connection.signAndSendTransaction`, `Action.functionCall`, `InMemorySigner`, and the bundled keystores no longer exist.

`workflow@5.2.3` or newer is required for Next 16.1 and later, because the build fails otherwise looking for a module that has moved.

The whole `@solana/wallet-adapter` 0.19 line has been withdrawn from npm, and the version 3 replacement wants React 19.3, so Solana uses the Wallet Standard instead. The details are in `context/wallets.md`.

`shadow-plugin` has to be installed even though the BeautifulUI registry does not declare it, because the design foundation imports it and an unresolvable import in a stylesheet makes Turbopack fail with a panic rather than a readable error.

Bun 1.4 was a complete rewrite from Zig to Rust with breaking changes, so the version is pinned in `.bun-version` rather than left as a range.

## Commands

```bash
bun install                  # install, or restore from bun.lock
bun add <pkg>                 # add a dependency
bun add -d <pkg>              # add a dev dependency
bun run dev                   # Next dev server on Bun
bun run build                 # production build on Bun
bun run lint
bun run typecheck
bun run test                  # Vitest, which runs on Node
bunx workflow web             # the workflow inspector
```

**Do not set `"packageManager": "bun@…"` in package.json.** Corepack does not support Bun, and Vercel reads that field through Corepack, so it fails the build before anything else runs. Vercel detects the `bun.lock` file and installs with Bun on its own.

**Bun does not enforce `engines`.** The Node version guard in `package.json` is silently ignored under Bun, so CI checks the version explicitly rather than relying on it.

## Architecture

Four layers, each replaceable without touching the others.

**Presentation** is a Next.js App Router client application. It renders the conversation, the tool activity, the quote card, the approval card, and the transaction timeline.

**Intelligence** is a single route handler at `app/api/chat/route.ts` that calls NEAR AI Cloud through the Vercel AI SDK. It owns the system instructions, the tool registry, and the approval policy. It never sees a wallet, an address, or a signature.

**Authorization and execution** is deterministic application code. The model may only request an intent; the server validates it against an allowlist, renders an approval card bound to the exact parameters, and the connected wallet signs. The application constructs the transaction from trusted inputs rather than from anything the model produced.

**Durability and verification** is Supabase Postgres for conversation and transaction records, plus a durable workflow that reconciles each submitted operation against the authoritative source, which is the 1Click status endpoint reporting the settlement inside the verifier contract.

```
Browser ──▶ /api/chat ──▶ NEAR AI Cloud  (model + tool calls only)
   │             │
   │             └──▶ tools: balances · assets · quote · status   (read-only)
   │
   ├──▶ /api/approve ──▶ IntentService ──▶ NEAR Intents  (settles on chain)
   │         │
   │         └──▶ start(swapLifecycle) ──▶ durable workflow
   │                                          │
   │                                          ├── submit · poll · reconcile
   │                                          └── sleep() between checks
   │
   └──▶ /api/tx/[id] ──▶ Postgres + transaction record
```

## Key paths

```
app/
  api/chat/route.ts              AI route: model, tools, approval policy
  api/approve/route.ts           approval → starts the swap workflow
  api/tx/[id]/route.ts           transaction record + status
  api/auth/                      chain challenge, verification, session
  api/agent/                     agent key, policy, revocation
  layout.tsx                     the frame
  providers.tsx                  the wallet providers
  providers-loader.tsx           loads them without server rendering
  page.tsx                       the chat screen, driving the harness
  globals.css                    the design foundation
workflows/
  swap-lifecycle.ts              durable execution, polling, reconciliation
lib/
  ai/provider.ts                 NEAR AI Cloud, and the model list
  ai/prompts.ts                  system instructions
  ai/tools.ts                    the tool registry
  intents/service.ts             quotes, status, the asset catalogue
  wallet/                        the multi-chain wallet adapters
  near/                          NEAR contracts, rpc, receipts, nep413
  auth/                          session, challenge, verify
  db/                            schema, queries, migrations
  utils.ts                       the class name helper the primitives import
components/
  atoms/                         BeautifulUI, copied
  primitives/                    BeautifulUI, copied
  site/                          BeautifulUI's harness, copied and adapted
  lab/                           OURS — the prototyping workspace, isolated
  finance/                       OURS — the money screens
  app/                           OURS — the live response and the wallet button
context/                         the documentation set (see below)
```

**The harness is the interface.** `components/site/Harness.tsx` is BeautifulUI's own chat application, taken whole, and it is what the user sees. It takes an optional `live` prop; without one it runs the upstream demo, and with one it runs the real assistant. Do not reimplement the layout in `app/`. `app/page.tsx` wires the assistant to the harness and nothing else.

**The lab is a scratchpad, not part of the product.** See *Building new components* below.

## Building new components

Prototype in the lab, build in the product.

`/lab` renders whatever is in `components/lab/samples/`. Nothing in the application imports it, so a prototype cannot break anything that ships.

1. Create `components/lab/samples/YourThing.tsx`, default-exporting a component that takes `{ variant?: string }`.
2. Add one line to `components/lab/registry.ts` with its id, title, caption, file name and variants.
3. Iterate at `/lab`, then use **Show the code** and copy the markup you are happy with.
4. Move the finished component to `components/finance/` and delete the sample.

Never build a component in the lab. The lab is where a component is decided.

## Conventions

**Tools are narrow.** Each tool has one job and a zod schema. Read-only tools (`get_balances`, `get_supported_assets`, `get_quote`, `get_transaction_status`, `get_transaction_history`) run server-side without approval. Exactly one tool mutates state (`prepare_swap`), and it is configured with `toolApproval: { prepare_swap: 'user-approval' }`. There is no generic signing tool and no generic RPC tool, and neither may be added.

**News tools page, never trim.** `get_google_news`, `get_reddit_posts`, `get_x_posts`, and `get_x_user_posts` fetch the full result set once per turn into the per-turn block cache (`lib/news/block-cache.ts`), then serve it back in ~6k-char / ≤10-item blocks via `searchId + block`. Never `slice` an API response down to the display limit and discard the rest: the fetch is already paid for, the model can page with `searchId + block` (X also has `nextPage` via cursor), and refetching the same query returns the same first page. Field truncation follows the same rule — keep the full post text the API returns (X posts up to 2000 chars) rather than squeezing it into a 180-char title, so the model never needs another call to recover what we cut.

**The model never sees a wallet.** No tool returns an address, and no tool signs. The assistant proposes a trade as two assets and an amount, and the application decides what to do with that. The wallet belongs to the interface layer.

**Approvals are cryptographically checked.** The client sends the whole conversation on every turn, so a modified client could fabricate an approval response. Any tool that moves money sets `experimental_toolApprovalSecret` on the `streamText` call so the server verifies that it issued the approval. Do not remove this.

**Multi-step tool loops need an explicit bound.** `stopWhen` defaults to `isStepCount(1)` in `streamText`, which silently ends an agent after one tool round. `WorkflowAgent` has the opposite default and applies no limit at all. Every agent call sets `stopWhen: isStepCount(N)` explicitly.

**I/O belongs in steps.** A workflow function is replayed from an event log, so it must be deterministic and cannot touch Node.js modules. Anything that calls the wallet libraries, the AI SDK, Supabase, or the network goes inside a `'use step'` function.

**The model proposes, the application decides.** Amount, asset, destination, and slippage bounds are validated server-side against the user's connected account before anything is signed. Model output is never passed to a signature or a contract call without passing through that validation.

**Assets are addressed by chain and contract id.** The same ticker means different contracts on different chains, and there is no `usdc.near` on NEAR at all. Every asset reference carries its chain and its full contract id. Ticker strings never reach a signature or a contract call.

**Identity is chain plus address.** The account the verifier knows is derived from the public key, so the same wallet on two chains is two accounts with two sets of balances. Every address in the database sits next to its chain, and the two are always read together.

**The settlement decides the outcome.** A transaction is `settled` only when the authoritative source says so. A successful wallet signature, a successful HTTP response, or a sentence from the assistant are never sufficient evidence.

**Errors are masked at the boundary.** The default "An error occurred." message is kept. Custom errors are forwarded deliberately through `onError` in `toUIMessageStream`, never by accident.

**Retries distinguish failure from refusal.** A step that throws is retried. A step that throws `FatalError` is not. A failed status poll is retried; a settlement that failed on-chain is not. Note that `FatalError` is exported from the main `workflow` entry, not from `workflow/errors`.

**The wallet providers are client-only.** One of the wallet connectors reaches for `indexedDB` when it is evaluated, and the server has no such thing. The whole provider tree is loaded with `ssr: false` for that reason, and the wallet standard's registry is imported inside an effect for the same reason.

## Design rules

Two rules govern every line of interface copy, every component, and every page of this product. They come from the editorial discipline of Jakub Linowski's *Less is More*, and they exist because the financial layer of this application is where clarity matters most. A user deciding whether to approve a transaction must not have to parse decoration. The same two rules are recorded in `PRODUCT.md` under Brand Commitments, and that is the copy of record when the two disagree.

> **These two rules are mandatory, and they apply to every surface in this product: the landing page, the README, the chat screen, the quote card, the approval card, the empty state, the error message, and the label on every button.** They are not a matter of taste, and they are not to be traded away for a tighter layout or a better-looking screenshot. A user here authorises the movement of real money, and the interface is the only thing telling them what they are about to do, so decoration is never free; it is charged directly to the user's understanding. The short form of each rule below is what to hold in mind while writing, and the long form is what to consult when a call is close.

### The Anti-Staccato Rule

*Short version: every headline, sentence, and label reads as prose a person could say out loud. Staccato fragments and slogan triplets are forbidden, in marketing copy and in the product itself, because they read as machine-written filler rather than as an explanation of what the thing does. A headline earns its place by being a complete thought that says what the product is, and a feature list earns its place by being a paragraph someone could actually read aloud.*

Landing page and marketing copy must never use staccato, fragmented sentences or choppy slogan triplets (e.g. *"Fast. Scalable. Decentralized."* or *"Simple. Reliable. Built for Web3."*). This is artificial marketing cliché. Write calm, natural, continuous sentences that communicate complete thoughts with clarity and craft.

In practice this means a headline is a complete sentence that explains the product, not a three-word fragment. It means a feature list reads as prose that a person could say out loud. It means the README's opening paragraph explains what the thing does and who it is for, because that paragraph is what a judge reads first. It also applies inside the product: an empty state, an error message, and a button label are all interface copy, and none of them should read as a slogan.

### The Less-is-More Rule (Jakub Minimalist Standard)

*Short version: every element and every line of text must carry functional or informational value, and anything that can be deleted without losing meaning should be deleted. That rules out eyebrow labels above headings, tags that repeat the paragraph beneath them, helper text that restates the label of the input it sits under, and badges with no state, no count, and no status behind them. A number appears on screen only when the user needs it in order to decide, which means a quote shows the amount out and the minimum amount out, and an approval card shows the destination, the fee, and the deadline, and nothing else.*

Grounded in Jakub Linowski's *Less is More* editorial and interface discipline: eliminate gratuitous text, redundant explanations, padding, and floating eyebrow elements. Do not tack decorative micro-tags, chips, or taglines above headings just to decorate or fill negative space. Every line of text must carry essential functional or informational value. If an element or sentence can be removed without losing meaning, delete it.

In practice this means no eyebrow label above a heading, because a heading already says what it is. No tag that repeats what the paragraph below it says. No helper text that restates the label of the input it sits under. No decorative badges that carry no state, no count, and no status. When a number is on screen it is because the user needs it to make a decision, which means a quote shows the amount out and the minimum amount out, and an approval card shows the destination, the fee, and the deadline, and anything that is not needed to make that decision is left out.

**Why this matters here.** Every element in a swap flow is a potential distraction from the one number the user is actually deciding on. Removing decoration is not an aesthetic preference in this product; it is the difference between a user who understands what they are approving and a user who clicks through it.

**Before you commit anything that touches the interface, check five things.**

- Read the copy aloud. If it comes out as staccato or as a triplet, rewrite it as a sentence.
- Remove the elements that exist only to fill space: eyebrows, chips, decorative badges, and helper text that repeats the label above it.
- Confirm that every number on screen is one the user needs in order to decide, and that nothing else competes with it.
- Confirm that no tag or caption repeats what the line beneath it already says.
- Confirm that the empty state, the error message, and every button label read as something a person would actually say.

### The Two-Word Button Rule

A button label is at most two words. If a button needs more than two words to say what it does, the label is wrong, not the width.

A button is a decision, not a sentence. "Approve the swap" is already at the edge. "Confirm that you want to approve this swap" is a paragraph pretending to be a button, and it should be cut down or moved into the sentence above it.

If two words are not enough, the fix is a different label, not a smaller font. Shrinking the text to fit is the same mistake as stretching a button to fit the text: it puts the layout ahead of the decision, and the user pays for it with a button they have to squint at.

### The Font-Size Floor Rule

The text size on a button is never reduced to make a longer label fit a fixed width. If the label does not fit at the intended size, change the label, not the size.

This rule exists because the alternative is invisible to the person writing it. A button with eight-point text looks fine in a screenshot and is illegible on a phone, and the person who made it will not notice because they know what it says.

The order of preference when a label does not fit is: a shorter label, then a wider button, then a different button. A smaller font is not on the list.

### The Sourced-Design Rule

*Short version: never invent interface design on your own. Every animation, component, and style is either reused from what the product already renders or taken from an installed skill, and anything that fits neither is proposed to the person in charge before it is built.*

No motion, component, or style is designed from scratch in a working session. The product's own foundation comes first: the keyframes, easing tokens, radii, shadows, and primitives in `app/globals.css`, `components/atoms/`, and `components/primitives/`. Where the foundation has no answer, the installed skills do: Emil Kowalski's design engineering skill (`emil-design-eng`) for motion and interaction craft, Jakub Linowski's *Less is More* for copy and restraint. A new keyframe, a new easing curve, or a new component pattern that fits neither source is not committed directly; it is prototyped in the lab and proposed to the person in charge first.

## Context documents

Read these before changing anything. They contain verified facts, not opinions, and several of them contradict the original brief.

| File | What it holds |
|---|---|
| `context/architecture-explained.md` | **Start here.** The whole system in plain language, with no jargon assumed. |
| `context/wallets.md` | The multi-chain wallet layer: the three adapters, the identity model, and how an intent is signed. |
| `context/verification-report.md` | The research appendix. Every external claim with its source, including the findings that overturned parts of the brief. |
| `context/architecture.md` | How the system is put together and why, layer by layer. |
| `context/build-playbook.md` | Concrete setup and code: provider wiring, tool definitions, approval flow, wallet, swap engines. |
| `context/durability.md` | The durable workflow engine: where it runs, what it costs, how the swap lifecycle is wired, and the traps. |
| `context/components.md` | Which BeautifulUI primitives to reuse, which components we build, and the copy rules for each. |
| `context/near-notes.md` | NEAR mainnet reality: contracts, fees, RPC, the traps that will cost a demo. |
| `context/roadmap.md` | The prep week, the fourteen build days, and the submission checklist. |
| `context/decisions.md` | Decision log, with the reasoning and the conditions that would reverse each choice. |

## Development wallet

Before testing the wallet or auth flows, read `learnings/dev-wallet.md`. It covers the keyed provider that signs for real, how to switch accounts so the session rules can be exercised, and what it still cannot cover. The `learnings/` directory is gitignored, so a fresh clone will not have it.

## Ground rules for agents

Verify against the live API before trusting documentation. The NEAR Intents docs and the BeautifulUI registry have both drifted from reality in ways that cost real time, and `context/near-notes.md` exists because of it.

Do not commit secrets. Keys belong in environment variables. The NEAR AI Cloud key, the 1Click partner key, and the WalletConnect project id are secrets; the contract ids and RPC URLs are configuration.

Never sign a mainnet transaction, spend funds, or deploy a contract without an explicit instruction from the person in charge. The wallet approval flow exists so that a human authorises every movement of money, including during development.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
