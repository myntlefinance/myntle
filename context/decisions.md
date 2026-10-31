# Decision log

Each entry records what was decided, why, and what would change it. These are the decisions a future reader is most likely to question, so the reversal conditions matter more than the reasoning.

## The AI provider is NEAR AI Cloud, not OpenAI

**Decided.** The provider is NEAR AI Cloud at `https://cloud-api.near.ai/v1`, reached through the OpenAI-compatible provider in the AI SDK.

**Why.** It speaks the same API shape, so nothing in the AI layer is harder than it would be with OpenAI, and it runs inference inside a confidential environment on hardware whose attestation can be checked. On a NEAR hackathon that is the difference between a project that uses the ecosystem and a project that merely targets it. It also lines up with the privacy and security tracks, which are scored.

**It is not a cost decision.** The catalogue prices the flagship models identically to OpenAI direct. The reason to use this provider is the environment the inference runs in, not the invoice.

**Reverses if.** The provider cannot do tool calling reliably for the chosen model, or the credits run out during the build. In that case the provider changes and nothing else does, because the tool registry and the approval policy are provider-independent.

## Two swap engines behind one interface

**Decided.** The application supports the RHEA exchange and the NEAR Intents protocol, behind a single `SwapEngine` interface.

**Why.** They do not share assets. The RHEA pools list the Rainbow-bridged USDC, and the 1Click catalogue contains a different USDC contract entirely. A user holding one cannot spend it through the other's route. Supporting only one means that half of the potential users see a balance they cannot use.

The RHEA engine goes first because it is fully on-chain. There is no market maker in the loop, so a swap either completes or reverts, and if it reverts the input token is still in the exchange and can be withdrawn. For a live demonstration in front of people who cannot be asked to wait, that determinism is worth more than the cross-chain capability.

**Reverses if.** The schedule collapses. Then Intents ships alone, and the interface is designed so that this is a matter of deleting a file rather than rewriting the chat layer.

## The human approves every transaction in the first release

**Decided.** The assistant may propose a swap, and a person approves it before anything is signed. Bounded autonomous execution arrives later.

**Why.** It is the credible story. An assistant moving money without a check reads as reckless to a security jury even when the limits are sound, and a demonstration that moves a stranger's funds without asking is the kind of thing that ends a submission.

**Reverses if.** Never, for the first release. The autonomy work in phase C adds an execution mode rather than replacing this one.

## The numeric spending limit is enforced in application code

**Decided.** The agent's key is registered with the verifier so that it can sign intents, and a policy engine in the application decides which intents it may sign. The chain enforces the isolation, the revocability, and the expiry.

**Why.** A function-call access key cannot attach a deposit, and every token transfer and every swap is payable, so a function-call key can never move tokens directly. Its allowance governs gas rather than transfers. The verifier's key registry is the only mechanism that lets a scoped key sign a value-moving intent, and a registered key can sign any intent the account is entitled to. There is no on-chain spending limit available here.

**Reverses if.** A contract is written that holds the limit. That is a larger project than a hackathon, and the policy engine plus the audit log is the honest answer for now.

**Never to be described otherwise.** The isolation, the revocability, and the expiry are on-chain. The spending cap is not. Describing a backend check as an on-chain limit would undermine every other claim in the readme.

## The approval is bound to the stored quote, not to the client payload

**Decided.** The server recomputes the parameters before signing and compares them against the quote it recorded when the approval was requested.

**Why.** The client resubmits the whole conversation on every turn, so a modified client could fabricate an approval. The SDK's approval secret lets the server verify that it issued the approval, and that only helps if the approved parameters come from the server's own record rather than from the client's message.

**Reverses if.** Never. This is the difference between a demonstration and a product.

## The read-only tools are the majority of the tool registry

**Decided.** Five read-only tools and one write tool, and no generic signing or generic RPC tool at all.

**Why.** The original brief got this right and it is worth keeping. A model that can call an arbitrary contract method is a model with a signing capability, whatever the tool is called.

**Reverses if.** Never.

## The interface is the transcript, and the dashboard is later

**Decided.** The first release has a conversation, a quote card, an approval card, and a transaction timeline. There is no portfolio page and no settings screen.

**Why.** The conversation is the product. A separate dashboard would be a second interface competing with the first one, and building it well would cost the time that the money path needs.

**Reverses if.** The build finishes early. The portfolio view is the first thing to add.

## The design system is used for the foundation and a selected set of primitives

**Decided.** The foundation stylesheet is copied from the repository rather than from the registry, and the primitives are installed individually. The sidebar is not.

**Why.** The published registry payload has unbalanced braces, and Tailwind refuses to compile it. The sidebar depends on a paid icon package whose install script aborts without a licence key, and the project's icon set is Tabler anyway.

**Reverses if.** The upstream issue about the stylesheet is fixed and the registry payload is regenerated. Checking is cheap, so check before installing.

## The multi-step bound is set explicitly

**Decided.** Every call sets `stopWhen: isStepCount(N)`.

**Why.** The default is one step, which ends the agent after a single tool round. The failure is silent, because nothing throws and the transcript simply stops, so it is easy to miss during a build and embarrassing in a demonstration.

**Reverses if.** Never. It is a one-line change with no downside.

## The RPC provider is the fastnear pair

**Decided.** `https://free.rpc.fastnear.com` as the primary and `https://rpc.fastnear.com` as the backup, inside a failover provider.

**Why.** The endpoint that most tutorials use, `rpc.mainnet.near.org`, answers light calls but is deprecated and returns rate limits under load. Another endpoint that the documentation still lists does not resolve at all.

**Reverses if.** A paid provider with a guaranteed quota is added.

## The project targets the privacy, security, and agent tracks

**Decided.** Submit against `privacy`, `security`, and `agents`, with `defi` added if the work supports it.

**Why.** The three together describe one product rather than three ambitions. The provider answers the privacy track, the agent key and the policy engine answer the security track, and the swap service answers the agent economy track.

**Reverses if.** The bounded agent does not get built. In that case the submission leads with `privacy` and `defi`, because there would be no security work to show.

## The wallet layer supports EVM, Solana, and NEAR from the first release

**Decided.** The user connects a wallet from any of three ecosystems, and the same conversation works for all of them. Every trade settles through NEAR Intents.

**Why.** The earlier plan assumed a NEAR wallet, which meant a judge at the hackathon would have needed a NEAR account and gas before trying anything. That is several minutes and a faucet, and it is the single largest risk to a live demonstration.

NEAR Intents removes the problem. A user signs a message with a wallet they already have, and the settlement happens inside the verifier contract. No NEAR account, no gas, no waiting. The verifier already speaks ERC-191 for EVM wallets, raw Ed25519 for Solana wallets, and NEP-413 for NEAR wallets, and the signing formats are the only thing that differs between them.

**What it costs.** The application has to know which chain a user is on, because the same ticker means different contracts on different chains, and because the account the verifier knows is derived from the public key, so the same wallet on two chains is two accounts. Every address in the database sits next to its chain.

**The agent's key survives the change.** A public key can be added to an account through a signed intent, so a user on any chain can register the agent's key, and the agent then signs intents under it. The key has to match the curve of the account.

**Reverses if.** The signed-intent path proves unreliable in testing, in which case the on-chain deposit path works for every chain as well, at the cost of the user paying their own chain's gas.

## The RHEA exchange route is not built in the first release

**Decided.** NEAR Intents is the only settlement engine in the first release. The engine interface stays, so the RHEA route can be added back as a second implementation.

**Why.** The RHEA route was the better answer when the user had to be on NEAR anyway, because it settles entirely on the NEAR chain with no third party in the middle, and a reverted swap leaves the funds recoverable on chain. Once the user can arrive on any chain, that advantage applies to a minority of users, and it costs a great deal: two wallet transactions, two one-time storage deposits, a minimum-output check, and careful inspection of every receipt.

The Intents route costs one signature and no gas, on every supported chain.

**The honest cost of dropping it.** The settlement authority moves one step further away. With RHEA, the application read the outcome from the NEAR chain itself. With Intents, it reads the status endpoint, which reports the settlement that happened inside the verifier contract. The principle that the record decides the outcome still holds, but the readme should say that the application reads the settlement report rather than implying it reads the chain.

**Reverses if.** A user asks for a trade that settles entirely on one chain with no solver in the middle, which is the only case RHEA wins.

## Bun manages the packages and the local runtime, Node runs production

**Decided.** Bun 1.4.3 for installing, for development, and for the build. Vercel keeps Node 24.x as the production runtime.

**Why.** Bun is an officially verified Next.js adapter, and the whole stack was verified to build and run under it: the workflow lifecycle executes, the durable sleep resumes, and the route table is identical to a Node build. It is faster and the lockfile is text.

**Why Node in production.** Two open defects. A Bun bug means the async context is not restored in unhandled rejection handlers, which makes Next 16.4 log false client-hook errors during a build and leak a rejection per request, and the fix is not shipped in the current release. Separately, a Next 16.2 change means some routes are detected as Node and then fail with "Bun is not defined". Neither is our fault and neither is fixed today.

**Two traps that are easy to hit.** Do not set `"packageManager": "bun@…"`, because Corepack does not support Bun and Vercel reads that field through Corepack, so the build fails before anything else runs. Vercel detects the lockfile on its own. And do not rely on `engines` to enforce the Node version, because Bun ignores it, so the check belongs in CI.

**Reverses if.** The Bun defect ships and the Next issue closes, at which point `"bunVersion": "1.4.x"` in `vercel.json` turns it on.

## Solana uses the Wallet Standard, not the wallet adapter

**Decided.** The Solana adapter is `@solana/wallet-standard` and `@wallet-standard/app`, not `@solana/wallet-adapter`.

**Why.** The 0.19 line of the adapter and of every per-wallet package has been withdrawn from npm, so there is nothing to install at that version. The version 3 replacement requires React 19.3, and `@ai-sdk/react` excludes React 19.3, so the two cannot be installed together without a peer warning on the AI SDK's React bindings.

The Wallet Standard is what those wallets implement anyway, it has no peer dependencies, and for an address and a signed message it is all this application needs.

**Reverses if.** The AI SDK widens its React peer range to include 19.3, at which point the adapter is worth revisiting for the richer wallet list it provides.

## The durable engine is the Workflow SDK on the Vercel World

**Decided.** The transaction lifecycle runs as a workflow in the Workflow SDK, on the Vercel World, which is selected automatically because the application is already deployed to Vercel.

**Why.** The transaction lifecycle is the one part of the application that must survive a page refresh, a dropped connection, a redeploy, and a process crash while a user is deciding whether to approve a spend. A scheduled route handler only runs while the application is up, and it cannot hold an in-progress decision across a restart. The Workflow SDK co-locates the orchestration and the execution and replays from an event log, and the sleeping between status polls consumes no compute, which also solves the three hundred second ceiling on a free Vercel function.

**The Postgres World is the trap.** It looks free because the project already runs on Postgres, and the storage would work against Supabase. But it uses Graphile Worker, which needs a long-running process, and that process is the virtual private server this project does not have.

**Reverses if.** The application moves off Vercel, in which case the Redis World with Upstash and QStash is the portable option. The SDK is designed for exactly this, and the storage and the queue are swappable.

**The chat stays out of it at first.** The durable agent variant, `WorkflowAgent` from `@ai-sdk/workflow`, brings resumable streams and an approval that survives a restart, and it is worth having. It is not the first thing built, because the chat is what has to work on the first day and the workflow model adds concepts at exactly the moment there is least time to learn them. The swap lifecycle goes first because it is a small, well-bounded piece of work that teaches the model cheaply, and the chat moves later if the schedule allows. `context/durability.md` has the detail.

## Inngest was the previous choice for the durable engine

**Decided.** The Workflow SDK replaces it.

**Why.** Inngest works, and it was the earlier recommendation. It is an event-driven platform that invokes the application over HTTP, so the orchestration and the execution live in different places and the types cross a network boundary. The Workflow SDK co-locates them. The difference did not matter when the only durable work was a status poller, and it matters more now that the approval and the execution are part of the same object.

**Reverses if.** The work becomes genuinely event-driven rather than a poll, or fan-out across many parallel runs becomes the dominant pattern.

## Things that were considered and rejected

**Passkey and social sign-in.** NEAR Auth is in a closed-access beta that needs an approved client identifier, and the web-authn wallet module has three weekly downloads. Neither is a foundation for a build with a deadline.

**Chain signatures for a NEAR-native agent.** Chain signatures are for signing transactions on other blockchains from NEAR. They do not control a NEAR account and they do not solve the problem.

**An embedded wallet.** The brief excludes it, and excluding it is right, because the point of the product is that the user's own wallet holds the authority.

**A mobile client.** There is no room in fourteen days.

**Vercel AI Gateway.** The free allowance is five hundred token requests a month, which a single demonstration can exhaust, and the direct provider costs nothing extra.

**Inngest.** The status poller is a scheduled request, and a cron trigger on the same platform covers it with less machinery. This is worth revisiting if the work becomes event-driven rather than a poll.
