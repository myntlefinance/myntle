# Technical Architecture Brief — AI Finance Chat on NEAR **Status:** MVP architecture proposal **Target:** NEAR Hackathon, November 2026 
**Platform:** Web first; Android/iOS later **Primary goals:** Excellent chat UX, secure user-authorized transactions, durable execution, and 
a foundation for autonomous agents. ## 1. Product overview Build a browser-based AI finance application where users connect an existing NEAR 
wallet and interact with an AI assistant through natural language. Example: > Swap 100 USDC for NEAR. The assistant should understand the 
request, prepare an appropriate transaction or swap quote, display the details, obtain user approval through the wallet, execute the 
operation, and show the verified result. The application should feel like a modern AI chat product rather than a traditional DeFi dashboard. 
Users should be able to inspect balances, ask financial questions, prepare transactions, and monitor execution in a persistent conversation. 
### Product principles 1. The AI interprets intent but never independently determines its own permissions. 2. The wallet remains the 
authority for user-initiated transaction signing. 3. Conversations and transaction records survive refreshes and disconnections. 4. A 
transaction's actual blockchain outcome determines its status, not the AI's response. 5. Autonomous execution is a future capability, not a 
reason to compromise the initial security model. --- ## 2. Decisions made | Area | Decision | |---|---| | Frontend | Next.js, React, 
TypeScript | | UI library | BeautifulUI, MIT-licensed components | | Icons | Tabler Icons, MIT license | | AI provider | OpenAI API | | AI 
integration | Vercel AI SDK | | Wallet onboarding | Existing NEAR wallets only | | Wallet connector | NEAR Connect is the current candidate; 
validate production readiness and wallet coverage | | Passkeys and social login | Excluded from the MVP | | Embedded wallets | Excluded from 
the MVP | | Database | Supabase Postgres | | Realtime updates | Supabase Realtime | | Durable workflows | Inngest is the initial candidate | 
| Frontend hosting | Vercel | | Mobile apps | Expo + React Native, deferred | | Autonomous execution | Future phase | These are the selected 
or proposed defaults, not a claim that every provider integration has passed a production proof of concept. --- ## 3. Frontend and UI 
architecture ### Stack - Next.js with the App Router - React and TypeScript - BeautifulUI for chat and agent-oriented interface components - 
Tailwind CSS v4 - Tabler Icons via `@tabler/icons-react` - Zod for runtime validation of application data and tool inputs - TanStack Query 
for server-state fetching and cache management ### UI components to reuse Use BeautifulUI components where appropriate for: - Chat messages 
and streamed responses - Prompt input and conversation layout - AI thinking and tool-execution states - Approval cards - Task progress and 
transaction status - Data tables and insight cards - Sidebar navigation Build finance-specific components separately: - Wallet connection and 
active account - Token balance list - Swap quote and price-impact display - Transaction approval summary - Transaction history - Execution 
status timeline - Agent permissions and spending-limit settings, when introduced Reuse components selectively rather than forking the whole 
demo application. **Important:** BeautifulUI's Harness demo is a UI foundation, not the complete backend or transaction system. Its scripted 
behavior must be replaced with real model calls, persisted messages, wallet integration, and application-level transaction state. --- ## 4. 
AI chat architecture ### Stack - OpenAI API - Vercel AI SDK - Next.js server-side API routes - PostgreSQL for durable conversation history 
The model must be called from the backend. API credentials must never be shipped to the browser. ### Request flow 1. The user submits a 
message. 2. The backend authenticates the session associated with the connected wallet. 3. The server loads relevant conversation history and 
wallet context. 4. The AI model streams a response or requests a structured tool call. 5. The server validates tool inputs and checks 
authorization. 6. If a transaction is requested, the application prepares a transaction or quote. 7. The frontend renders a structured 
approval card. 8. The connected wallet signs the appropriate transaction or signing payload. 9. The application records the submission and 
monitors its outcome. 10. The chat displays the verified result. ### Tool design Expose narrowly scoped tools to the model, for example: - 
`get_wallet_balances` - `get_supported_assets` - `get_quote` - `prepare_transaction` - `get_transaction_status` - `get_transaction_history` 
Do not expose an unrestricted generic signing function to the model. The model should return structured transaction intent. Deterministic 
application code must validate it and construct the transaction using trusted integrations. ### Streaming and persistence Streaming and 
durability are separate concerns. - SSE or the AI SDK's supported streaming mechanism delivers response tokens. - PostgreSQL stores completed 
messages and durable application events. - The frontend can reconnect and reload persisted history after a browser refresh. - A stream 
interruption must not cause the user message or financial action to be executed twice. For the MVP, start with ordinary streaming and 
persistent messages. Add resumable streams only if the required UX justifies the extra infrastructure. --- ## 5. Wallet and transaction 
architecture ### Wallet integration Use an existing NEAR wallet connection. NEAR Connect is the candidate, but the final implementation 
should follow the currently supported official integration and confirm which wallets and signing operations it supports. The application must 
not store users' private keys. ### Wallet authentication Connecting a wallet establishes a public account address, but the application still 
needs a secure session. Use a wallet-supported sign-in challenge or signed-message flow: 1. Generate a cryptographically random, single-use 
nonce. 2. Bind the challenge to the application origin, wallet address, and expiry. 3. Have the wallet sign the challenge using a supported 
message-signing mechanism. 4. Verify the signature server-side. 5. Consume the nonce and issue an application session. 6. Apply appropriate 
expiry, logout, and revocation behavior. Do not accept a wallet address alone as proof of ownership. ### Transaction preparation and approval 
The transaction service must validate: - The connected account - The target network - The operation type - Contract address and method, where 
applicable - Token identifiers and amounts - Quote expiry and slippage constraints, where applicable - Required permissions - Transaction 
parameters shown to the user The approval UI must accurately represent what the wallet will authorize. Where the wallet signs a transaction, 
it must be that transaction—not merely a generic message that claims approval. ### Submission and verification Persist a transaction record 
before or during submission, as appropriate to the integration. Once the wallet returns a transaction identifier, record it and monitor the 
authoritative network or settlement status. Never mark an operation successful solely because: - The wallet popup closed - The RPC returned 
HTTP success - The AI stated that the transaction completed The application must verify the relevant execution result. --- ## 6. Database 
architecture ### Primary database: Supabase Postgres Suggested initial tables: | Table | Purpose | |---|---| | `users` | Internal user ID and 
account metadata | | `wallets` | Wallet address, network, and ownership association | | `sessions` | Application session metadata, if managed 
in the application database | | `conversations` | Conversation threads | | `messages` | User, assistant, and structured tool messages | | 
`agent_runs` | AI task and workflow execution records | | `transactions` | Transaction intent, state, network identifier, and verified 
outcome | | `approvals` | Approval records and references to the approved transaction parameters | | `outbox_events` | Durable events 
awaiting delivery to workers or other consumers | These are proposed schemas, not final migrations. ### Security rules - Use a stable 
internal user ID rather than using the wallet address as the primary key throughout the application. - Enforce ownership checks on every 
sensitive API operation. - Configure Row Level Security for client-accessible tables. - Do not expose service-role credentials to the 
browser. - Keep signing credentials outside the application database. - Never trust a client-supplied user ID as proof of ownership. - Record 
approval and transaction state transitions for auditability. Supabase Realtime is a notification mechanism. PostgreSQL remains the source of 
truth. --- ## 7. Durable execution and background workflows ### Initial candidate: Inngest Use a durable workflow service for work that must 
continue beyond the lifetime of a web request. Examples: - Monitor submitted transactions. - Check quote expiration. - Reconcile transactions 
with uncertain outcomes. - Retry transient RPC requests. - Update transaction state. - Schedule future agent tasks when autonomous execution 
is introduced. ### What the workflow service does The workflow service coordinates execution, records progress, and resumes eligible work. It 
does not make external blockchain operations exactly-once. For example, if a transaction submission times out, the worker must determine 
whether the transaction was already accepted before attempting another submission. ### Suggested transaction states `draft → quoted → 
awaiting_approval → authorized → submitted → confirming → completed` Additional terminal or recovery states include: - `rejected` - 
`expired` - `failed` - `needs_reconciliation` The state machine must account for the actual signing and settlement lifecycle of each 
supported operation. ### Reliability requirements - Idempotency keys for application operations - Duplicate-event handling - Safe retries - 
Transaction identifiers persisted as soon as available - Reconciliation for ambiguous outcomes - Alerts for workflows that remain stuck - A 
durable audit trail of important transitions Inngest is the default candidate for the MVP. Temporal remains an alternative if long-running 
workflow complexity or operational requirements justify it. --- ## 8. NEAR operations and protocol integration The first release should 
support a deliberately small set of operations. Potential candidates: - Read balances and account information - Prepare and execute a 
supported token swap - Track transaction history and settlement For swaps, evaluate NEAR Intents if its supported assets, routes, and 
settlement behavior match the product requirements. Keep protocol integration behind a TypeScript service interface so the AI layer does not 
depend directly on a particular wallet or swap implementation. Do not assume every NEAR function-call access key can authorize arbitrary 
token transfers or swaps. Permissions must be evaluated against the exact contract calls and token standards involved. **Open decision:** 
choose the first mainnet transaction flow only after verifying supported assets, signing requirements, fees, and settlement behavior. --- ## 
9. Security model ### MVP security requirements 1. No private keys or signing secrets in model context, prompts, logs, or browser storage. 2. 
No signing capability exposed directly to the AI model. 3. Explicit user approval for every transaction. 4. Server-side validation of every 
financial tool call. 5. Approval bound to the actual transaction or a cryptographic commitment to its parameters. 6. Quote expiry and 
re-approval when transaction parameters materially change. 7. Secure wallet authentication and session management. 8. Rate limits and 
per-user resource limits. 9. Redaction of sensitive data from logs. 10. Transaction reconciliation and monitoring. 11. Mainnet testing with 
controlled, low-value operations before broader use. ### Future autonomous execution Autonomous execution is not part of the initial 
transaction policy. When introduced, it requires a separate design for: - Restricted agent signing authority - Allowed contracts and methods 
- Spending and transaction limits - Token and destination restrictions - Revocation and expiry - Separate agent balances where appropriate - 
Monitoring, alerts, and emergency suspension A generic application policy cannot compensate for a wallet credential with excessive authority. 
The signing architecture and on-chain permissions must support the intended restrictions. --- ## 10. Deployment and operations ### Proposed 
infrastructure | Component | Service | |---|---| | Web application | Vercel | | Server-side API | Next.js route handlers on Vercel | | 
Database | Supabase Postgres | | Realtime | Supabase Realtime | | Durable workflows | Inngest | | AI inference | OpenAI API | | Blockchain 
access | Verified NEAR RPC provider or supported endpoint | | Error monitoring | Sentry or equivalent | | Source control | GitHub | No 
self-managed persistent VPS is required for the initial architecture, assuming the selected managed services support the required workload 
and execution limits. A separate worker or VPS can be introduced later if a concrete requirement cannot be met economically or reliably with 
managed workflows. ### Environment separation Use separate configuration for development and production: - OpenAI API credentials - Database 
URLs and secrets - Wallet connector configuration - RPC endpoints - Network identifiers - Workflow service credentials Never allow a testnet 
configuration to be mistaken for mainnet, and require explicit safeguards for production transaction execution. --- ## 11. Cost planning 
Initial planning budget, excluding user-funded assets and significant transaction volume: | Cost category | Initial approach | |---|---| | 
Frontend hosting | Start on Vercel free tier | | Database and realtime | Start on Supabase free tier | | Durable workflows | Start on Inngest 
free tier, subject to current limits | | AI inference | Usage-based OpenAI API budget | | Domain | Purchase when needed for a stable public 
demo | | RPC | Suitable free tier initially, if available | | Monitoring | Free tier initially | | Security review | Budget separately before 
exposing meaningful user funds | A small prototype may fit within approximately $0–25 per month, but this is a planning estimate rather than 
a guarantee. A more production-like setup may cost $50–120 or more monthly depending on hosting plans, AI usage, workflow volume, and RPC 
needs. Set billing alerts and usage limits where available. Monitor token consumption, retries, and runaway agent loops. --- ## 12. Mobile 
roadmap After the web experience works, evaluate Expo and React Native with TypeScript. Reuse shared packages for: - API clients - Data 
schemas - Transaction types - Validation - Conversation models - Business logic Wallet signing and secure credential storage must use 
compatible mobile SDKs and platform-specific secure storage. Validate wallet connector support before committing to a shared web/mobile 
implementation. --- ## 13. Implementation sequence ### Phase 1 — Mainnet-ready foundation - Set up Next.js, TypeScript, BeautifulUI, and 
Tabler Icons. - Implement existing-wallet connection. - Implement secure wallet-based application authentication. - Connect OpenAI through 
the Vercel AI SDK. - Persist conversations and messages in Postgres. ### Phase 2 — One complete transaction flow - Choose one supported 
mainnet operation. - Implement transaction preparation and preview. - Require wallet signing and user approval. - Record submission details. 
- Verify settlement and display the outcome. ### Phase 3 — Reliability and security - Add transaction state transitions. - Add durable 
monitoring and reconciliation. - Test refreshes, disconnections, retries, duplicate requests, and ambiguous submissions. - Add error 
monitoring and usage limits. - Test with controlled, low-value mainnet transactions. ### Phase 4 — Product polish - Refine streaming UX and 
structured chat components. - Add portfolio and transaction history. - Improve loading, empty, error, and recovery states. - Prepare the 
public repository and demo. - Validate hackathon submission requirements. ### Phase 5 — Autonomous agents and mobile - Design restricted 
agent authorization. - Implement policy enforcement and revocation. - Test agent failure and recovery. - Evaluate Expo and React Native. - 
Add social or passkey onboarding only if the product requirements justify it. --- ## 14. Outstanding decisions and validation The 
architecture can be used to start the project, but these items must be resolved before treating it as a final production specification. 
**Priority 1 — NEAR wallet integration** Confirm the current official connector API, supported wallets, mainnet behavior, transaction-signing 
flow, and wallet-based authentication support. **Priority 2 — First financial operation** Choose the initial transaction or swap. Validate 
its actual contracts, asset support, quote format, approval requirements, fees, and settlement verification. **Priority 3 — Durable 
execution** Confirm that the selected workflow service can reliably run the monitoring and reconciliation tasks within the required execution 
limits and cost budget. **Priority 4 — Database and session design** Finalize ownership policies, wallet association, session expiry, RLS, 
and the transaction state schema. **Priority 5 — Autonomous execution** Defer the signing authority and policy design until the initial 
user-approved transaction works. Do not infer that wallet connectivity alone makes autonomous signing possible. **Priority 6 — Current vendor 
pricing and licensing** Recheck pricing, usage quotas, package compatibility, and license obligations before deployment. --- ## Final 
architectural principle The application should have four distinct layers: 1. **Presentation:** BeautifulUI chat, streaming, transaction 
previews, and status. 2. **Intelligence:** OpenAI interprets user intent and requests narrowly scoped tools. 3. **Authorization and 
execution:** deterministic application logic validates actions, obtains wallet approval, and submits transactions. 4. **Durability and 
verification:** Postgres stores state, background workflows recover and reconcile work, and the blockchain provides the authoritative 
transaction outcome. This separation lets the AI provider, frontend components, wallet connector, and workflow engine evolve independently 
without compromising the financial safety layer.
