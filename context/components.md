# Components

Which primitives to reuse, which components this project builds itself, and what each one is allowed to say.

## The foundation

The design system is MIT licensed and its primitives are prop-driven, so the plan is to take the foundation and a selected set of components rather than the demo application.

```bash
# The foundation comes from the design system's repository, not from the
# registry. The published registry payload has unbalanced braces and Tailwind
# refuses to compile it, so the stylesheet is copied from the repository
# directly, which is balanced.
curl -o app/globals.css \
  <design-system-repository>/app/globals.css

bun add shadow-plugin          # the foundation imports it but never declares it
```

The registry also expects a `lib/utils.ts` exporting a `cn` helper built from `clsx` and `tailwind-merge`, and it does not ship one. It lives at `lib/utils.ts` in this project.

**What is installed, and how.** The components were copied straight out of the upstream repository rather than through the registry, because the registry's foundation payload is the broken part and the repository's own `app/globals.css` already carries the foundation plus the component-specific styles for every primitive. Copying the source is the manual path the upstream readme describes, and it avoids the broken payload entirely.

```
components/atoms/        11 files, copied unchanged
components/primitives/   22 files, copied unchanged
```

`SidebarNav` is the one file not copied. It imports eleven icons from a paid package whose install script aborts without a licence key, and the project uses Tabler icons anyway, so the sidebar is written here instead.

The four npm packages the primitives need are all MIT: `class-variance-authority`, `glimm`, `iconoir-react`, and `liveline`.

### What was changed after copying

Two things, both because the originals were written for a demo rather than for a product.

**`PromptBar` now takes its model list as a prop.** The original had a hardcoded list of three joke model names, and no way to supply a real one. It now accepts `models` and reports the selection through `onModelChange`, so the picker shows the models the assistant can actually run and the choice reaches the model call.

**The Solana adapter was written here** rather than copied, because the packages it would have been copied from no longer exist. See `context/wallets.md`.

### What was not copied, and why

Nothing from the harness was left behind. The harness *is* the application.

`components/site/Harness.tsx` and `components/site/ChatExperience.tsx` were copied unchanged, along with `ThemeSync`, `ThemeToggle` and `UseThisHarness`. The gallery-only files that were dropped are `Grid`, `Nav`, `InteractionSounds`, `EmailCapture`, `EmailNudge`, `DevToolbar` and `Foundations`, because they need a catalogue module and a sound library that a product does not have.

The earlier version of this document argued that the harness should not be copied because its data is scripted. That was the wrong conclusion. The data is replaceable; the layout is the hard part to reproduce, and it is excellent. Copying it and changing the data was both faster and better than writing an equivalent shell from scratch.

#### The three changes made to the copied files

Everything visual is untouched. These are the only edits, and each one exists for a specific reason.

**`SidebarNav.tsx` — the icons.** The eleven icons came from the paid package. They are now Tabler equivalents with the same names and sizes, so the sidebar looks the same and the licence problem is gone. `IconSidebarLeft` has no Tabler counterpart and became `IconLayoutSidebarLeftCollapse`.

**`SidebarNav.tsx` — a `footer` slot.** The upstream footer is a single button that opens the "use this harness" modal. The application needs the wallet control there instead, so the footer accepts a node. The default behaviour is unchanged.

**`PromptBar.tsx` — the model list.** The upstream list held three joke names with no way to supply a real one. It is now a prop, and the selection is reported back so the choice reaches the model call.

**`Harness.tsx` — the live data.** The component takes an optional `live` prop carrying the messages, the status and a send function. When it is absent the harness behaves exactly as it does upstream, with the scripted scenarios. When it is present the thread renders the real conversation, the composer sends to the real assistant, the empty state offers our own prompts, and the sidebar's recents are left empty. The scenarios, the `matchScenario` function and the whole `SCENARIOS` map are still there, untouched, because they are what makes the demo mode work.

#### What the harness gives us that a hand-written shell would not

The tab bar, the staged reveal on the empty state, the gliding highlight in the sidebar, the floating composer with the fade behind it, the side panel, the workspace mode, and the collapse animation on the sidebar. The `LiveResponse` component in `components/app/` renders the assistant's real output using the same primitives the demo uses, so the thinking state, the tool chips and the streaming text look identical to upstream.



```bash
# Install the primitives through the registry, one at a time, or copy the
# source files from the design system's repository directly. Both paths are
# documented in the design system's own readme.
```

`sidebar-nav` is not installed, because it depends on a paid icon package whose install script aborts without a licence key. `prompt-bar` is not installed either, because it pulls in a WebGL transition library for a model picker this product does not have. `records-table` installs only if its stylesheet is taken from the repository's `globals.css` rather than from the registry.

## Primitives to reuse

Each of these takes its data through props, so they are used as they are, with an adapter in between.

| Primitive | Used for | Adapter responsibility |
|---|---|---|
| `StreamingText` | The assistant's reply | Feed tokens as they arrive; keep the source list empty unless a tool provided one. |
| `ThinkingState` | The interval between a question and an answer | Map tool names to short human sentences. Never show the raw tool name. |
| `ToolChips` | The inline record of what the assistant did | Each step becomes one chip with a label and a detail line. |
| `TaskRows` | The transaction timeline | Map the transaction state onto the `done`, `running`, and `sequence` statuses. |
| `RecordsTable` | Transaction history | One row per transaction. Keep the default column set and delete the rest. |
| `FilterTable` | Filtering a long history by state | |
| `InsightCards` | Portfolio value over time, using the `liveline` chart | |
| `ContextCards` | The balances and assets the assistant consulted | |
| `CodeBlock` | A quote response or a receipt, for inspection | |
| `ChatComposer` | The message list and the input | Replace the scripted replies with real messages. |
| `LoadingState` | While a quote is being fetched | |
| `StreamText`, `Shimmer`, `EntityChip`, `ValuePill`, `GlideMenu`, `Button` | Atoms used by our own components | |

## The lab

`/lab` is a scratchpad for the parts of the product that are still being worked out. It is not part of the application.

```
app/lab/page.tsx                the route
components/lab/registry.ts       the catalogue, one line per prototype
components/lab/LabFrame.tsx      the frame: variants, and the source to copy
components/lab/samples/          the prototypes themselves
```

**How a prototype is added.** Put a file in `components/lab/samples/` that default-exports a component taking `{ variant?: string }`, then add one line to `components/lab/registry.ts` giving it an id, a title, a caption, the file name, and the variants to render.

**Why it is isolated.** Nothing in the application imports anything under `components/lab/`, so a prototype cannot break the product and a half-finished idea cannot leak into the shipped interface. The only file outside the lab that touches it is the lab route itself.

**Why it shows the source.** The intended workflow is to prototype in the lab until the markup is right, and then copy it into `components/finance/`. The frame reads the file at build time and offers it with a copy button, which is the same approach the design system's own gallery takes.

**The three prototypes already there** are a working draft of the button weights, a draft of the quote card, and a draft of the approval row. The quote preview in particular is where the question of which numbers belong on screen is being worked out, and it is the direct ancestor of `SwapQuoteCard`.

## Components to build

These are the parts of the product that the design system does not cover, either because they do not exist in it or because the version in it does not fit. The ones marked as built exist now.

| Component | State | Why it can't be a design system primitive |
|---|---|---|
| `AppShell` and `Sidebar` | built | `SidebarNav` is license-blocked. Ours uses Tabler icons, and holds the conversation list and the wallet badge. |
| `WalletButton` | built | The connected account, a chain badge, disconnect, and a chain picker. Not in the kit at all. |
| `ChatTranscript` | built | The real message list, with tool calls inline and the reply streaming. `ChatComposer` is a fixed 288 pixel demo card with scripted reveals. |
| `SwapQuoteCard` | to build | The core finance component. Origin and destination asset, amount out, minimum out, rate, fee, deadline countdown. |
| `TxApprovalCard` | to build | `ApprovalCard` is a *questionnaire*. Ours: approve or reject, bound to the exact parameters that will be signed. |
| `TxStatusTimeline` | to build | Wraps `TaskRows`. States: quoted, approved, submitted, deposit confirmed, processing, settled, refunded, incomplete deposit, failed. |
| `AgentLimitsPanel` | to build | The security track's money shot. Per-transaction cap, daily cap, allowed assets, allowed destinations, expiry, remaining allowance, revoke. |
| `BalanceList` | to build | Per-asset balances valued with the price list, keeping the on-chain balance and the ledger balance apart. |
| `IntentBalanceCard` | to build | The ledger balance, pending swaps, and whether the agent key is registered. |
| `FeeBreakdown` and `RiskBadge` | to build | Fee and slippage disclosure, and a warning when either is outside the range the user set. |
| `VerificationBadge` | to build | Which model answered and that it ran inside a confidential environment. |
| `AgentKeyBadge` | to build | The agent's key, what it is scoped to, and when it was last used. |

### AppShell and Sidebar

The sidebar holds the brand, a new-conversation button, the list of conversations, and the connected account with the wallet control at the foot of it. It uses Tabler icons.

### WalletButton

Shows the connected account with a chain badge, a disconnect action, and the chain picker. It opens the *chain* picker rather than the wallet picker, because the chain decides which wallets make sense, and the wallet list within each chain comes from that chain's own library.

### SwapQuoteCard

The core component of the product. It shows the token being sold, the token being bought, the amount that will be received, the minimum amount that will be received, the rate, the fee, and the time remaining before the quote expires.

The contract id of each token appears in small type beneath the ticker, because the tickers are genuinely ambiguous on this chain and the user is about to authorise a spend.

The card does not show an eyebrow label above the heading, because the heading already says what the card is.

### TxApprovalCard

The design system's `ApprovalCard` is a multi-step questionnaire and cannot be used for this. The approval card offers two actions, approve and reject, and it displays exactly the parameters that will be signed.

If the quote has changed since the approval was requested, the card says so and asks again rather than silently proceeding. The approval is bound to the stored quote rather than to anything the client sends back.

### TxStatusTimeline

Wraps `TaskRows`. The states are quoted, approved, submitted, deposit confirmed, processing, and then settled, refunded, incomplete deposit, or failed.

### AgentLimitsPanel

The spending limits, the allowed assets, the allowed destinations, the expiry, the remaining allowance, the balance inside the verifier ledger, and a button that revokes the agent key.

### BalanceList

Per-asset balances valued with the price list from the token endpoint, and it keeps the on-chain balance and the verifier ledger balance in separate sections because they are different pools of money.

### IntentBalanceCard

The verifier ledger balance, the pending swaps, and whether the agent key is registered.

### ChatTranscript

The real message list, with the tool calls inline in the order they happened, the assistant's reply streaming in, and the empty state explaining what the product does. Persistence is not wired yet, so a refresh starts a new conversation.

### FeeBreakdown and RiskBadge

A breakdown of the fee and the slippage tolerance, and a warning when either is outside the range the user has set.

### VerificationBadge

Shows which model answered and that it ran inside a confidential environment. It is a small, quiet marker rather than a panel, because the model's identity is a fact the user may want to check but not a fact that needs to occupy the screen.

### AgentKeyBadge

Whether the agent key is registered, what it is scoped to, and when it was last used.

## Copy rules for these components

The two design rules in `AGENTS.md` apply with particular force to the financial components, because a user is about to authorise a movement of money.

**Write sentences, not slogans.** A button that reads "Swap 100 USDC for NEAR" is better than "Confirm". An error that reads "This swap would exceed your daily limit of 200 USDC" is better than "Limit exceeded". The user is making a decision and the interface should give them the information to make it.

**Remove anything that does not change the decision.** The quote card carries the amount out, the minimum amount out, the rate, the fee, and the deadline. It does not carry a description of what a slippage tolerance is, because a user who does not know what it is will not be helped by a paragraph, and a user who does know it will be slowed down by one. A tooltip is the right place for that explanation, and it should not exist until someone asks for it.

**No decorative elements.** No tag above a heading. No badge that carries no state. No pill that repeats the heading in a different colour. If an element can be removed without the user losing something they need, it goes.

**Show the real numbers.** Amounts use the smallest unit internally and a formatted value in the interface. Never show a rounded figure where the rounding could change the decision. The minimum amount out is always visible, because that is the figure that determines whether the swap can revert.

**Say what will happen, not what might.** "This swap will send 100 USDC to the exchange" describes the action. "This swap may or may not succeed" describes the anxiety.

## Data flow into the components

```
useChat → message.parts[]
   ├─ "text"                 → StreamingText
   ├─ "reasoning"            → ThinkingState
   ├─ "tool-get_quote"       → ToolChips
   ├─ "tool-prepare_swap"    → SwapQuoteCard, then TxApprovalCard
   ├─ "tool-get_balances"    → BalanceList
   └─ "step-start"           → a subtle divider between tool rounds
```

The transaction timeline is not driven by the stream. It is driven by the transaction record, because the outcome comes from the chain and not from the assistant, and the two can disagree.
