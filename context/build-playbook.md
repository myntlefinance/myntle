# Build playbook

Concrete setup and code for building Myntle. Every API call in this document was checked against the installed package or the live service, because several of the examples circulating online for this stack are broken.

## Installing the project

```bash
bun create next-app myntle --ts --tailwind --app --src-dir=false --turbopack
cd myntle

bun add ai@^7 @ai-sdk/react@^4 @ai-sdk/openai-compatible@^3 zod@^4
bun add workflow@^5.2.3 @ai-sdk/workflow@^2
bun add wagmi@^2.19.5 viem@^2.57.10 @tanstack/react-query@^5
bun add @solana/wallet-standard @wallet-standard/app @wallet-standard/base
bun add @hot-labs/near-connect near-connect-hooks near-api-js@^7
bun add @tabler/icons-react @supabase/supabase-js
bun add shadow-plugin@^2.1.1

bun add -d typescript @types/node @types/react @types/react-dom \
  tailwindcss @tailwindcss/postcss vitest
```

Set `"type": "module"` in `package.json` and `engines.node` to `>=22`, because `ai@7` is ESM only and declares that engine requirement.

**Pin React with a tilde, not a caret.** `react: "~19.2.9"`, not `^19.2.9`, because a caret would resolve to 19.3 and `@ai-sdk/react` excludes it.

**Install every type package explicitly.** Next.js silently installs a missing dependency with npm when it cannot find one it expects, which leaves a stray `package-lock.json` next to `bun.lock` and breaks the assumption that Bun is managing the tree.

**Install `shadow-plugin` explicitly.** The design foundation imports it, the design system's registry does not declare it, and an unresolvable import in a stylesheet makes Turbopack fail with an internal error rather than a message naming the package.

**The dev and build scripts need `--bun`.** Without it the Next binary runs on Node through its shebang, so `bun run build` quietly produces a Node build. The scripts in `package.json` already have it.

**Do not set `"packageManager": "bun@…"`.** Corepack does not support Bun, and Vercel reads that field through Corepack, so it fails the build before anything else runs. Vercel detects `bun.lock` and installs with Bun on its own.

**Bun does not enforce `engines`.** The Node version guard is silently ignored, so CI checks it explicitly.

**The Solana wallet adapter is not used.** Its 0.19 line has been withdrawn from npm and its version 3 replacement requires React 19.3, which the AI SDK excludes. The Wallet Standard is used instead, and `context/wallets.md` has the details.

### Enabling the workflow runtime

The workflow SDK compiles the `"use workflow"` and `"use step"` directives, so the Next config has to be wrapped.

```ts
// next.config.ts
import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default withWorkflow(nextConfig);
```

Next 16 renamed middleware to `proxy.ts`, and the workflow runtime makes internal requests to a path that the proxy must not intercept. The symptom when it is intercepted is an error about performing a slice on a detached array buffer, which points nowhere near the cause.

```ts
// proxy.ts
export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)",
    },
  ],
};
```

The runtime selects its storage and queue automatically. Inside a Vercel deployment it uses the Vercel World, keyed off the deployment identifier that Vercel sets on every function. Outside Vercel it writes to a `.workflow-data` directory, which is what the development server uses. Do not point it at the Postgres World, because that one needs a long-running worker process. `context/durability.md` has the detail.

### Environment

```bash
# .env.local
NEAR_AI_CLOUD_API_KEY=            # cloud.near.ai dashboard — secret
ONE_CLICK_API_KEY=                # partners.near-intents.org — secret, optional
WALLET_CONNECT_PROJECT_ID=        # cloud.walletconnect.com — secret
NEXT_PUBLIC_NEAR_RPC_PRIMARY=https://free.rpc.fastnear.com
NEXT_PUBLIC_NEAR_RPC_BACKUP=https://rpc.fastnear.com
NEXT_PUBLIC_ONE_CLICK_BASE_URL=https://1click.chaindefuser.com
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=        # server only — secret
TOOL_APPROVAL_SECRET=             # random 32 bytes — secret
```

The service role key and the tool approval secret must never reach the browser. Nothing else in this list is sensitive, and the contract ids in `lib/near/contracts.ts` are configuration rather than secrets.

## Wiring the AI provider

`lib/ai/provider.ts`

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const nearAI = createOpenAICompatible({
  name: "near-ai-cloud",
  baseURL: "https://cloud-api.near.ai/v1",
  apiKey: process.env.NEAR_AI_CLOUD_API_KEY,
  includeUsage: true,
  supportsStructuredOutputs: true,
});

export const MODELS = {
  /** Tool-capable, cheap, strong. The default for the agent loop. */
  primary: "openai/gpt-6-luna",
  /** Cheapest tool-capable option. Swap in if token cost matters. */
  cheap: "Qwen/Qwen3.8-27B",
  /** Strongest tool-capable option on the catalogue. */
  strong: "anthropic/claude-sonnet-5-5",
} as const;
```

Two models must be avoided for this product. `openai/gpt-6-astra` and `openai/gpt-6.1-sol` appear in the catalogue without a `tools` capability, and the same two models do not support tool calling on the Chat Completions endpoint, which is the shape this provider uses. The catalogue is public and costs nothing to read, so verify capabilities there rather than assuming.

```bash
curl -s https://cloud-api.near.ai/v1/models | jq '.data[] | {id, tools: (.supported_features | index("tools") != null), in: .pricing.input, out: .pricing.output}'
```

NEAR AI Cloud also exposes `/v1/privacy/redact` and `/v1/privacy/classify`, which strip and detect personally identifying information at the gateway. A portfolio query that mentions an account holder by name is a reasonable thing to scrub before it reaches the model, and the redaction endpoint is worth wiring into the tool layer once the core flow works.

## The chat route

`app/api/chat/route.ts`

```ts
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { nearAI, MODELS } from "@/lib/ai/provider";
import { tools } from "@/lib/ai/tools";
import { SYSTEM_INSTRUCTIONS } from "@/lib/ai/prompts";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: nearAI(MODELS.primary),
    instructions: SYSTEM_INSTRUCTIONS,
    messages: await convertToModelMessages(messages),
    tools,
    // The default is one step, which ends the agent after a single tool round.
    stopWhen: isStepCount(8),
    toolApproval: {
      prepare_swap: "user-approval",
    },
    // Without this, a modified client could fabricate an approval response,
    // because the client resubmits the whole conversation every turn.
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
```

Four details in that route are load bearing. `convertToModelMessages` is asynchronous in version 7 and returns a promise. The system prompt is passed as `instructions`, not `system`. `stopWhen` must be set because the default of one step truncates multi-step work silently rather than failing loudly. And `experimental_toolApprovalSecret` is what makes the approval meaningful, because the client controls the message history it resends.

## Writing the tools

Tools live one per file under `lib/ai/tools/`. Read-only tools have an `execute` function and no approval. The single write tool has no `execute` function, because it must not run until the user has approved it.

`lib/ai/tools/get_quote.ts`

```ts
import { tool } from "ai";
import { z } from "zod";
import { quote } from "@/lib/intents/service";

export const getQuote = tool({
  description:
    "Get a price quote for swapping one NEAR token for another. Returns the amount " +
    "received, the minimum guaranteed amount, the fee, and the quote expiry. Use this " +
    "before proposing any swap.",
  inputSchema: z.object({
    fromAssetId: z.string().describe("Full NEP-141 contract id of the token to sell"),
    toAssetId: z.string().describe("Full NEP-141 contract id of the token to buy"),
    amount: z.string().describe("Amount in the smallest unit of the token being sold"),
  }),
  execute: async ({ fromAssetId, toAssetId, amount }) => {
    const q = await quote({ fromAssetId, toAssetId, amount });
    return {
      engine: q.engine,
      amountOut: q.amountOut,
      minAmountOut: q.minAmountOut,
      feeBps: q.feeBps,
      rate: q.rate,
      expiresAt: q.expiresAt,
      warnings: q.warnings,
    };
  },
});
```

The schema uses contract ids rather than tickers because the model will happily produce a ticker and the tickers are ambiguous on this chain. The descriptions matter more than usual, because they are the only thing the model reads when deciding which tool to call.

`lib/ai/tools/prepare_swap.ts`

```ts
import { tool } from "ai";
import { z } from "zod";
import { prepare } from "@/lib/intents/service";
import { requireSession } from "@/lib/auth/session";

export const prepareSwap = tool({
  description:
    "Propose a swap for the user to approve. Returns the exact parameters that will " +
    "be signed. Call this only after the user has agreed to a specific amount and pair.",
  inputSchema: z.object({
    fromAssetId: z.string().describe("Full asset id, including the chain prefix"),
    toAssetId: z.string().describe("Full asset id, including the chain prefix"),
    amount: z.string().describe("Amount in the smallest unit of the token being sold"),
    slippageBps: z.number().int().min(1).max(300).default(100),
  }),
  // No execute function: the tool waits for approval before it runs.
});
```

The tool returns a description of what will be signed. It does not build the intent and it does not talk to the wallet, because at this point in the flow the server does not know which account is connected or whether the user has a balance.

**The model never sees a wallet.** The tool's input carries asset ids and an amount. It never carries an address, and no tool signs anything. The wallet lives entirely in the interface layer, which is what keeps a modified browser from redirecting a trade to an address it chose.

## The approval flow on the client

`components/app/ChatTranscript.tsx` renders the tool parts. A part that is waiting for approval renders the approval card.

```tsx
import { useChat, lastAssistantMessageIsCompleteWithApprovalResponses } from "@ai-sdk/react";

const { messages, addToolApprovalResponse } = useChat({
  transport: new DefaultChatTransport({ api: "/api/chat" }),
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});
```

The `sendAutomaticallyWhen` option is what resumes the conversation after the user approves. Without it the transcript stops at the approval card and the user has to send another message to continue.

```tsx
{messages.map((message) =>
  message.parts.map((part) => {
    if (part.type === "tool-prepare_swap") {
      switch (part.state) {
        case "input-streaming":
          return <SwapQuoteSkeleton key={part.toolCallId} />;
        case "approval-requested":
          return (
            <SwapApprovalCard
              key={part.toolCallId}
              proposal={part.input}
              onApprove={() =>
                addToolApprovalResponse({ id: part.approval.id, approved: true })
              }
              onDeny={() =>
                addToolApprovalResponse({ id: part.approval.id, approved: false })
              }
            />
          );
        case "output-available":
          return <TxStatusTimeline key={part.toolCallId} transaction={part.output} />;
        case "output-denied":
          return <SwapDenied key={part.toolCallId} reason={part.approval.reason} />;
        default:
          return null;
      }
    }
    return null;
  }),
)}
```

The tool part states are worth knowing in full, because the render function has to be exhaustive. They are `input-streaming`, `input-available`, `approval-requested`, `approval-responded`, `output-available`, `output-error`, and `output-denied`. An approval response that carries a reason is passed to the model inside the execution-denied tool result, which is how a refusal becomes a conversation rather than a dead end.

## Connecting a wallet

Wrap the application in the three providers, then use the adapter.

```tsx
// app/layout.tsx
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, base, arbitrum, polygon } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { NearProvider } from "near-connect-hooks";

const wagmiConfig = createConfig({
  chains: [mainnet, base, arbitrum, polygon],
  connectors: [injected(), walletConnect({ projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID! })],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [polygon.id]: http(),
  },
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <WagmiProvider config={wagmiConfig}>
          <ConnectionProvider>
            <WalletProvider wallets={[]}>
              <NearProvider config={{ network: "mainnet" }}>{children}</NearProvider>
            </WalletProvider>
          </ConnectionProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}
```

The three providers coexist because they are three separate libraries with three separate models. The application talks to none of them directly and only to our own adapter, which is what keeps the rest of the code from caring which chain a user is on.

**The providers are loaded with server rendering turned off.** The wallet libraries call `createContext` when they are evaluated, and React's server build does not have that function, so a client boundary is not enough on its own, because a client component is still server-rendered for the initial HTML. The whole tree is loaded without server rendering, which is also honest about the fact that a wallet application needs a browser.

```tsx
// app/providers-loader.tsx
"use client";
import dynamic from "next/dynamic";

const Providers = dynamic(
  () => import("./providers").then((m) => m.Providers),
  { ssr: false, loading: () => null },
);

export function ProvidersLoader({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
```

```tsx
// components/app/WalletButton.tsx
"use client";
import { useWallet } from "@/lib/wallet/registry";

export function WalletButton() {
  const { adapter, connect, disconnect, connected } = useWallet();

  if (connected && adapter) {
    return (
      <button onClick={disconnect}>
        {adapter.address}
      </button>
    );
  }

  return <button onClick={connect}>Connect wallet</button>;
}
```

`connect` opens a chain picker rather than a wallet picker, because the chain decides which wallets make sense. The picker offers Ethereum-family chains, Solana, and NEAR, and the wallet list within each comes from that chain's own library.

The NEAR connector filters its wallet list by feature flag, so request `signMessage` explicitly if you want only wallets that can authenticate.

```ts
new NearConnector({
  network: "mainnet",
  features: { signMessage: true },
});
```

Two wallets in the NEAR manifest do not implement `signMessage` at all. Filtering by feature flag is the only reliable way to avoid discovering that at the moment the user tries to log in.

The Solana registry is imported inside an effect rather than at the top of the file, because the package reaches for `indexedDB` when it is evaluated and the server has no such thing.

## Wallet-based sign-in

`lib/auth/challenge.ts` issues the nonce, and `lib/auth/verify.ts` checks the signature.

```ts
import { randomBytes } from "node:crypto";

// Issue
const nonce = randomBytes(32);
const message = `Sign in to Myntle`;
await storeChallenge({ nonce, accountId, expiresAt: Date.now() + 5 * 60_000 });
```

```tsx
// Client
const { signNEP413Message } = useNearWallet();
const signed = await signNEP413Message({
  message: "Sign in to Myntle",
  recipient: "app.myntle.near",
  nonce, // exactly 32 bytes
});
```

```ts
// Server
import { verifyMessage } from "near-api-js/nep413";
import { base64Decode, JsonRpcProvider } from "near-api-js";

const provider = new JsonRpcProvider({ url: process.env.NEXT_PUBLIC_NEAR_RPC_PRIMARY! });

await verifyMessage({
  signerAccountId: body.accountId,
  signerPublicKey: body.publicKey,
  signature: base64Decode(body.signature),
  payload: { message: body.message, recipient: body.recipient, nonce: body.nonce },
  provider,
});
```

The nonce must be exactly 32 bytes. The official NEAR tutorial uses `Buffer.from(crypto.randomUUID())`, which produces 36 bytes of ASCII, and that signature will never validate. Consume the nonce before issuing the session so that it cannot be replayed, and if a wallet signed with a `callbackUrl`, include it in the verification payload exactly as the wallet sent it.

## The settlement engine

`lib/intents/service.ts` is the only engine in the first release. It talks to the 1Click API, and it works for every chain the verifier supports.

```ts
export async function quote(req: QuoteRequest): Promise<Quote> {
  const res = await oneClick("POST", "/v0/quote", { dry: true, ...req });
  return toQuote(res);
}
```

The RHEA engine is not built in the first release. The interface it would have implemented is kept, so it can be added back later for users who want a trade that settles entirely on the NEAR chain with no solver in the middle. `context/decisions.md` records why it is not built now.

### RHEA engine (not built in the first release)

```ts
const RHEA_EXCHANGE = "v2.ref-finance.near";

export async function getReturn(args: {
  poolId: number;
  tokenIn: string;
  amountIn: string;
  tokenOut: string;
}): Promise<string> {
  const res = await rpcCall("EXPERIMENTAL_call_function", {
    account_id: RHEA_EXCHANGE,
    method_name: "get_return",
    args_base64: base64(JSON.stringify({
      pool_id: args.poolId,
      token_in: args.tokenIn,
      amount_in: args.amountIn,
      token_out: args.tokenOut,
    })),
    finality: "final",
  });

  // The result arrives as a raw byte array, not base64.
  return Buffer.from(res.result).toString("utf8").replace(/"/g, "");
}
```

`Buffer.from(result, "base64")` produces garbage here, and the mistake is easy to make because every other RPC method returns base64.

Executing a swap takes two wallet transactions.

```ts
const actions = [
  {
    type: "FunctionCall",
    params: {
      methodName: "ft_transfer_call",
      args: {
        receiver_id: RHEA_EXCHANGE,
        amount: amountIn,
        msg: "",
      },
      gas: "100000000000000", // 100 TGas
      deposit: "1",
    },
  },
];
```

then a `swap` action on the exchange with `pool_id`, `token_in`, `amount_in`, `token_out`, and `min_amount_out` set from a fresh quote minus the slippage tolerance, at 300 TGas and a 1 yoctoNEAR deposit.

Quote immediately before signing and set `min_amount_out` from that quote. The RHEA pool for the bridged USDC against wNEAR holds roughly 48 million USDC and 9 million wNEAR, so a trade of a hundred USDC moves the price by about two tenths of a percent, and the pool fee is three tenths of a percent.

Never price from `get_pools`. The amount fields there are inconsistent between pools, and reading them will produce a number that disagrees with the market.

### Intents engine

```ts
const res = await fetch(`${baseUrl}/v0/quote`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  },
  body: JSON.stringify({
    dry: true,
    swapType: "EXACT_INPUT",
    originAsset: fromAssetId,
    destinationAsset: toAssetId,
    amount,
    recipient: accountId,
    refundTo: accountId,
    depositType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    refundType: "ORIGIN_CHAIN",
    slippageTolerance: 100,
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  }),
});
```

All four of `depositType`, `recipientType`, `refundType`, and `deadline` are required by the live API even though the documentation lists them as optional, and the documentation states that the deadline defaults to ten minutes when the server in fact returns its own value of roughly seventy-two hours. Use the deadline the response returns.

Poll for completion with `GET /v0/status?depositAddress=…`. The terminal statuses are `SUCCESS`, `FAILED`, `REFUNDED`, and `INCOMPLETE_DEPOSIT`, and `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, and `PROCESSING` are the in-progress ones. A deposit that succeeds on-chain is not a swap that settled, and the two must not be conflated.

## Reading the outcome

```ts
const outcome = await provider.viewTransactionStatus({
  txHash,
  accountId,
  waitUntil: "FINAL",
});
```

Check the outer status and then check every receipt.

```ts
const failed =
  outcome.status && typeof outcome.status === "object" && "Failure" in outcome.status;

const innerFailed = outcome.receipts.some(
  (r) => r.outcome.status && "Failure" in r.outcome.status,
);
```

A cross-contract swap can fail in the inner receipt while the outer transaction reports success, so the outer status alone is not sufficient evidence that the swap happened. NEAR reaches finality in roughly one and a half seconds, so polling is cheap.

## Reconciling

The reconciliation is the tail of the swap lifecycle workflow, so it is a step rather than a scheduled sweep.

`workflows/swap-lifecycle.ts`

```ts
import { sleep } from "workflow";
import { FatalError } from "workflow/errors";

export async function swapLifecycle(input: SwapInput) {
  "use workflow";

  const quote = await fetchQuoteStep(input);

  const submitted = await submitStep({ ...input, quote });
  if (!submitted) {
    throw new FatalError("The transaction was rejected on-chain");
  }

  let outcome = await checkStatusStep(submitted);
  while (!outcome.terminal) {
    // Sleeping costs nothing, unlike a function that waits.
    await sleep("3s");
    outcome = await checkStatusStep(submitted);
  }

  return outcome;
}

async function fetchQuoteStep(input: SwapInput) {
  "use step";
  return quote(input);
}

async function submitStep(input: SubmitInput) {
  "use step";
  return submitTransaction(input);
}

async function checkStatusStep(submitted: SubmittedTx) {
  "use step";
  const status = await readAuthoritativeStatus(submitted);
  await recordTransactionStatus(submitted, status);
  return status;
}
```

The route that starts it does not wait for it.

```ts
// app/api/approve/route.ts
import { start } from "workflow/api";
import { swapLifecycle } from "@/workflows/swap-lifecycle";

export async function POST(req: Request) {
  const session = await requireSession(req);
  const input = await req.json();

  const run = await start(swapLifecycle, [{ ...input, session }]);

  return Response.json({ transactionId: run.runId });
}
```

A thrown error is retried. A `FatalError` is not, and the distinction is the point: a failed status poll should be retried, and a swap that reverted on-chain should not be.

The poll must not run inside a Vercel function request that the browser is waiting on, because the Hobby plan caps a function at three hundred seconds and that ceiling counts time spent sending a streamed response. The workflow handles this by sleeping between steps rather than looping inside one, and because a sleeping workflow consumes no compute.

## Testing

The parts worth testing are the parts where a mistake moves money.

```ts
describe("approval binding", () => {
  it("rejects an approval whose parameters differ from the stored quote", () => {
    // the stored quote, not the client payload, decides what is signed
  });
});

describe("receipt inspection", () => {
  it("treats an inner receipt failure as a failed swap", () => {});
});

describe("asset resolution", () => {
  it("never resolves a ticker to a contract id", () => {});
});

describe("workflow steps", () => {
  it("does not retry a transaction that reverted on-chain", () => {
    // FatalError, not a thrown Error
  });
});
```

Run the on-chain tests against a dedicated development account with small balances, and treat the first mainnet transaction as a test rather than a demonstration. The workflow SDK ships a Vitest plugin, `@workflow/vitest`, which runs a workflow in process so the lifecycle can be tested without a deployment.
