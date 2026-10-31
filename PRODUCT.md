# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Myntle is for someone who already holds tokens and already has a wallet. That person is comfortable with crypto, but the application never assumes they know the mechanics behind it. Chain names, contract identifiers, decimal precision, and route internals stay available to anyone who wants them, and they are never a prerequisite for asking for a trade, approving one, or reading its outcome.

The wallet may live on any of three chains. The user connects an EVM wallet, a Solana wallet, or a NEAR wallet, and the same conversation works for all of them, because every one of them can sign the intent that settles a trade. No NEAR account, no gas, and no faucet are required at any point.

The second audience is whoever evaluates the product, most likely a judge or a reviewer who has a wallet and no patience. They connect the wallet already in their browser, ask for a trade in plain language, and watch it settle. If that takes more than a minute, the product has failed at the thing it exists to demonstrate.

## Product Purpose

Myntle is a chat-first finance application. The user connects a wallet they already have, asks for something like swapping a hundred USDC for NEAR, and sees exactly what the assistant is about to do before anything happens. They approve it, their wallet signs it once, and the application watches the real settlement until it can say what actually occurred.

The assistant proposes and the application decides. Every number that reaches the screen came from a tool call rather than from the model's imagination, every amount and asset is validated on the server against the connected account, and the parameters the user signs are recomputed on the server from its own stored record rather than accepted from the browser. A modified client cannot talk the server into moving money somewhere else.

The outcome is read, never asserted. A transaction is settled only when the authoritative settlement record says so. A successful signature, a successful HTTP response, or a sentence from the assistant are not evidence of anything.

A finished first release means one real swap on mainnet, end to end, from a connected wallet to a verified result on screen.

## Positioning

The assistant is structurally unable to do the dangerous thing. No tool returns an address, no tool signs, and there is no generic signing tool and no generic RPC tool, and neither may be added. A competitor can copy the chat, the streaming, and the cards, but not the property that the model's own account of what happened is never the evidence for what happened.

The second property is that any wallet works. A user signs a message rather than a transaction, and the trade settles inside the verifier contract, so a person with a browser wallet can trade without an account on our chain, without gas, and without a faucet. A product that asks for a NEAR account first cannot say that.

The third property is that the spending limit is honest about where it lives. The isolation, the revocation, and the expiry of an agent key are on-chain; the spending cap is enforced in application code. The readme has to say which is which, because describing a backend check as an on-chain limit would undermine every other claim in it.

## Operating Context

The application is a Next.js app deployed on Vercel, with Bun managing packages and the local runtime and Node running in production. The model runs on NEAR AI Cloud through an OpenAI-compatible interface, trades settle through NEAR Intents, conversations and transaction records live in Supabase Postgres, and the swap lifecycle runs as a durable workflow that survives a refresh, a dropped connection, and a redeploy.

Secrets are the NEAR AI Cloud key, the 1Click partner key, the WalletConnect project id, the Supabase service role key, and the tool approval secret. Contract identifiers and RPC URLs are configuration. Nothing signed for money, no funds spent, and no contract deployed happens without an explicit instruction from the person in charge, including during development.

The evaluation context is the NEAR Hackathon of 1 to 14 November 2026, submitted against the privacy, security, and agent tracks, with the defi track added if the work supports it. The jury includes language models, so the readme is judged as carefully as the demonstration. The repository must be public, the demonstration must be posted with the video or the screenshots attached, and there is exactly one submission attempt, so a duplicate project name or a duplicate email ends the entry.

The daily rituals around the build are a cost cap on the model provider's dashboard, a recorded demonstration that is re-recorded whenever the product improves, and a readme written as a sequence of instructions a stranger could follow.

## Capabilities and Constraints

What the product does, and the boundaries it must not cross.

**The wallet layer.** Three adapters behind one interface: EVM through wagmi and viem, Solana through the Wallet Standard, and NEAR through near-connect. The application holds no private keys, and a wallet address on its own is never treated as proof of ownership. Sign-in uses a single-use random nonce bound to the origin, the address, the chain, and an expiry, with the signature verified server-side and the nonce consumed.

**The assistant.** One route handler owns the model, the tool registry, and the approval policy. The registry is six tools: five that read, and one that proposes. Every call to the model sets an explicit step bound, because the framework default of one step ends the assistant after a single tool round and the failure is silent. A tool that fails is reported as a failed tool rather than guessed around.

**Approvals.** The one write tool is configured for user approval, and the stream call carries a server-held approval secret so that the server can verify it issued the approval it is being shown. The client resubmits the whole conversation on every turn, so a modified client could otherwise fabricate an approval, which is why the parameters are recomputed on the server from the stored quote and compared against what the user actually saw. An approval is bound to concrete parameters, a quote expiry, and a slippage bound.

**Execution.** The assistant never sees a wallet, an address, or a signature. Amount, asset, destination, and slippage are validated on the server against the connected account before anything is signed. The application constructs the transaction from trusted inputs rather than from anything the model produced. A human approves every transaction in the first release, and bounded autonomous execution arrives later as an additional mode rather than a replacement.

**Assets and identity.** Every asset reference carries its chain and its full contract identifier, because the same ticker means different contracts on different chains and there is no `usdc.near` on NEAR at all. Every address sits next to its chain, and identity is the pair: the same wallet on two chains is two accounts with two sets of balances, because the account the verifier knows is derived from the public key.

**Durability.** The swap lifecycle runs as a durable workflow that submits, sleeps, polls, and reconciles. The workflow holds no state of its own and writes everything to the database as it goes. A workflow that is already running stays on the code version it started with, because resuming a decision into different code is how approvals go wrong; a bug fix cancels the running trade and restarts it on the new code. A failed status poll is retried, and a settlement that failed on chain is recorded as final and is not retried. A successful deposit is not a successful trade: when funds arrive and the trade is never filled, the money comes back, and the screen has to say so rather than showing a green tick for one step of the story.

**The conversation is the product.** The first release is a conversation, a quote card, an approval card, and a transaction timeline. There is no portfolio page and no settings screen, because a second interface would compete with the first one for the time the money path needs.

**Undecided or out of scope for now.** Limit orders and perpetuals are on the same API as the swap and are the first things to be cut. The cross-chain route, the chat history, the insight cards, and the durable agent with resumable streams are all later than the swap path. Passkey and social sign-in, embedded wallets, and a mobile client are excluded from this release. The readme, the landing page, and the recorded demonstration are still to be written.

## Brand Commitments

The name is Myntle.

Two rules govern every line of interface copy, every component, and every page of this product: the landing page, the readme, the chat screen, the quote card, the approval card, the empty state, the error message, and the label on every button. They are not a matter of taste and they are not to be traded away for a tighter layout or a better-looking screenshot, because a user here authorises the movement of real money and the interface is the only thing telling them what they are about to do. Decoration is never free; it is charged directly to the user's understanding.

**The Anti-Staccato Rule.** Every headline, sentence, and label reads as prose a person could say out loud, and staccato fragments and slogan triplets are forbidden in the marketing copy and in the product itself, because they read as machine-written filler rather than as an explanation of what the thing does. A headline earns its place by being a complete thought that says what the product is, and a feature list earns its place by being a paragraph someone could actually read aloud.

**The Less-is-More Rule.** Every element and every line of text must carry functional or informational value, and anything that can be deleted without losing meaning should be deleted. That rules out eyebrow labels above headings, tags that repeat the paragraph beneath them, helper text that restates the label of the input it sits under, and badges with no state, no count, and no status behind them. A number appears on screen only when the user needs it in order to decide, which means a quote shows the amount out and the minimum amount out, and an approval card shows the destination, the fee, and the deadline, and nothing else.

The voice is plain and continuous. The assistant writes in short paragraphs, does not open by restating the question, does not close by summarising what it is about to do, and says plainly which tool failed and what it was trying to find out when something goes wrong.

The claims are constrained by the implementation. The application never holds a user's keys or funds, and any statement in the readme or the landing page that the build cannot back is a defect rather than a shortcut.

The visual world, the palette, the typography, and the component system are outside the scope of this record. They belong to the design system documentation, and the incumbent foundation is the design system we took as the starting point, with the finance screens built in-house.

## Evidence on Hand

The documentation set in `context/` is the strongest evidence in the project, and it holds verified facts rather than opinions. `context/verification-report.md` is the research appendix, where every external claim carries its source, including the findings that overturned parts of the original brief. `context/architecture-explained.md` explains the whole system in plain language for a reader without a blockchain background, and the remaining files cover the architecture, the build playbook, the durable workflow engine and its traps, the wallet layer, the component decisions, the NEAR mainnet reality, the roadmap, and the decision log with the conditions that would reverse each choice.

The running code is the second body of evidence. The chat route calls the real model on NEAR AI Cloud with the real tool registry, the approval policy, and the explicit step bound. The settlement service reads the live asset catalogue, prices a real quote, and maps the real status vocabulary. Three wallet adapters exist behind one registry. The approve route starts a durable workflow that submits, sleeps, and polls. The interface drives the real assistant rather than the scripted scenarios the harness ships with.

What the build does not have yet is as important as what it does. The finance components are an empty folder, the auth, wallet, transaction, and agent routes are placeholders, the database layer and its migrations are unwritten, and there is no readme, no landing page, and no recorded demonstration. There are no users, no testimonials, no usage figures, no benchmarks, no pricing, and no deployment claims, and none of those may be invented to fill the gap. There is no logo or brand asset yet, and `public/` is empty.

## Product Principles

**The model proposes and the application decides.** The assistant may request an intent; deterministic code validates it against the connected account, renders an approval bound to concrete parameters, and builds the transaction from trusted inputs. No model output reaches a signature without passing through that validation.

**The record decides the outcome.** Settlement is read from the authoritative source. The assistant's account of what happened is never the evidence for what happened, and a failure is shown as a failure even when the assistant described it as a success.

**The wallet is the only authority.** The application holds no keys and no funds, the model never sees a wallet, and a human approves every movement of money in the first release.

**No prerequisite knowledge.** Technical detail is available on demand and is never a condition of using the product. Someone who does not know what slippage is can still complete a trade, and someone who wants the contract identifier can reach it.

**Truth over breadth.** One verified swap on mainnet is worth more than a broader feature list, and the build adds surface area only after the money path is solid. A claim is only made when the implementation can back it, and the readme has to let a reader verify the claims independently.
