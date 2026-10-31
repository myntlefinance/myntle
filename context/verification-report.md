# Verification Report — plan-brief.md vs. Reality

**Date:** 2026-10-22 · **Brief:** `context/plan-brief.md` · **Target:** NEAR HACKATHON, Nov 2026
**Method:** cloned the design system and read source, hit live APIs, read NEAR's own agent-skills repo, checked every npm package version/license, read the hackathon's own `HACKATHON.md`.

> **This is the research appendix.** It records what was checked, what was found, and which claims about the brief turned out to be wrong. For how to build the thing, start with `context/architecture.md` and `context/build-playbook.md`. Several findings here contradict the original brief, so read the corrections in §5 before writing any code.

---

## 0. Verdict up front

The brief is **structurally sound and about 70% correct** — the four-layer separation (presentation / intelligence / authorization+execution / durability+verification) is exactly right and is what good systems look like. But four things are wrong or stale, one thing is a schedule killer, and one strategic decision is pointed at the wrong end of the project.

| # | Finding | Severity |
|---|---|---|
| 1 | **The hackathon build window is 14 days (Nov 1 → Nov 14), not months.** The brief's 5 phases are ~10–12 weeks of work. | 🔴 Blocker |
| 2 | **The brief's "Phase 5 — autonomous agents" is the *actual differentiator*, and it's a sanctioned track** (`security`: "spending limits, policy engines, sandboxed wallets — give AI money without giving it the keys to everything"). Deferring it to the end means shipping a wallet demo. | 🔴 Strategy |
| 3 | **The swap model is wrong.** The brief assumes "prepare a transaction or swap quote → wallet signs the transaction → verify on-chain." NEAR Intents uses a *deposit-address + relayer* model: the wallet signs an `ft_transfer` (or an off-chain NEP-413 intent), a market maker fills it, and **settlement is verified against the 1Click status API, not NEAR RPC finality**. §5 and §7 of the brief need rewriting. | 🔴 Architecture |
| 4 | **the design system's live registry CSS is broken — `npx shadcn add .../foundation.json` writes a stylesheet Tailwind refuses to compile.** Unbalanced braces, independently verified against the live payloads. Sourcing `app/globals.css` from the repo instead is the fix. **This blocks all 27 items.** | 🔴 Blocker |
| 5 | **the design system's `SidebarNav` pulls a paid, license-checked icon package** whose `preinstall` script *aborts `npm install`* without a key. | 🔴 Blocker (one component) |
| 6 | Package names are wrong/stale: "NEAR Connect" → `@hot-labs/near-connect`; Vercel AI SDK is **v7**; Next.js is **16**. | 🟡 Stale |
| 7 | Docs-vs-API drift on the 1Click API: `depositType`/`recipientType`/`refundType`/`deadline` are **required** by the live API despite being documented as optional; `deadline` is server-set to ~72h, not 10 min. | 🟡 Will cost you hours |
| 8 | **Vercel Hobby caps functions at 300 s *including streamed response time*.** A long-lived SSE or in-request poller will 504 mid-demo. | 🟡 Demo killer |
| 9 | **AI SDK v7 defaults `stopWhen` to `isStepCount(1)`** — a multi-tool agent silently stops after one tool round unless you set it. | 🟡 Silent bug |
| 10 | The brief's `get_quote`/`get_supported_assets`/`get_wallet_balances` tools all map 1:1 onto **real, free, public APIs**. | 🟢 Win |
| 11 | "NEAR Intents" is a real, live, production API with **no auth required** (0.25% extra fee unauthenticated; 0.01% for stablecoin pairs with a free key). | 🟢 Win |
| 12 | **AI SDK v7 has native `toolApproval`** (approve / deny / request-user-approval per tool call) — the brief's human-in-the-loop step can be built into the SDK rather than hand-rolled. | 🟢 Win |
| 13 | **NEAR AI Cloud is OpenAI-compatible, TEE-hosted, and signs every response with a key that never leaves the enclave.** 59 models, `/v1/models` is public, hardware attestation + chat signature = a complete chain of trust. **This upgrades the project from "AI chat app" to "verifiable finance agent"** and lands in four tracks at once. | 🟢🟢 Biggest win |

---

## 1. The schedule is the real problem

From `nearhackathon.com/HACKATHON.md` (fetched, not guessed):

| Fact | Value |
|---|---|
| Hackathon starts | 2026-11-01T00:00:00Z |
| Development ends / submission deadline | **2026-11-14T23:59:00Z** |
| Judging | 2026-11-16 → 2026-11-18 |
| Prize pool | $250K paid in NEAR (grand prize $55K, 1st place $10K × 13 tracks) |
| Submission | public repo **+** public X post with demo video/screenshots. Both required. |
| Jury | Includes **AI judges** (Claude Code & Codex) alongside Illia Polosukhin, Eddy Lazzarin, Mert, Avichal Garg, Kain Warwick, Haseeb, Stepan |

**You have ~10 days of prep and then 14 days of build.** The brief's Phase 1–5 is a 2-month plan.

Three consequences that change the brief:

- **Phases 4 and 5 (§12 mobile, §13 phases) must be deleted, not deferred.** Expo/React Native is a non-starter. There is no "Phase 5" — there are 14 days.
- **The README is part of the product.** With AI judges on the panel and an explicit instruction to write for a machine reader, the README needs "do X → see Y" steps a judge can execute without asking you anything. That is a deliverable with a deadline, not a Day-14 afterthought.
- **No signup.** The only form is the final submission. The first 10 days are free to build, but the repo must be *public* by Nov 14.

---

## 2. Track selection — the brief doesn't know this exists

The hackathon has **13 tracks** and you may enter more than one with a single submission. This directly determines what you build. The relevant ones:

| id | Track | Hints | Fits the brief? |
|---|---|---|---|
| **`privacy`** | Privacy & Private AI | PRIVATE AI, **TEE**, **NEAR AI CLOUD** | ✅ **Primary.** "Explore confidential computation, private finance and AI that protects sensitive data." NEAR AI Cloud is literally this track's headline tech. |
| **`security`** | AI Security & Defense | AGENT SECURITY, FUNCTION CALL KEYS, **TEE ATTESTATION** | ✅ **Secondary.** "Build spending limits, policy engines, sandboxed wallets… Give AI money without giving it the keys to everything" |
| **`agents`** | Agent Economy | AGENT COMMERCE, NEAR INTENTS, CHAIN SIGNATURES | ✅ **Third.** "Build agents that earn, spend, negotiate, hire other agents and pay for APIs" |
| `defi` | Unstoppable DeFi | TRADING, NEAR INTENTS, CHAIN SIGNATURES | ✅ Fourth if it fits |
| `business` | Autonomous Business | AI AGENTS, NEAR INTENTS, CHAIN SIGNATURES | ✅ Plausible fourth |
| `realworld` | Real-World Money | STABLECOINS, NEAR INTENTS, META TRANSACTIONS | ⚠️ Partial |

**Submit as `privacy` + `security` + `agents`.** See §3.7 for why those three together are a stronger, more coherent story than any one alone.

### The strategic correction

The brief spends §9 and Phase 5 on "autonomous execution is a future phase," and treats the AI provider as a commodity (OpenAI). **Both are backwards.**

1. `security` is a scored track, and its thesis *is* the brief's §9 — "restricted agent signing authority, allowed contracts and methods, spending and transaction limits, token and destination restrictions, revocation and expiry." You already wrote the spec.
2. A chat app where a human clicks "approve" on every swap is a wallet demo. Every hackathon will have one. **But** you're right that human-approval must come first — it *is* the safer, more credible build. The fix is not to skip autonomy; it's to make **the verification** the differentiator in week 1 (§3.7) and add autonomy in week 2, when the signed-intent path already exists and only the *signer* changes.
3. **The AI provider is not a commodity here.** On a NEAR hackathon, running your agent on **NEAR AI Cloud** — inside a TEE, with hardware attestation and signed responses — is the difference between "we used a chatbot" and "we built a verifiable agent." The brief says OpenAI; that decision alone would have cost you the `privacy` track and most of the `security` track.

**Honest counter-argument to know before you commit:** the human-approval-first flow is the *credible* story and is genuinely worth points — a judge who sees an AI moving money without a human check will discount the whole project. So the framing must be: **human-approved by default, autonomous-within-explicit-limits as an opt-in mode you can revoke on-chain**, with both paths visibly in the UI. Never lead with "the AI moves your money."

---

## 3. What I verified works (live evidence)

### 3.1 NEAR Intents 1-Click API — live, public, no key required

```
GET  https://1click.chaindefuser.com/v0/tokens     → HTTP 200, 205 tokens, 37 chains, live prices
POST https://1click.chaindefuser.com/v0/quote      → HTTP 201
GET  https://1click.chaindefuser.com/v0/status
POST https://1click.chaindefuser.com/v0/deposit/submit
POST https://1click.chaindefuser.com/v0/generate-intent   (signed intent execution)
POST https://1click.chaindefuser.com/v0/submit-intent
```

**The brief's example, executed live:**

```
100 USDC (on NEAR)  →  18.737774465176163691035519 NEAR   ($98.37)   est. 22s
  originAsset      nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1  (USDC, 6 dec)
  destinationAsset nep141:wrap.near                                                                       (wNEAR, 24 dec)
```

- `dry: true` → preview only, no deposit address. `dry: false` → deposit address + deadline.
- `depositType: INTENTS` / `recipientType: INTENTS` → works, settles into the user's `intents.near` balance. **Verified.**
- **No JWT needed.** Unauthenticated quotes pay an extra 0.25%; a free key from `partners.near-intents.org` drops it to 0.20%, or **0.01% for stablecoin pairs** — i.e. USDC→NEAR at 1 bp. Get the key on day 1.
- `referral` and `appFees` are supported — **you can charge your own fee and split 50/50 with 1Click.** Free business model.
- `amountOutUsd` is explicitly documented as *display only, never use in logic*.
- Response carries `refundFee` and `withdrawFee`. **The brief never mentions surfacing fees to the user.** That's a gap — a finance UI that hides fees is a bad finance UI.

### 3.2 Wallet layer — the brief's package name is wrong

The connector is **`@hot-labs/near-connect`** (HOT Labs is a hackathon ecosystem partner), not "NEAR Connect":

```
@hot-labs/near-connect                 0.11.4   MIT
near-kit                               0.20.2   MIT
near-api-js                            7.3.1    MIT AND Apache-2.0
near-connect-hooks                     1.1.6    MIT
@near-wallet-selector/core             10.1.4   MIT OR Apache-2.0
@defuse-protocol/one-click-sdk-typescript  0.1.26  ISC
@defuse-protocol/intents-sdk           0.92.0
```

`NearWalletBase` exposes **both** `signMessage` (NEP-413) **and** `signAndSendTransaction(s)`. Wallets: HOT, Meteor, Intear, MyNearWallet, Nightly, NEAR Mobile, Unity, OKX, + anything via WalletConnect. Feature filtering is built in (`features: { signMessage: true }`).

### 3.3 Wallet-based auth — the brief's design is exactly right and implementable

`near-api-js/nep413` exports `verifyMessage({ signerAccountId, signerPublicKey, signature, payload: { message, recipient, nonce }, provider })`. That is precisely the brief's §5 "Wallet authentication" flow — random 32-byte nonce, bound to origin, signed, verified server-side, single-use. **No changes needed.** NEAR also ships `near-api-js/references/nep413.md` with a copy-paste auth flow.

### 3.4 Bounded-agent signing authority — real, but *not* the way I first assumed

⚠️ **Correction to an earlier draft of this report.** I first proposed giving the agent a NEAR function-call access key with a hard `allowance` as a spend cap. **That does not work**, and the reason is fundamental:

> **A function-call access key cannot attach a NEAR deposit.** nearcore rejects it (`InvalidAccessKeyError::DepositWithFunctionCall`).
> NEP-141 `ft_transfer` and every DEX `swap` are **payable** (1 yoctoNEAR).
> ⇒ **A function-call key can never drive `ft_transfer` or a swap.** It is limited to *non-payable* methods on its one whitelisted contract.

So the naive "function-call key = spending limit on transfers" story is dead. Here is what actually works, and it is better.

**The real primitive: the Intents Verifier contract's own key model.**

From `docs.near-intents.org/integration/verifier-contract/account-abstraction.md` (fetched):

> "Every public key registered to an account can sign intents on its behalf."
> "Function Call Keys — restricted to calling specific contracts, **safe to share with applications**."

The Verifier (`intents.near`) keeps its **own** `account_id → public_keys` mapping, populated via `add_public_key`. A key's authority there is **independent of its on-chain NEAR permission**. So:

```
1. User (full-access key) adds the AGENT key to their NEAR account as a
   function-call access key:
     contractId:  "intents.near"
     methodNames: ["add_public_key"]
     allowance:   tiny            ← on-chain authority ≈ nothing

2. The agent key calls intents.near.add_public_key(agent_pubkey)
   → the Verifier now accepts signatures from the agent key for this account.

3. The AGENT KEY'S PRIVATE KEY is held by the AI's signer.

4. The agent signs NEP-413 intents off-chain:
     { signer_id, deadline, intents:[{intent:"token_diff", diff:{...}}] }
   → POST /v0/submit-intent → Solver Relay → market makers → execute_intents
   → tokens move inside the intents.near LEDGER, never touching the user's
     main account.
```

**What is genuinely bounded, and what is only policy:**

| | Bounded how | Enforced by |
|---|---|---|
| Agent key's **on-chain** NEAR authority | one contract, one non-payable method, tiny allowance | **the chain** |
| Which **tokens** it can touch | only funds held in the `intents.near` ledger, not the user's main account | **the contract** |
| **Revocation** | `remove_public_key` on `intents.near` → the agent's signatures stop verifying, **on-chain, provably, immediately** | **the chain** |
| **Expiry** | every intent payload carries a `deadline`, which the Verifier enforces | **the contract** |
| **Per-tx / daily spend cap** | ❗ **backend policy engine only** — the agent key can sign any intent the account authorizes | **your server** |

**Honest framing for the judges:** the on-chain guarantees are *isolation, revocability and expiry*; the *numeric spend cap* is a policy engine you enforce and can prove with an audit log. Say exactly that. A judge who catches you calling a backend check an "on-chain spending limit" will discount everything else you claim.

This maps precisely onto the `security` track's own wording — "spending limits, policy engines, sandboxed wallets… give AI money without giving it the keys to everything." You would be shipping a *policy engine* plus an on-chain-revocable agent key, with the funds sandboxed in a separate ledger. That is a genuinely strong entry.

⚠️ **Also correct a common misconception:** Chain Signatures (MPC, 8 nodes) is for controlling *other* blockchains' accounts **from** NEAR — "a 'one way' solution to sign and execute outbound transactions happening on other blockchains." It is **not** the primitive for bounding a NEAR-native agent. Function-call keys + the Verifier's key registry are.

**Other key-model facts worth knowing:**
- There is **no documented cap** on access keys per account (the "10" figure floating around is an RPC page size, `view_access_keys_limit`, not a per-account limit). Don't design around a cap you can't cite.
- **Gas keys (NEP-611, protocol v86)** — an access key with its own prepaid NEAR balance and up to **1,024 independent nonce lanes** (no nonce collisions). The right primitive for programmatic senders/relayers.
- `ft_transfer`/`swap` are **always wallet-prompted**, because they are payable. Model them that way.

### 3.5 The brief's tool list maps 1:1 to real, free APIs

| Brief's tool | Real implementation | Cost |
|---|---|---|
| `get_supported_assets` | `GET /v0/tokens` (205 assets, live USD prices) | free |
| `get_wallet_balances` | `ft_balance_of` per contract + `GET /v0/account/balances` (intents balance, user-session auth) | free |
| `get_quote` | `POST /v0/quote` with `dry: true` | free (0.25% fee only on execution) |
| `prepare_transaction` | quote with `dry: false` → deposit address + deadline | free |
| `get_transaction_status` | `GET /v0/status` → terminal states `SUCCESS`/`FAILED`/`REFUNDED`/`INCOMPLETE_DEPOSIT` | free |
| `get_transaction_history` | `GET /v0/account/balances` / Explorer API (history endpoint is invite-only) | free |

**Zero RPC dependency for the happy path.** You need NEAR RPC only for the deposit receipt and for `ft_balance_of`.

### 3.6 Official NEAR agent skills — use these

`github.com/near/agent-skills` (16★, updated Sep 28) ships skills for `near-intents`, `near-dapp`, `near-api-js`, `near-kit`, `near-smart-contracts`, `near-cli-rs`, `near-ai-cloud`, `near-contract-audit`, `near-smart-contracts`. The `near-intents` skill alone has 20 rule files covering every API endpoint, every chain's deposit flow, and React hooks.

```bash
npx skills add near/agent-skills --skill near-intents
```

Treat these as the source of truth while building. They are current; the docs site has drifted (§6).

---

### 3.7 NEAR AI Cloud — the AI layer

NEAR AI Cloud is an **OpenAI-compatible** inference provider. The practical consequences come first, and the trust properties come last.

**Gateway:** `https://cloud-api.near.ai/v1` — point any OpenAI SDK at it.

**Verified live (the catalogue needs no API key):**
```
GET https://cloud-api.near.ai/v1/models   → 200, 59 models with pricing + capabilities
```

| Model | in $/1M | out $/1M | notes |
|---|---|---|---|
| `openai/gpt-6-luna` | **0.10** | **0.50** | tools, structured_outputs, reasoning — the default for the agent loop |
| `openai/gpt-6-astra` | 10 | 50 | **no `tools` flag** — see caveat |
| `openai/gpt-6.1-sol` | 2 | 10 | **no `tools` flag** — see caveat |
| `anthropic/claude-sonnet-5-5` | 2 | 10 | tools + reasoning, 1M ctx |
| `Qwen/Qwen3.8-27B` | **0.04** | 1.35 | tools, reasoning — cheapest capable option |
| `z-ai/glm-5.3-flash` | 0.08 | 0.50 | tools, reasoning, 1M ctx |
| `openai/privacy-filter` | 0.01 | — | PII classification |
| `Qwen/Qwen3-Embedding-0.6B` | 0.01 | 0.01 | embeddings |
| `Qwen/Qwen3-Reranker-0.6B` | 0.01 | 0.01 | reranking |

⚠️ Same caveat as OpenAI direct: `gpt-6-astra` and `gpt-6.1-sol` are listed **without** `tools` — they don't do tool calling on Chat Completions. For an agent, use **`gpt-6-luna`** (cheap *and* tool-capable) or **`Qwen/Qwen3.8-27B`** (cheapest).

#### What it supports

| Capability | Endpoint | Notes |
|---|---|---|
| Chat completions | `/v1/chat/completions` | tool calling, structured outputs, reasoning, streaming over SSE |
| Responses | `/v1/responses` | stateless, `store: false`, caller-managed history |
| Embeddings | `/v1/embeddings` | OpenAI format, batch accepted |
| Reranking | `/v1/rerank` | NEAR extension |
| Images | `/v1/images/generations`, `/v1/images/edits` | |
| Audio | `/v1/audio/transcriptions` | whisper-compatible, 25 MB max |
| **PII redaction** | `/v1/privacy/redact` | gateway-only, redacts before the model sees the text |
| **PII classification** | `/v1/privacy/classify` | detect PII in a request |
| Attestation and signatures | `/v1/attestation/report`, `/v1/signature/{chat_id}` | see below |

**The PII endpoints are worth using in a finance app.** A portfolio query that names an account holder can be scrubbed at the gateway before it reaches the model, and the redaction is a first-class API rather than something to build.

**Pricing is identical to OpenAI direct** for the flagship models. This is not a cost decision, and `context/decisions.md` records why.

**Build note.** Use `createOpenAICompatible` from `@ai-sdk/openai-compatible` (3.0.75, Apache-2.0, peer `zod ^3.25.76 || ^4.1.8`), not `@ai-sdk/openai`. The latter defaults to the Responses API and to OpenAI's own model ids. The provider also accepts a custom `fetch`, which is the hook to use if the byte-exact hashing below is ever needed. Full wiring is in `context/build-playbook.md`.

#### The trust properties, briefly

Inference runs inside an Intel TDX confidential VM with NVIDIA TEE GPUs, and TLS terminates inside the enclave rather than at a load balancer. Every chat response is signed by a key that never leaves the TEE, and the model can be attested.

```
hardware attestation  →  signing_address  →  chat signature (over request+response hashes)
```

1. **Model attestation** — `GET /v1/attestation/report?model={model}&signing_algo=ecdsa&nonce={64-hex}` → `model_attestations[0].{signing_address, nvidia_payload, intel_quote}`. `nvidia_payload` → NVIDIA NRAS (GPU); `intel_quote` → Intel TDX (CPU). Requires an API key; **retrieval is non-billable**.
2. **Chat signature** — `GET /v1/signature/{chat_id}?model={model}&signing_algo=ecdsa` → `{ text: "{model_id}:{request_hash}:{response_hash}", signature, signing_address, signing_algo, signature_kind }`.
3. **Verify** — `ethers.verifyMessage(text, signature)` → recovered address must equal the attestation's `signing_address`.

⚠️ Two traps that silently break the hashes: a **streaming** response ends with **two newlines** which must be included in the response hash, and `signature_kind` is `provider_tee` (signed in the model TEE, byte-exact) or `gateway` (signed in the gateway TEE, because the gateway rewrote the streamed bytes). Direct endpoints (`{slug}.completions.near.ai`) give `provider_tee`; the gateway often gives `gateway`.

Official tooling: `github.com/nearai/nearai-cloud-verifier` and `github.com/near-examples/nearai-cloud-verification-example`. Don't write the verifier from scratch.

**This is optional rather than required.** The build works without it, and the product does not depend on it. The reasons to care are that the model's identity can be stated instead of assumed, that a judge can check the claim instead of taking it on trust, and that the privacy and security tracks both list attestation as a theme. Treat it as a differentiator to add when the schedule allows, not as a foundation to build first.
**Cost reality:** NEAR AI Cloud's prices for `gpt-6-luna` are **identical to OpenAI direct** ($0.10/$0.50). So this is **not** a cost play. It is a **verifiability + privacy + track-alignment** play. Say that in the README rather than pretending it's cheaper.

### The thesis — a private finance agent

> An assistant that reads your balances and prepares a swap without ever sending your financial details to a provider who can read them, shows you exactly what it intends to do before it does anything, and settles against a chain rather than against its own say-so. And if you want to check that the model really ran where it says it ran, the hardware attestation is right there in the interface.

The product is a chat interface that moves money. The trust properties are what make it defensible, and they come from three independent places rather than from one claim:

| Layer | What backs it | Who enforces it |
|---|---|---|
| The model | Inference inside a confidential environment, with an attestation a judge can check | the enclave, and the reader if they bother to check |
| The authorization | The user approves the exact parameters, and the server verifies that it issued the approval | the wallet, and our server |
| The settlement | The outcome is read from the chain, and a successful deposit is not treated as a successful swap | the chain |

That lands in four tracks at once, and no one else at the hackathon will have all four pieces:

| Track | Which part of the thesis hits it |
|---|---|
| **`privacy`** — "Private by design", hints *PRIVATE AI · TEE · NEAR AI CLOUD* | the whole AI layer |
| **`security`** — "Give AI money without giving it the keys to everything", hints *AGENT SECURITY · FUNCTION CALL KEYS · **TEE ATTESTATION*** | attestation + policy engine + revocable agent key |
| **`agents`** — "agents that earn, spend… pay for APIs, compute or data", hints *NEAR INTENTS · CHAIN SIGNATURES* | NEAR Intents settlement + agent key |
| **`defi`** — "settle across chains through NEAR Intents" | the swap engine |

**This is the product to build.** `privacy` + `security` + `agents` as the submitted triple, `defi` as a fourth if it fits.

⚠️ **A warning about over-claiming.** The attestation work is the easiest thing in this project to overstate, because it is the most novel. The chain enforces isolation, revocability, and expiry for the agent key. It does **not** enforce a numeric spending limit, because a registered key can sign any intent the account is entitled to, so that cap is a policy decision in application code. Describing a backend check as an on-chain limit would undermine the credibility of the parts that genuinely are on-chain. `context/decisions.md` records this.

### The one integration gotcha: byte-exact hashing

The chat signature covers the **exact bytes** you sent and received. The AI SDK rewrites both, so a naive integration cannot reproduce the hashes.

**Solution — a custom `fetch` in the provider.** AI SDK v7 lets you pass your own `fetch` to the provider:

```ts
// providers/nearai.ts
export const nearAI = createOpenAICompatible({
  name: 'near-ai-cloud',
  baseURL: 'https://cloud-api.near.ai/v1',
  apiKey: env.NEAR_AI_CLOUD_API_KEY,
  fetch: capturingFetch,   // ← tee the exact bytes
});
```

In `capturingFetch`: hash the outgoing request body → hash the incoming response text → keep both keyed by the returned chat id. Then `GET /v1/signature/{chat_id}` and verify. **Do the same for the swap-decision message specifically** — that's the one that must be provable.

Practical fallback if streaming proves fiddly: make the **swap-recommendation call non-streaming** (hash in, hash out, verify), and stream the rest of the conversation normally. The verifiable artifact is the money decision, not the small talk. That's the right trade.

⚠️ Use **`createOpenAICompatible`** (Chat Completions shape), **not** `@ai-sdk/openai` — the latter defaults to the Responses API and to OpenAI's own model IDs. NEAR AI does expose a Responses API, but Chat Completions is the well-trodden path.

### What this replaces in the brief

| Brief | Revised |
|---|---|
| "AI provider: **OpenAI API**" | **NEAR AI Cloud** (OpenAI-compatible, TEE, verifiable). Keep OpenAI as a fallback for comparison in the README — "same model, attested vs not" is a nice demo. |
| "AI inference: Usage-based OpenAI API budget" | Usage-based **NEAR AI Cloud** budget (same magnitude). Add "no OpenAI key required" as a dependency win. |
| §9 "No private keys or signing secrets in model context, prompts, logs" | Still true, and now **provable**: the prompt ran inside a TEE whose attestation you can publish. Upgrade this from a policy claim to a cryptographic one. |
| — | **New:** the model attestation report + chat signature become a first-class UI component (`VerificationBadge` / `AttestationPanel`) and a first-class README section. |

---

### 3.8 The two-USDC trap — and the second engine you need

This is the most product-damaging fact in the whole brief, and it is invisible until you go on-chain.

### There is no `usdc.near`

Verified live against mainnet at block ~220,988,673:

```
usdc.near   → CompilationError(CodeDoesNotExist)   ❌
nusdc.near  → CompilationError(CodeDoesNotExist)   ❌
```

### And there are (at least) two different real USDCs

| | **USDC.e** (Rainbow-bridged) | **Intents-USDC** (1Click) |
|---|---|---|
| Contract | `a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near` | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |
| `ft_metadata` | symbol **`USDC.e`**, decimals 6, name "Bridged USDC" ✅ verified | symbol **`USDC`**, decimals 6, name "USDC" ✅ verified |
| **Ref/RHEA pool** | ✅ pool 3, ~$95M | ❌ **zero pools** |
| **1Click / NEAR Intents** | ❌ not in the asset list | ✅ the asset list's only NEAR USDC |
| Bridge path | Rainbow | NEAR Intents / Aurora |

⇒ **They are different NEP-141 contracts with no shared liquidity.** A user holding Rainbow USDC.e cannot use the 1Click route; a user holding Intents-USDC has no Ref pool. Your product must **detect which one the user holds and route accordingly** — and say which one they're about to spend. Get this wrong and the demo fails with "insufficient balance" on a balance the user can plainly see.

*(Also on mainnet: `16.contract.portalbridge.near` and `3.contract.portalbridge.near` USDC — a third flavour. `usdt.tether-token.near`, `neartether.near`, `dac17f95….factory.bridge.near` (USDT.e), `6b175474….factory.bridge.near` (DAI).)*

### The second engine: Ref Finance (now RHEA Finance)

`v2.ref-finance.near` is live, deep, and fully on-chain. **Verified live just now:**

```jsonc
// view: get_return  →  quote
{ "pool_id": 3,
  "token_in":  "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
  "amount_in": "100000000",           // 100 USDC.e (6 dp)
  "token_out": "wrap.near" }

// → "18739966989680041529795258"  = 18.739967 wNEAR   (implied 5.336 USDC/NEAR)

// view: get_pool(3)
{ "pool_kind": "SIMPLE_POOL",
  "token_account_ids": ["…USDC.e…", "wrap.near"],
  "amounts": ["48133784475", "9066137481030539301351402570"],
  "total_fee": 30, "amp": 0 }
// → 48,133,784.475 USDC.e  +  9,066,137.481 wNEAR   ≈ $95M pool, 0.30% LP fee
```

**Why this matters for the demo:** Ref is a plain AMM. The user signs **two** transactions, a market maker is not involved, and if the swap reverts the USDC is still sitting in the exchange, withdrawable with `withdraw {token_id, amount}`. **Deterministic failure semantics, no relayer, no `REFUNDED` state.** For a live demo in front of judges, that is worth more than the cross-chain headline.

```
TX1  USDC.e.ft_transfer_call { receiver_id: "v2.ref-finance.near",
                                amount: "100000000", msg: "" }   deposit 1 yocto, gas 100 TGas
TX2  v2.ref-finance.near.swap { actions: [{ pool_id: 3,
                                            token_in: USDC_E, amount_in: "100000000",
                                            token_out: "wrap.near",
                                            min_amount_out: "<get_return × 0.99>" }] }
                                                                 deposit 1 yocto, gas 300 TGas
```

### The architecture this implies — one interface, two engines

```
                      ┌─────────────────────────────┐
   chat (NEAR AI/TEE) │  SwapService (TS interface) │
                      └──┬───────────────────────┬──┘
         ┌───────────────┘                       └───────────────┐
         │                                                       │
   ENGINE A: RHEA / Ref Finance (v2.ref-finance.near)   ENGINE B: NEAR Intents (1Click)
   • USDC.e  ↔ wNEAR                                 • Intents-USDC, and USDC from
   • 2 wallet txs, fully on-chain                    Ethereum/Base/Solana/Arbitrum…
   • no relayer, deterministic, ~0.5% all-in        • deposit-address OR signed intent
   • settlement verified on NEAR itself             • cross-chain (the unique capability)
   • needs 2 one-time storage deposits              • 0.20–0.25% platform fee
                                                        • relayer/solver dependency
```

Your brief already said *"Keep protocol integration behind a TypeScript service interface so the AI layer does not depend directly on a particular wallet or swap implementation."* **That sentence is now load-bearing.** Ship Engine A first (demo-safe), add Engine B for the cross-chain + agent story. The chat, the tools, the cards, and the timeline are identical across both.

### Four more on-chain gotchas worth building into the product

1. **You will never receive native NEAR from a swap.** You get **wNEAR**. If the product promises *"swap 100 USDC for NEAR"*, it means **→ wNEAR** unless you add a third tx (`wrap.near.near_withdraw`). Say "wNEAR" in the UI or unwrap it for the user.
2. **Two one-time storage deposits before a user's first Ref swap** — `v2.ref-finance.near.storage_deposit` (0.1 Ⓝ) and `USDC.e.storage_deposit {account_id: "v2.ref-finance.near"}` (0.0125 Ⓝ) ≈ **0.11 Ⓝ ≈ $0.59**. Pre-flight with `storage_balance_of`, skip if registered, and surface it as a *"one-time setup"* step. A user hitting an opaque revert here is a failed demo.
3. **Never price off `get_pools`.** Ref's `get_pool`/`get_pools`/`get_pool_volumes` amount fields are **internally inconsistent across pools** (the DAI pool reads ~1000× off vs. its own quotes). Use **`get_return` only**. Verify `total_fee` is in **basis points** (30 = 0.30%).
4. **Cross-shard swaps can fail in the inner receipt while the outer tx "succeeds."** Check `res.status.Failure` **and every `res.receipts[i].outcome.status`**. NEAR finality is ~1.2 s, so poll `tx` with `wait_until: "FINAL"`.

### Corrections to the "one engine" assumption in §5/§7

| Item | Reality |
|---|---|
| RPC endpoints | `rpc.mainnet.near.org` and `rpc.near.org` **work for light use but are deprecated and throttle under load** (burst tests → 100% 429). `near-mainnet.public.blastapi.io` is **dead (DNS fail)** though the docs still list it. `free.rpc.fastnear.com` handled 40/40 parallel calls cleanly. **Use `https://free.rpc.fastnear.com` primary + `https://rpc.fastnear.com` backup, wrapped in near-api-js `FailoverRpcProvider`.** |
| RPC method names | `call_function` → **`EXPERIMENTAL_call_function`**, and it now takes a **struct** (`account_id`/`method_name`/`args_base64`/`finality`), not the old array. `tx_status` is **not registered** on public nodes → use `tx` or `EXPERIMENTAL_tx_status`. |
| RPC result encoding | `EXPERIMENTAL_call_function` returns `result` as a **raw byte array**, not base64. Decode with `Buffer.from(result)` — `Buffer.from(result, "base64")` silently yields garbage. |
| near-api-js v7 | **Removed** the v5 API: `connect(keyStores, …)`, `connection.signAndSendTransaction`, `Action.functionCall`, `InMemorySigner`, and the built-in keystores. Use `new Account(id, provider, keyPairString)` + `actions.functionCall({methodName, args, gas, deposit})`. |
| Gas | Attach **300 TGas** for a Ref swap (not 1000). Protocol v78 introduces a gas-refund fee on unspent gas, so over-attaching is not free. |
| Meta-transactions | near-api-js v7 ships **`createSignedMetaTransaction({receiverId, actions, blockHeightTtl})`** (NEP-366) — the user signs once, your relayer submits and pays gas. **This is the cleanest "the AI can act, the user signs once" pattern**, and it complements the Intents agent key nicely. |

---

## 3.9 Two later changes — multi-chain wallets and Bun

Two decisions were made after the first version of this report, and both were verified the same way.

### 3.9.1 NEAR Intents already speaks EVM and Solana

The original plan treated the wallet as a NEAR wallet. It does not have to be.

The verifier contract accepts signed intents in seven standards, and three of them cover the wallets most people already have.

| Standard | Wallets | How the account is identified |
|---|---|---|
| **ERC-191** | MetaMask, Rabby, Rainbow, any WalletConnect wallet | `0x` plus 40 hex characters, derived from the public key |
| **Raw Ed25519** | Phantom, Solflare, Slope | 64 hex characters, derived from the public key |
| **NEP-413** | MyNearWallet, Meteor, Sender, Ledger | `alice.near`, or 64 hex characters |
| SEP-53 | Freighter, Lumens | 56 base32 characters |
| TIP-191 | TronLink, Klever, Trust Wallet | Starts with `T` |
| TON Connect | Tonkeeper, EverWallet | Base64 |
| WebAuthn | Any browser passkey | Derived from the credential |

Supported chains include Arbitrum, Base, Ethereum, BNB, Optimism, Polygon, Avalanche, Monad, Scroll, Sui, Aptos, Cardano, Solana, Stellar, TON, TRON, XRP, Starknet, Bitcoin and its forks, Aleo, and NEAR itself.

**Why this is a large improvement.** A user on any of these chains signs a message. The settlement happens inside the verifier contract. There is no account creation, no gas, and no faucet. The earlier plan required a judge to create a NEAR account and fund it before they could try the product, which is several minutes and the single largest risk to a live demonstration.

**The consequences that have to be handled:**

- **The account is derived from the public key, not from the chain.** An Ed25519 key produces a 64 hex character implicit account, a secp256k1 key produces a `0x` address, and a named NEAR account keeps its name. The same wallet on two chains is two accounts with two balances, so every address in the database sits next to its chain.
- **The agent's key survives the change.** A public key can be added to an account *through a signed intent*, not only through an on-chain call from a named NEAR account. So a user on any chain can register the agent's key, and the key has to match the curve of the account.
- **The balance question is now two balances.** The on-chain balance in the user's own wallet, and the balance inside the verifier ledger, which is what a swap actually spends. A user with two hundred USDC in MetaMask and nothing in the ledger cannot swap through the signed-intent path, and the interface has to say that.
- **The settlement authority moves one step away.** The application reads the status endpoint, which reports the settlement that happened inside the verifier contract, rather than reading the chain itself. The principle holds, because the status endpoint is reporting an on-chain settlement, but the readme should say so rather than implying the application reads the chain directly.

**What it lets us drop.** The RHEA exchange route needed two wallet transactions, two one-time storage deposits, a minimum output check, and careful inspection of every receipt. The signed-intent route needs one signature and no gas. The RHEA route is not built in the first release, and the engine interface is kept so it can be added back for users who want a trade that settles entirely on one chain with no solver in the middle.

**Two more operations on the same API**, both of which reuse the quote card and the approval card:

- **Limit orders** live on `/v0/orders`, use a JSON:API envelope, and require the `confidentiality` attribute. The response carries a `fillStatus` and, separately, a `payoutStatus`, and the documentation is explicit that the fill ending does not mean the payout arrived, so the timeline needs a second terminal check.
- **Perpetuals** route through the same quote endpoint against a different asset id, `1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054`. The fees are a flat 0.2 USDC on a deposit from Hyperliquid, the minimum deposit is 0.5 USDC, and the `usdSend` method costs a further 1 USDC on top, which is the kind of detail that silently breaks a demo if it is not in the code.

### 3.9.2 Bun

Bun is safe for this stack as the package manager and the local runtime, and it is not yet safe as the Vercel production runtime.

**What was verified by building the stack on Bun 1.4.3.** The whole thing, at these versions: Next.js 16.4.2 with Turbopack, the Workflow SDK at 5.2.3 with the `use workflow` and `use step` directives, `ai@7.0.148`, `near-api-js@7.3.1`, and zod 4. The build succeeded, the workflow lifecycle executed end to end, the durable sleep resumed, the return value was correct, and the generated route table was identical to a Node build.

**Bun is an officially verified Next.js adapter**, listed alongside Vercel in the Next.js documentation, and the adapter is hosted under the Next.js organisation.

**Why the production runtime stays on Node.** Two open defects, neither of which is ours and neither of which is fixed today.

- A Bun defect where the async context is not restored inside an unhandled rejection handler. Next.js 16.4 has an open issue about exactly this, filed on the sixth of October, and it shows up as false client-hook errors during a build whenever a client component calls `usePathname` inside a Suspense boundary. Our application shell will do that.
- A Next 16.2 change that makes some routes detected as Node while the bundle was built for Bun, which then fails on cold start with "Bun is not defined". The Next side was closed and the Bun side was not.

**Three traps that cost an hour each if you do not know them.**

- **Do not set `"packageManager": "bun@…"`.** Corepack does not support Bun, and Vercel reads that field through Corepack, so the build fails before the install command runs. Vercel detects the `bun.lock` file and installs with Bun on its own. Bun's own documentation gets this wrong.
- **Bun silently ignores `engines`.** The Node version guard in `package.json` stops working, so the check belongs in CI.
- **`bun run build` is not a Bun build.** The Next binary has a Node shebang, so without `--bun` the build quietly runs on Node. The scripts in `package.json` have it.

Two smaller ones. Bun blocks dependency lifecycle scripts by default, and the `@swc/core` postinstall is one of them, so it goes in `trustedDependencies`. And Next.js installs a missing dependency with npm when it cannot find one, which leaves a stray `package-lock.json` next to `bun.lock`, so every type package is installed explicitly and the stray lockfile is ignored.

**Vitest runs on Node** rather than Bun, which is what you want, because Vitest's binary has a Node shebang and Bun's own test runner does not read a Vitest configuration.

#### What was actually built and run, to confirm the above

The stack was installed and exercised rather than reasoned about, and five things surfaced that reading the documentation would not have.

**The Solana wallet adapter is no longer installable.** The whole 0.19 line of `@solana/wallet-adapter` and of every per-wallet package has been withdrawn from npm, so there is no 0.19 to install. The replacement, version 3, requires React 19.3, `@solana/kit`, and `@solana/web3.js` version 3. React 19.3 is excluded by the `@ai-sdk/react` peer range of `^18 || ~19.0.1 || ~19.1.2 || ~19.2.1`, so the two cannot coexist without a peer warning on the AI SDK's React bindings. The Wallet Standard replaces it, has no peer dependencies, and gives an address and a signed message, which is everything this product needs from a Solana wallet.

**`FatalError` is not where the documentation suggests.** It is exported from the main `workflow` entry, not from `workflow/errors`, and the errors entry point holds a different set of names entirely.

**An unresolvable stylesheet import makes Turbopack panic.** The the design system foundation imports `shadow-plugin/unprefixed`, and the registry declares no dependencies, so the package has to be installed by hand. Without it, the build fails with a Turbopack internal error about an invalid type where a string was expected, rather than with a message naming the missing package. The same is true of any package import in a stylesheet.

**Client components are still rendered on the server.** The wallet libraries call `createContext` when they are evaluated, and React's server build does not have that function, so the providers have to sit behind a client boundary. The first attempt put them in a client component, which was not enough, because a client component is server-rendered for the initial HTML.

**One connector reaches for `indexedDB` at module scope.** The WalletConnect connector pulls in a wallet SDK that does this, and the server has no such thing. The build still succeeded, because React catches the error during prerendering and falls back to the client, but the warning was printed on every build. The whole provider tree is now loaded with server rendering turned off, which is honest about the fact that a wallet application needs a browser, and the build is clean.

#### The result

| Check | Outcome |
|---|---|
| `bun install` | 905 packages, no peer dependency warnings, 43 seconds |
| `bun run build` | Compiled, workflows compiled (19 steps, 1 workflow), TypeScript clean, all routes generated, no warnings |
| `bun --bun next start` and a request to the page | HTTP 200, correct markup, all three wallet sections present |
| A durable workflow, started through the API | Called the settlement API for a real quote, produced a deposit address and a live price, slept durably, polled the status endpoint, and completed |
| `bun run typecheck` | Clean |

The quote the workflow retrieved was 19.9064 NEAR for 100 USDC, and the deposit address was a real one from the API rather than a fixture.

---

## 4. the design system — the audit

**Verdict: MIT, genuinely reusable, but the live registry CSS is broken, you must not install `SidebarNav`, and the "fully functional chat app" is a UI, not an app.**

> ### 🔴 BLOCKER: the live registry ships unbalanced CSS
>
> The registry's foundation payload writes a stylesheet **Tailwind v4 refuses to compile**. Independently verified by brace-counting the live payloads:
>
> | Live registry item | file | `{` vs `}` | result |
> |---|---|---|---|
> | `foundation` | `app/beautifui/foundation.css` | **218 / 219** | ❌ Δ = −1, one orphan `}` |
> | `records-table` | `app/beautifui/records-table.css` | **121 / 120** | ❌ Δ = +1, one orphan `{` |
> | everything else | — | balanced | ✅ |
>
> Root cause: `scripts/build-registry.mjs` slices `app/globals.css` by **hardcoded line numbers** (`slice(423,505)`, `slice(505,1331)`, `slice(0,423) + slice(1331)`), and the cut points land mid-block. The repo's own committed `public/r/*.json` are balanced — only the **deployed** build is corrupted. Upstream issue **#18** is open (2026-09-17, 0 comments).
>
> **Fix:** don't take the registry payload for the foundation. Copy **`app/globals.css` from the repo** (verified balanced, Δ = 0) instead, and copy `records-table.css` out of the repo's `globals.css` by hand if you want that table. Everything else installs cleanly.
>
> **Two more packaging gaps in the same registry:**
> - `foundation.json` declares **no `dependencies`**, but the CSS it writes begins `@import "shadow-plugin/unprefixed"` → `shadcn add` never installs it → unresolved import → build failure. Install it yourself: `npm i shadow-plugin`.
> - `@/lib/utils` (the `cn` helper → `clsx` + `tailwind-merge`) is imported by `Button.tsx` but is **not shipped** as a registry file. You must supply the standard shadcn `lib/utils.ts`.

| Fact | Value |
|---|---|
| Repo | 327★, 46 forks, 95 commits, single maintainer |
| License | **MIT — Copyright (c) 2026 Myntle** ✅ |
| Last commit | 2026-09-22 (one month old — alive, not abandoned) |
| Stack | Next.js 15 App Router · React 19 · Tailwind v4 · TypeScript — **matches your brief** |
| Install | copy the source from the design system's repository, or `shadcn add` against its registry |
| Registry | 27 items (26 components + `foundation`) |
| Total LOC | ~12,720 (of which `globals.css` = 1,551 and the harness = 1,324) |

### 4.1 Dependency / license audit — two blockers

| Package | Version | License | Needed by | Verdict |
|---|---|---|---|---|
| `shadow-plugin` | 2.1.1 | MIT | **the foundation CSS** (`@import "shadow-plugin/unprefixed"`) | ✅ required, MIT |
| `liveline` | 0.0.7 | MIT | `InsightCards` (charts) | ✅ |
| `glimm` | 0.3.1 | MIT | `PromptBar` (shader sweep) | ✅ optional |
| `iconoir-react` | 7.12.1 | MIT | `SelectionActions` | ✅ |
| `@web-kits/audio` | 0.2.0 | MIT | `InteractionSounds` (site chrome) | ✅ optional |
| `motion` | 14.5.0 | MIT | animations | ✅ |
| **`the paid icon package`** | — | **PAID** | **`SidebarNav` only** | ❌ **BLOCKER** |

**The blocker:** `SidebarNav.tsx` imports 11 icons from `@the paid icon package`, which is a **proprietary, commercial icon library** ("private package with all rights reserved", license = *SEE LICENSE IN LICENSE.md*, Iconists License Agreement with paid Single/Team/Enterprise/Ultimate seats). Its `package.json` has a **`preinstall` script**:

```js
const licenseKey = process.env.CENTRAL_LICENSE_KEY;
if (!licenseKey) {
  throw new Error("license key is not set...");
}
```

→ **without `CENTRAL_LICENSE_KEY`, `npm install` aborts.** (With a key present, install also phones home to the vendor's licence server.) The upstream README flags it: *"a paid icon library with a license check that runs on `npm install`."*

Only three files touch it — `SidebarNav.tsx`, `UseThisHarness.tsx` and `lib/meta.ts` — and the latter two are site chrome you won't ship.

**Fix:** don't install `sidebar-nav`. Build your own sidebar on the same tokens with **Tabler Icons** (`@tabler/icons-react` 3.49.0, MIT) — which is what your brief already specifies. This is exactly the "components of our own" you anticipated.

### 4.1b Other packaging notes

- **`agent-screen` is not in the registry.** It exists in the gallery (`lib/meta.ts`) but has no `public/r/agent-screen.json`, so `shadcn add` can't install it. Copy it from the repo manually if you want it — but note it's a *screen-recording viewer* with a faux window, not a chat surface.
- **`loading-state`** hardcodes a third-party remote asset (`https://95dnc2a95qgwt9ff.public.blob.vercel-storage.com/subway-surfers-min.mp4`) in its "Surfer" variant. Swap it for your own asset or don't use that variant.
- **`liveline` is 7 months stale** (v0.0.7, 2026-03-12). MIT and fine, but pin the version.
- **`glimm`** is a WebGL page-transition library used in `PromptBar` for a rainbow sweep on model change. MIT and legal, but it's heavy for a chat composer and there is no model picker in your product. **Consider dropping `PromptBar` and using the plain `ChatComposer` or your own composer** — cheaper and less to strip.
- **No legal obligation from the MIT license beyond retaining the notice.** Add a `THIRD_PARTY_NOTICES.md` listing `shadow-plugin` (MIT), `liveline` (MIT), `glimm` (MIT), `iconoir-react` (MIT), `clsx`/`tailwind-merge`/`class-variance-authority` (MIT).
- ⚠️ **MIT covers the code, not the product.** For an AI-finance app you need your own investment/financial-advice disclaimer and a NEAR-specific regulatory review. The license does not give you either.

### 4.2 The "fully functional chat app implementation" — what it actually is

The harness is `Harness.tsx` (1,062 LOC) + `ChatExperience.tsx` (262 LOC). Reading it:

- A `SCENARIOS: Record<string, Scenario>` map (line 232) with hardcoded ice-cream business responses.
- `matchScenario(text)` (line 333) does keyword matching on the prompt.
- **Zero** `fetch(`, **zero** `useChat`, **zero** `streamText`, **zero** `EventSource`, **zero** `localStorage`, **zero** `api/` calls.
- `ChatComposer` reveals canned messages on a timer (`messages` prop, "scripted agent replies revealed in sequence after the user sends").
- `package.json` has **no AI SDK dependency at all**.

So: **it is a fully functional chat *interface* — layout, scroll, streaming animation, reasoning states, tool chips, approval flow, responsive shell — and zero chat *backend*.** Your brief already says this ("Its scripted behavior must be replaced with real model calls, persisted messages, wallet integration, and application-level transaction state"), which is correct and important. Budget accordingly: **you own 100% of the data layer.** The UI layer is a genuine head start, not a shortcut.

### 4.3 What the primitives actually expose (for your adapter layer)

Every primitive is prop-driven with sensible defaults — you can wire them to real data without forking the component source. The defaults are hardcoded demo data, but the props are real:

| Primitive | Props that matter | Hardcoded default you must override |
|---|---|---|
| `StreamingText` | `tokens: StreamingToken[]`, `sources: StreamingSource[]` | demo tokens |
| `ThinkingState` | internal `Row[]` | reasoning rows |
| `ToolChips` | `steps: ToolStep[]` (`icon`/`label`/`chip`/`detail`), `diffs`, `diffLines` | code-diff demo rows |
| `TaskRows` | `rows: TaskRow[]` → `{ key, label, amount, status: "done"\|"running"\|"sequence", step?, details: {label,meta}[] }` | task demo rows |
| `ApprovalCard` | `questions: ApprovalQuestion[]` (`q`/`type: radio\|check`/`options`), `labels`, `onSubmitted`, `onAnswerChange` | 3 ice-cream questions |
| `ChatComposer` | `messages`, `suggestions`, `labels`, `onSend` | 2 canned messages |
| `PromptBar` | `placeholder`, `onSend`, `demo`, `tall` | model picker + glimm shader |
| `RecordsTable` | 1,052 LOC, full table | demo rows |
| `InsightCards` | `liveline` series | demo series |

**Note on `ApprovalCard`:** despite the name, it is a **multi-step questionnaire** (radio/check questions, one at a time, auto-advance, odometer counter). It is *not* an approve/reject action card. A finance approval needs a different component — see §6.

---

## 5. Corrections to the brief (line-by-line)

| Brief says | Reality | Action |
|---|---|---|
| "NEAR Connect is the current candidate" | Package is **`@hot-labs/near-connect`** — the unscoped `near-connect` is a **404**. Framework-agnostic TS class; React bindings are the separate `near-connect-hooks`. npm `0.11.4` (May 2026) vs GitHub `v0.11.5` (Oct 2026) — a ~5-month publish lag, so pin and expect lag. Repo is `azbang/near-connect`. | Rename. Add `near-kit`. |
| — | near-connect's real API: `connect()` / `disconnect()` (there is **no** `connector.signIn`/`signOut`), `wallet()`, `switchNetwork()`, `signAndSendTransaction(s)`, `signMessage`, `signDelegateActions`. **`signTransactions` does not exist** — there is no sign-only transaction method; `signTransaction` is only a boolean manifest feature flag. | Use the real API surface. |
| — | `near-wallet-selector` (the legacy choice) is **explicitly deprecated** and dormant — last commit Dec 2025, ~20 weekly downloads vs near-connect's ~3.2k. | near-connect is the right call. Confirmed. |
| "Sign the appropriate transaction … wallet signs" | Confirmed working. The key never leaves the wallet; the wallet signs and broadcasts. | No change. |
| — | near-connect has **no mainnet wallet filter** — `availableWallets` only filters on `testnet`, so wallets declaring `testnet: true` (Nightly, WalletConnect, Unity, Intear) still appear on mainnet. The manifest's `mainnet: true` flag is decorative. | Don't use it as a safety filter. |
| — | `signMessage` gaps: **Trezu** and **Ethereum Wallets** do not implement it. **Sender** is absent from the manifest despite the docs listing it. **Hana** lacks one-shot sign-in. Sweat Wallet appears in neither list. | Gate your auth flow on the `signMessage` feature flag. |
| "Wallet authentication … verify the signature server-side" | `near-api-js` v7 moved NEP-413 to a **subpath export**: `import { verifyMessage } from "near-api-js/nep413"` — *not* from the package root. `verifyMessage` additionally throws unless the signing key is a **FullAccess** key on-chain. | Use the subpath, or use `near-sign-verify` (v0.4.5, MIT, ~595 dl/wk) which does recipient pinning + nonce-age validation for you. |
| — | ⚠️ **The official NEAR docs contain a live bug**: `nonce: Buffer.from(crypto.randomUUID())` produces **36 ASCII bytes**; NEP-413 requires exactly **32**. Correct: `crypto.getRandomValues(new Uint8Array(32))`. Also, `callbackUrl` must be reconstructed byte-identically at verify time **iff** the wallet signed with one — a mismatch silently breaks the hash. | Use 32 bytes. Test the MyNearWallet redirect flow explicitly. |
| — | There is **no security audit** of near-connect. Its README has a "background and future audit scope" section and links no report. Open bugs: manifest `platform` type mismatch (v0.11.x), "Invalid signature timestamp: future timestamp". | Assume unaudited. Budget a review if you're moving real value. |
| "Passkeys and social login excluded from the MVP" | Correct call, and now provably so: **NEAR Auth** (Auth0 + MPC + passkeys) is a **closed-access beta** requiring an approved Auth0 client id; `@near-wallet-selector/webauthn-wallet` has **3 weekly downloads**. | Keep excluded. Re-evaluate for 2027. |
| — | Gas budget: the brief's implied "1.25 TGas" is **stale**. Current protocol: **1000 TGas** per transaction (`max_total_prepaid_gas`) and per receipt (`max_gas_burnt`), ≤100 actions per receipt, plus a **gas refund fee** since protocol v78. | Attach ~100 TGas for a swap, don't over-attach. |
| "Vercel AI SDK" | **v7** (`ai` 7.0.148, `@ai-sdk/openai` 4.0.99). v4→v5→v6→v7 over Nov 2024 → Jun 2026. Requires **Node ≥22**, **ESM only**. | Pin v7 + zod v4. |
| — | **v7 breaking changes that will bite you:** `system:` → **`instructions:`**; `stepCountIs` → **`isStepCount`**; `fullStream` → **`stream`**; `onFinish` → **`onEnd`**, `onStepFinish` → **`onStepEnd`**; `convertToModelMessages` is now **async**; `experimental_output` → `output`; `experimental_customProvider` → `customProvider`. Codemod: `npx @ai-sdk/codemod v7`. | Apply the codemod on day 1. |
| — | ⚠️ **`stopWhen` defaults to `isStepCount(1)`** — a multi-tool agent silently stops after one tool round. You must set `stopWhen: isStepCount(N)` explicitly. | Set it. This is a silent failure, not a crash. |
| — | ✅ **v7 has native `toolApproval`** — per-tool `approved` / `denied` / `user-approval` with reasons, surfaced as approval-request/response stream parts. The brief's human-in-the-loop step can live *inside* the SDK. | Use `toolApproval` for the swap tool; don't hand-roll it. |
| "OpenAI API" | Current family is **GPT-6**: `gpt-6-astra` ($10/$50 per 1M), `gpt-6.1-sol` ($2/$10), **`gpt-6-luna` ($0.10/$0.50)**. `gpt-5.*` are previous-gen. A 500-in/500-out luna call ≈ **$0.0003**. | `gpt-6-luna` for volume, `gpt-6.1-sol` for the demo path that must be smart. |
| — | ⚠️ `gpt-6.1-sol` **does not support tool calling on Chat Completions** (Responses API only). `gpt-6-luna` supports function calling on Chat Completions **only with `reasoning_effort: "none"`**. AI SDK uses the Responses API by default since v5 — fine. | Don't mix up the endpoints. |
| — | ⚠️ **AI Gateway on Hobby is capped at 500 token-requests/month**, then $3.00/1,000. AI SDK v7 defaults string model IDs to the Gateway. | Use the **direct `@ai-sdk/openai` provider**, not `"openai/model-id"` strings. |
| "Next.js" | **16.4.2**. Turbopack is default for `next dev` **and** `next build`. `params`/`cookies()`/`headers()` are **async-only**. `middleware.ts` → **`proxy.ts`**. `next lint` removed. Node ≥ 20.9. | Plan for it; the design system is on 15, so check the App Router delta. |
| — | ⚠️ **Node version conflict:** Next 16 needs Node ≥20.9, **AI SDK 7 needs Node ≥22**. Pin `engines.node >= 22`, deploy on Node 24. | Set it on day 1. |
| "Vercel" hosting | Hobby caps functions at **300 s, and that includes streamed response time** — *"this includes time spent processing the request and sending the response, including streamed responses."* A long-lived SSE or in-request poller 504s mid-demo. `export const maxDuration` works but is clamped to 300 on Hobby. | Never poll 1Click status inside a Vercel Function for more than ~4 min. Move polling to a cron/worker. |
| "Supabase Postgres" | Free (Nano): **60 direct connections** (200 pooler clients, 200 Realtime concurrent), 500 MB DB, 5 GB egress, 50k MAU, 1-day log retention. **Projects pause after 1 week of inactivity.** Max 2 active projects. | Use the **pooler** (port 6543). Un-pause the project before the demo. |
| "Supabase Realtime" | Realtime *is* on free tier. But if all DB access goes through server route handlers with the service role, you don't need a client-side Supabase client at all — and RLS becomes moot for the browser. | Simplify: server-only DB access, skip Realtime unless you need live push. |
| "Inngest" | **v4** (4.25.0) with a **new API shape**: `createFunction({ id, triggers: [cron(...)] })`. Free: 50k executions/mo, 5 concurrent steps, 30-day max run length, **auto-pauses a function after 20 consecutive failures**, and a 5-step/min poller burns **216k executions/mo — blowing the free tier in ~5.7 days**. | For a 14-day build, **Vercel Cron (100 jobs/project on Hobby) + one route handler** is simpler and free. Keep Inngest only if you need real fan-out. |
| "Sentry or equivalent" | Developer (free) tier: **1 seat** (no teammates on the project), 5,000 errors/mo, 5 GB logs, 30-day retention. | Fine for solo. Use the **Team** plan if there's more than one of you. |
| "Swaps … evaluate NEAR Intents" | It's the *primary* path, not a maybe. It's the fastest thing to build (REST + no RPC) and it's what 6 of 13 tracks hint at. | Make it the default. |
| "Do not assume every NEAR function-call access key can authorize arbitrary token transfers" | Correct, and stricter than the brief implies: a function-call key is bound to **one `contractId` + `methodNames` + total `allowance`**, **cannot attach a deposit** (so no `ft_transfer`/`swap`), and its allowance governs *gas*, not transfers. | Tighten §9 to state the real constraint — and see §3.4 for the design that actually works. |
| "Autonomous execution … Future phase" | It's a scored track (`security`) and it's the differentiator. | Promote to MVP. |
| "Expo + React Native, deferred" | No room in 14 days. | Delete. |
| "Security review budgeted separately" | With a $250K pool and AI judges, a 2-hour external review of the signing/policy path is cheap insurance. | Budget it. |
| "Inngest is the default candidate" | Fine, but see above — Vercel Cron is likely lower friction for the MVP. | Decide day 1; don't over-build. |

---

## 6. Components: reuse vs. build

### 6.1 Reuse from the design system (adapter-only, no forking)

| Primitive | Use it for |
|---|---|
| `StreamingText` | assistant message body, token streaming, source chips |
| `ThinkingState` | "reading balances", "fetching quote" reasoning states |
| `ToolChips` | tool-call chips → `get_balances`, `get_quote`, `prepare_swap` |
| `TaskRows` | **transaction execution timeline** (see 6.2 — it maps almost 1:1) |
| `PromptBar` | the composer (strip the model picker; keep `glimm` if you like the sweep) |
| `RecordsTable` / `FilterTable` | balances table, transaction history |
| `InsightCards` (+ `liveline`) | portfolio value chart |
| `ContextCards` | retrieved context / "what I used" |
| `CodeBlock` | quote JSON, receipts, debug |
| `LoadingState`, `GlideMenu`, `Button`, `Chip`, `ValuePill`, `StatusPill`, `EntityChip`, `Shimmer`, `StreamText` | atoms |
| `foundation` (CSS) | **the entire design foundation — install first, once** |

```bash
# 1) Foundation — do NOT use the registry payload (broken CSS). Copy from the repo:
#    copy app/globals.css from the design system's repository
#    → app/globals.css  (verified brace-balanced; 1551 lines; includes @theme, tokens, keyframes)
bun add shadow-plugin          # REQUIRED but undeclared by foundation.json

# 2) shadcn's standard helper, also NOT shipped by the registry:
#    lib/utils.ts  →  export function cn(...inputs) { return twMerge(clsx(inputs)) }

# 3) Then install components selectively, or copy the source files directly.
# DO NOT install: sidebar-nav  (paid icon dependency, aborts the install)
# SKIP unless needed:      prompt-bar (glimm/WebGL), selection-actions (iconoir),
#                          records-table (its CSS is broken — copy from repo globals.css)
```

### 6.2 Build our own (12 components)

All on the same foundation — same tokens, same radii, same shadows, same motion language. You get visual coherence for free.

| # | Component | Why it can't be a the design system primitive |
|---|---|---|
| 1 | **`AppShell` + `Sidebar`** | the design system's `SidebarNav` is license-blocked. Ours: Tabler Icons, chat-thread list, wallet badge. |
| 2 | **`WalletButton` / `AccountBadge`** | Connected account, network badge, disconnect. Not in the kit at all. |
| 3 | **`SwapQuoteCard`** | The core finance component. Origin/dest asset with icons, amount in → out, min-out, slippage, **rate**, **fees (`refundFee`/`withdrawFee`)**, **deadline countdown**, price impact. |
| 4 | **`TxApprovalCard`** | `ApprovalCard` is a *questionnaire*. Ours: approve/reject bound to the exact quote parameters (correlationId + deadline + amounts), with a "params changed → re-approve" invalidation state. |
| 5 | **`TxStatusTimeline`** | Wraps `TaskRows`. States: `quoted → approved → submitted → deposit_confirmed → processing → settled \| refunded \| incomplete_deposit \| failed`. `TaskRows`' `status: "done"\|"running"\|"sequence"` + `step` maps cleanly. |
| 6 | **`AgentLimitsPanel`** | The `security` track's money shot. Per-tx cap, daily cap, allowed assets, allowed destinations, expiry, **remaining allowance**, **intents-ledger balance**, agent-key status, and a live **revoke** button (`remove_public_key`). |
| 7 | **`BalanceList`** | Per-asset balances + USD value, using `/v0/tokens` prices. Distinguishes **on-chain balance** vs **intents.near ledger balance** (two very different things — most apps will confuse them). |
| 8 | **`IntentBalanceCard`** | `intents.near` ledger balance + pending swaps + agent-key registration state. |
| 9 | **`ChatTranscript`** | Real message list with persistence and reconnect. `ChatComposer` is a scripted reveal. |
| 10 | **`FeeBreakdown` / `RiskBadge`** | Fee + slippage disclosure; "high slippage / high fee" warning badge. Finance UIs are judged on this. |
| 11 | **`AgentKeyBadge`** | Shows whether the agent key is registered with the Verifier, what it is scoped to, and when it was last used. It makes the security story *legible* to a judge in one glance. |
| 12 | **`VerificationBadge` + `AttestationPanel`** | ⭐ **The thesis component.** Shows: the model that answered, its TEE attestation (NVIDIA NRAS GPU + Intel TDX CPU + `signing_address`), and — for the swap decision — the chat signature (`{model_id}:{req_hash}:{resp_hash}`) with a verified ✅. One glance should tell a judge *"this was computed inside a real enclave and I can check it."* |

### 6.3 The layer mapping (from the brief's §4 tools → real implementation)

```
get_wallet_balances   → RPC ft_balance_of (NEP-141) + /v0/account/balances
get_supported_assets  → GET /v0/tokens
get_quote             → POST /v0/quote  (dry:true)
prepare_transaction    → POST /v0/quote  (dry:false) → depositAddress + deadline
                       → or POST /v0/generate-intent → NEP-413 payload → wallet signs
get_transaction_status → GET /v0/status?depositAddress=...
get_transaction_history→ /v0/account/balances + Explorer API
```

---

## 7. Corrected transaction pipeline (this is the biggest rewrite)

The brief's §5 assumes *wallet signs a transaction → chain settles → read receipt*. For NEAR Intents the truth is:

```
1. AI requests swap  → server validates params (asset allowlist, amount cap, deadline)
2. Server: POST /v0/quote { dry: true }        → price, minOut, fees, timeEstimate
3. UI: SwapQuoteCard renders it; user approves
4. Server: POST /v0/quote { dry: false }       → depositAddress, deadline (server-set ~72h)

── PATH A: on-chain deposit (wallet prompt required) ──
5a. wallet signs ft_transfer(USDC → depositAddress)   ← PAYABLE, so it ALWAYS
                                                          needs a full-access key
    → POST /v0/deposit/submit { txHash, depositAddress, nearSenderAccount }
    → poll GET /v0/status → SUCCESS | REFUNDED | INCOMPLETE_DEPOSIT | FAILED

── PATH B: signed intent (no gas, no on-chain tx) ──
5b. POST /v0/generate-intent { type:"swap_transfer", standard:"nep413",
                               signerId, depositAddress }        (needs X-API-Key)
    → wallet signs the NEP-413 payload OFF-CHAIN   (signMessage, no deposit needed)
    → POST /v0/submit-intent { signedData }  → intentHash
    → poll GET /v0/status

6. Settlement authority = the 1Click status API.
   The NEAR receipt proves only YOUR DEPOSIT — never the swap.
```

**Consequences for the brief:**
- §7's state machine gains `deposit_confirmed` and `processing` between `submitted` and `completed`, and its terminal set becomes `settled | refunded | incomplete_deposit | failed`.
- "Never mark success because the RPC returned HTTP success" → now "**never mark success because the deposit tx succeeded**" — the deposit succeeding is not the swap succeeding. This is a sharper version of the brief's own principle 4.
- The brief's `needs_reconciliation` state maps to: deposit confirmed but status API stuck in `PROCESSING` past `timeEstimate` → poll with backoff, alert.
- **Inngest's job shrinks**: it is now a *status poller*, not a settlement verifier. Much simpler. And remember the **300 s Vercel Hobby ceiling** — don't poll inside a request handler for more than ~4 minutes.
- Path B is strictly better UX (no gas, no deposit, no on-chain tx visible) — and it is the only path that makes the bounded-agent design possible.

### The bounded-agent variant, corrected

The agent never holds the user's main key. It holds its **own** key, scoped three ways:

```
Agent key on-chain (NEAR):
  function-call access key → contractId "intents.near", methodNames ["add_public_key"]
  ⇒ the agent key cannot touch the user's main-account tokens AT ALL.
    (and function-call keys can't attach deposits, so it can't even call ft_transfer)

Agent key in the Verifier registry (intents.near):
  add_public_key(agent_pubkey)  ⇒ the Verifier will accept the agent's signatures
    for this account. Revoke with remove_public_key → provable, on-chain, immediate.

Agent key in YOUR policy engine:
  per-tx cap · daily cap · asset allowlist · destination allowlist · expiry
  ⇒ the numeric limit is enforced by your server, and logged for audit.
  The agent signs only intents your policy already approved.
```

**Funds are sandboxed.** The user's USDC sits in the `intents.near` **ledger**, not in the main account. The agent key can only move *ledger* balances via signed intents. The user's main-account tokens are structurally out of reach.

**Honest framing for the README/judges:** the on-chain guarantees are **isolation, revocability and expiry**; the **numeric spend cap** is a policy engine you enforce and can prove with an audit log. Do not call the backend check an "on-chain spending limit."

**MVP ordering:** ship Path B + the agent key + the policy panel. Path A (on-chain deposit) is the fallback for users who don't hold an `intents.near` balance yet — it's a one-time on-ramp, and the agent path is the product.

---

## 8. Revised 14-day plan

**Oct 22 → Oct 31 (prep, 10 days).** Not idle time — this is where the brief's Phase 1 happens.
- ☐ **NEAR AI Cloud**: account at `cloud.near.ai`, add credits, generate API key. Get the **attestation + chat-signature flow running end to end** (`nearai/nearai-cloud-verifier`, `near-examples/nearai-cloud-verification-example`) **before you write UI**. If verification is hard, find out now, not Nov 12.
- ☐ **1Click partner API key** (`partners.near-intents.org`) — 0.01% fee on stablecoin pairs, and **required** for `/v0/generate-intent` + `/v0/submit-intent`.
- ☐ **WalletConnect `projectId`**.
- ☐ Prize-payout NEAR account (named, e.g. `myntle.near`) + ~5 NEAR gas + a small USDC position for demo swaps.
- ☐ Scaffold Next 16 + React 19.3 + `ai@7` + **NEAR AI provider** (`createOpenAICompatible`, baseURL `https://cloud-api.near.ai/v1`) + zod 4. `engines.node >= 22`, deploy Node 24.
- ☐ Test **tool calling** on your actual agent prompts against `openai/gpt-6-luna` and `Qwen/Qwen3.8-27B` via Chat Completions. Pick the winner.
- ☐ the design system: copy `app/globals.css` from the repo (**not** the registry payload), `npm i shadow-plugin`, add `lib/utils.ts`, install primitives selectively.
- ☐ `npx skills add near/agent-skills --skill near-intents --skill near-ai-cloud --skill near-dapp --skill near-api-js`
- ☐ Write the README skeleton **now**, in "do X → see Y" form, with the **"Verify it yourself"** section. AI judges read it.

**Nov 1–4 — Phase A: the spine + the thesis (submittable on its own).**
- Wallet connect via `@hot-labs/near-connect` + `near-connect-hooks`; NEP-413 sign-in → session (`near-sign-verify` or `near-api-js/nep413#verifyMessage`; 32-byte nonce; feature-gate on `signMessage`).
- Chat against **NEAR AI Cloud**, streaming into `StreamingText`. **Set `stopWhen: isStepCount(N)`** or the agent stops after one tool round.
- Tool calls → `ToolChips`; balances → `BalanceList`; quote → `SwapQuoteCard`. Use **`toolApproval`** so the human-approval step lives in the SDK.
- **`VerificationBadge` + `AttestationPanel`** live in the transcript. Model attestation + (for the swap decision) the verified chat signature.
- Persist conversations/messages to Postgres (Supabase pooler, port 6543).

**Nov 5–8 — Phase B: the money path (Engine A first).**
- **`SwapService` interface with two engines.** Engine A = RHEA/Ref: `get_return` quote → `ft_transfer_call` → `swap` → verify `FINAL` + every receipt. Engine B = NEAR Intents: `generate-intent` → NEP-413 → `submit-intent` → poll `/v0/status`.
- **Asset detection**: which USDC does the user hold, and which engine supports it? Show the contract ID and route in the UI.
- **One-time setup step**: detect missing storage deposits (`storage_balance_of`) and guide / auto-fund them.
- Fee + slippage + **server-returned** deadline countdown. Label output as **wNEAR**, with an optional unwrap.
- Capture the exact request/response bytes for the swap-decision call → verify → attach the receipt to the transaction record.

**Nov 9–11 — Phase C: the differentiator.**
- `AgentLimitsPanel` + agent key: create (function-call scoped to `intents.near.add_public_key`), register via `add_public_key`, show the policy (per-tx / daily cap, asset + destination allowlists, expiry), show live allowance + intents-ledger balance, one-click **revoke** (`remove_public_key`).
- The agent executes **within** the limit without a per-tx prompt; it **stops and asks** when it would exceed the limit.
- The demo moment: the agent hits its own ceiling and says so — and you revoke it live, on-chain.
- Cross-chain route (Intents) goes live here: USDC from Base / Arbitrum / Solana → NEAR.

**Nov 12–13 — Phase D: harden + demo.**
- Refresh / reconnect / duplicate-submission / timeout / reconciliation tests. **Never poll inside a Vercel Function past ~4 min** (300 s Hobby ceiling) — use Vercel Cron (100 jobs/project free) or a worker.
- Sentry, rate limits, redaction, RLS/ownership checks.
- Write the README **"Verify it yourself"** section with three paste-able commands.
- Record the demo video. **Record early, re-record if you improve.**

**Nov 14 — Submit.** Repo public + X post live + form (one shot; a 409 on project name or email kills it).

---

## 9. Decisions — locked in

| Decision | Your call | What it means |
|---|---|---|
| **Provider** | **NEAR AI Cloud** (OpenAI-compatible, TEE, verifiable) + NEAR Intents | The AI layer becomes *provable*, not just private. Leads with `privacy`. |
| **Autonomy** | **Human approves every swap first**; autonomous-within-limits introduced later | MVP = `toolApproval` on the swap tool, wallet signs every execution. The agent key + policy engine is Phase C (Nov 9–11), not a rewrite — the signed-intent path is identical, only the *signer* changes. |
| **Scope** | **Build the full presentable product — optimize for winning, not for effort** | All 12 custom components. No cutting. |
| **Swap engine** | **Two engines behind one `SwapService` interface** | Engine A = RHEA/Ref on-chain (demo-safe, deterministic). Engine B = NEAR Intents (cross-chain + the agent's signed-intent path). Engine A first, Engine B in Phase C. |
| **Tracks** | `privacy` + `security` + `agents` (+ `defi` if it fits) | README leads with *"a verifiable finance agent"*: TEE-attested AI → human/bounded authorization → verifiable settlement. |

### Why two engines rather than Intents-only

You picked NEAR Intents, and it should stay — but Intents has a **relayer dependency** (a solver must fill; otherwise `REFUNDED` / `INCOMPLETE_DEPOSIT`), a **20–25 bps platform fee**, and it only understands **Intents-USDC** (`17208628…`), which **no Ref pool lists**. Meanwhile Ref/RHEA is fully on-chain with deterministic failure semantics and 0.30% LP fee.

For a live demo in front of judges, *"the swap is provably on-chain and I can verify it myself"* beats *"it's cross-chain"* — especially when the brief's own stated principle is already *"a transaction's actual blockchain outcome determines its status, not the AI's response."* Engine A *is* that principle, literally.

So: **Engine A is the promise; Engine B is the superpower.** Show both in the UI, label which route a given balance supports, and let the judge pick. That is a stronger product than either alone — and it's exactly what the brief's *"keep protocol integration behind a TypeScript service interface"* line was asking for.

### Prep-week tasks this creates (Oct 22 → Oct 31)

- ☐ Create a **NEAR AI Cloud** account at `cloud.near.ai`, **add credits**, generate an API key. (Pay-as-you-go; no free tier mentioned — budget ~$25–50.)
- ☐ Request a **1Click partner API key** at `partners.near-intents.org` — 0.01% fee on stablecoin pairs, and **required** for `/v0/generate-intent` + `/v0/submit-intent`.
- ☐ Get a **WalletConnect `projectId`**.
- ☐ Create the prize-payout NEAR account (named, e.g. `myntle.near`) and fund it: ~5 NEAR gas + **both** USDC flavours for demo swaps (Rainbow USDC.e for Engine A, Intents-USDC for Engine B). Also pre-register the storage deposits on the demo account so the first swap doesn't need two setup txs mid-demo.
- ☐ **Prove the plumbing with a 0.001 Ⓝ self-transfer first.** Cheapest possible on-chain tx; it catches 90% of integration bugs (RPC, key, finality, receipt inspection) before you touch a swap.
- ☐ Clone `nearai/nearai-cloud-verifier` and `near-examples/nearai-cloud-verification-example` and get the attestation flow running **before** you write any UI. If verification is hard, you need to know now, not on Nov 12.
- ☐ Confirm which model to use for the agent path: `openai/gpt-6-luna` (tool-capable, $0.10/$0.50) vs `Qwen/Qwen3.8-27B` (tool-capable, $0.04/$1.35). Test tool-calling on the Chat Completions endpoint with your actual prompts before committing.
- ☐ Pin the RPC: `https://free.rpc.fastnear.com` + `https://rpc.fastnear.com` in a `FailoverRpcProvider`. **Not** `rpc.mainnet.near.org` (deprecated, throttles) and **not** `near-mainnet.public.blastapi.io` (dead).

### What this implies for the build order

The **verifiable** parts should be first-class, not a bolt-on, because they are the thesis:

1. `VerificationBadge` / `AttestationPanel` — show the model attestation (NVIDIA NRAS + Intel TDX + `signing_address`) and, for the swap decision, the chat signature, in the UI. **This is the screenshot that wins.**
2. The swap card must show, side by side: the quote, the AI's recommendation, the model's attestation, and the human approval — so a judge can see the whole chain in one image.
3. The README must have a "**Verify it yourself**" section: three curl commands a judge can paste that independently confirm (a) the model ran in a real TEE, (b) the recommendation came from that enclave, (c) the swap settled on-chain. **This is what an AI judge will actually do.**

---

## 10. What I'd change in the brief, concretely

1. **Delete Phase 5 and mobile.** Phase 5 becomes Nov 9–11, not "someday".
2. **Rewrite §5 "Submission and verification"** around the deposit-address + relayer model; the authority is the 1Click status API, and a successful deposit is *not* a successful swap.
3. **Rewrite §7's state machine** to include `deposit_confirmed` / `processing` and the Intents terminal states (`settled | refunded | incomplete_deposit | failed`).
4. **Rename** "NEAR Connect" → `@hot-labs/near-connect`; add `near-kit`, `near-connect-hooks`, `near-api-js`. Fix the API list (`connect()`/`disconnect()`, and **there is no `signTransactions`**).
5. **Fix the auth verification API**: `near-api-js/nep413#verifyMessage` (subpath export) or `near-sign-verify`. The `utils.formatNearSignMessage` / `utils.verifySignature` names in circulation come from a **stale 2024 example repo** and do not exist in near-api-js.
6. **Swap the AI provider to NEAR AI Cloud** (`createOpenAICompatible`, baseURL `https://cloud-api.near.ai/v1`) and add the **model attestation + chat signature** as a first-class feature, not a footnote.
7. **Pin** AI SDK v7 + zod v4, Next 16, React 19.3, Node ≥22. Apply the v7 codemod (`system:`→`instructions:`, `stepCountIs`→`isStepCount`, `fullStream`→`stream`, async `convertToModelMessages`).
8. **Set `stopWhen: isStepCount(N)`** explicitly and use `toolApproval` for the swap tool.
9. **Model:** `openai/gpt-6-luna` (tool-capable, $0.10/$0.50) or `Qwen/Qwen3.8-27B` ($0.04/$1.35). **Avoid `gpt-6-astra` / `gpt-6.1-sol`** — no tool calling on Chat Completions. Use the **direct provider**, not Vercel AI Gateway (Hobby Gateway = 500 requests/month).
10. **Add a fees line** to the approval card spec (`refundFee` / `withdrawFee` are in every quote response).
11. **Add `appFees` + `referral`** to the deployment plan — you're leaving money on the table, and it's 3 lines of code.
12. **Add the README-as-deliverable** task with a Nov 12 internal deadline, including the **"Verify it yourself"** section (three paste-able curl commands).
13. **Change the UI library rule** to: *"copy `app/globals.css` from the repo (not the registry payload), `npm i shadow-plugin`, add `lib/utils.ts`, install N primitives; never install `sidebar-nav`; build our own shell."*
14. **Add the 12 custom components** as an explicit work item with the mapping table from §6.
15. **Add a Vercel constraint:** no streaming or polling request may exceed ~300 s on Hobby; use Vercel Cron (100 jobs/project, free) for status polling.
16. **Add a Supabase constraint:** use the pooler (6543), 60 direct connections max, and un-pause the free project after the 1-week inactivity pause.
17. **Tighten §9's access-key language** to the real constraint: function-call keys are one-contract, one-method, **non-payable** — they cannot drive `ft_transfer` or a swap at all — and the numeric spend cap is a backend policy, not an on-chain one.
18. **Add the TEE verification caveats** to the security section: streaming responses end with **two newlines** (include them in the response hash), and `signature_kind` must be `provider_tee` vs `gateway` matched correctly.
19. **Pin the asset, not the ticker.** Replace every `"USDC"` with an explicit contract ID. **`usdc.near` and `nusdc.near` do not exist.** There are at least three real USDCs on NEAR mainnet — **USDC.e** (`a0b86991…factory.bridge.near`, Rainbow; the one RHEA pools use) and **Intents-USDC** (`17208628…`, the one 1Click uses) — and **they share no liquidity**. The UI must show the contract ID and the route.
20. **Add the swap-engine interface + two engines.** `SwapService` with a RHEA/Ref implementation (on-chain, deterministic, no relayer) and a NEAR Intents implementation (cross-chain, signed-intent path). The brief's "keep protocol integration behind a TypeScript service interface" line is now load-bearing.
21. **Add the on-chain gotchas to the spec:** output is **wNEAR**, never native NEAR (add a `near_withdraw` step or label it); **two one-time storage deposits** (~0.11 Ⓝ) before a user's first RHEA swap — pre-flight with `storage_balance_of`; **never price off `get_pools`** (inconsistent across pools — use `get_return` only); check **every receipt's** `outcome.status`, not just the outer tx; attach **300 TGas**, not 1000.
22. **Fix the RPC config.** `https://free.rpc.fastnear.com` primary + `https://rpc.fastnear.com` backup in a `FailoverRpcProvider`. `rpc.mainnet.near.org` is deprecated and throttles under load; `near-mainnet.public.blastapi.io` is dead though still in the docs.
23. **Update the near-api-js API references.** v7 removed `keyStores` / `connection` / `Action.functionCall` / `InMemorySigner` and the built-in keystores. Use `new Account(id, provider, keyPairString)` + `actions.functionCall({methodName, args, gas, deposit})`.
24. **Note the RPC response encoding.** `EXPERIMENTAL_call_function` returns `result` as a **raw byte array**, not base64 — `Buffer.from(result)`, not `Buffer.from(result, "base64")`.
25. **Consider NEP-366 meta-transactions** (`createSignedMetaTransaction({receiverId, actions, blockHeightTtl})`) — the user signs once, your relayer submits and pays gas. A cleaner "the AI can act, the user signed once" story, and a complement to the Intents agent key.

---

### Two corrections I made to my own analysis mid-report

For transparency, since both were load-bearing and I initially got them wrong:

1. **I first proposed a function-call access key with a hard `allowance` as the agent's spend cap.** That is impossible — function-call keys **cannot attach a deposit**, and `ft_transfer`/`swap` are payable. The working design (§3.4) routes through the Intents Verifier's own key registry instead, which is *better*: it gives on-chain isolation, on-chain revocation and on-chain expiry.
2. **I initially wrote that the 1Click `deadline` field is "server-set to ~72h."** More precisely: the API **ignores a client-supplied `deadline` and returns its own (~72 h in the live response)**. Either way — always use the returned value, never your own. And `depositType` / `recipientType` / `refundType` / `deadline` are **required** by the live API despite the docs marking them optional.

### Verification method note
Everything marked ✅/🔴/🟡 was checked against primary sources: **live HTTP calls** to the 1Click API (`/v0/tokens`, `/v0/quote` with both `dry` values and both `depositType`s), `npm view` for every package version and license, the the design system source **cloned and read line by line** plus **brace-counting the live registry payloads**, `nearhackathon.com` and its `HACKATHON.md`, `docs.near-intents.org` (quote / status / signed-intent / verifier / account-abstraction), the AI SDK v7 `streamText` reference, and NEAR's own `near/agent-skills` repository.

**Areas I'd still verify before locking the deployment plan:** the exact Supabase/Vercel/Inngest free-tier numbers (sourced from vendor pricing pages, not exercised), and the OpenAI GPT-6 model IDs and pricing (from `platform.openai.com/docs/pricing`, not from a live billed call).
