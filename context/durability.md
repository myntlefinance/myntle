# Durability

The transaction lifecycle is the one part of this application that must survive a page refresh, a dropped connection, a redeploy, and a process crash while a user is deciding whether to approve a spend. This document covers the engine choice and how it is wired.

## The choice: Vercel Workflow SDK

The engine is the Workflow SDK, package `workflow` at version 5.2.3, Apache licensed, from Vercel. It is the same family as the AI SDK, and the AI SDK v7 ships the agent integration directly as `@ai-sdk/workflow` at version 2.0.80.

```
npm i workflow@^5.2.3 @ai-sdk/workflow@^2
```

### Where it runs, without a VPS

The SDK separates the engine from its storage and queue through an adapter called a World. Four options matter here.

| World | Where the state lives | Does it need a VPS? |
|---|---|---|
| **Vercel** (automatic) | Vercel managed persistence, dispatched through Vercel Queues, executed by Vercel Functions | **No.** Selected automatically inside a Vercel deployment |
| **Local** (default off Vercel) | A `.workflow-data` directory on disk | No, and it is for development only |
| **Postgres** | Your own Postgres, with Graphile Worker doing the polling | **Yes, effectively.** It is documented as a backend for long-running server processes, and Graphile Worker needs a process that never stops |
| **Redis** | Upstash Redis for storage, QStash for the queue | No, both are serverless |

**The answer to the question is the Vercel World, and it costs nothing in new infrastructure**, because the application is already deployed to Vercel. The selection is automatic and is keyed off `VERCEL_DEPLOYMENT_ID`, which Vercel sets on every deployed function and nothing else sets. Nothing needs to be configured.

**The Postgres World is the trap.** It looks free because the project already runs on Postgres, and the storage would work fine against Supabase. But Graphile Worker polls for jobs from a long-lived process, and that is a process that has to keep running. That is the virtual private server this project does not have. Do not use it.

One trap worth knowing: `vercel env pull` writes `VERCEL=1` into `.env.local`, which makes a local development server look like a Vercel deployment. The detection is deliberately based on `VERCEL_DEPLOYMENT_ID` rather than on `VERCEL`, so a local server falls back to the Local World. If the project has cleared **Enable access to System Environment Variables** in the Vercel settings, that variable is missing and a deployment will silently land on the Local World, where the filesystem is read-only and the first write fails.

### What it costs

| Resource | Hobby included | On demand |
|---|---|---|
| Workflow events | 50,000 per month | $0.02 per thousand |
| Data written | 1 GB | $0.50 per GB |
| Data retained | not available on Hobby | $0.50 per gigabyte-month |

Function invocations and queue messages are billed at their normal rates on top.

A step produces three events, one for creation, one for the start, and one for the completion, plus one more for each retry. A swap lifecycle with five steps and a polling loop comes to perhaps forty events, so fifty thousand events a month is thousands of swaps. The allowance is not a constraint.

The limits that could matter are twenty-five thousand events per run, ten thousand steps per run, a maximum workflow replay duration of two hundred and forty seconds, and a maximum single sleep with no upper bound. A single run in this application will stay far below all four.

## What it replaces

The original plan was a scheduled route handler that polls the status endpoint every minute and a separate reconciliation sweep for transactions that fell out of sync. Both had a problem in common: they only ran while the application was up, and neither could hold an in-progress decision across a restart.

A workflow holds the whole lifecycle as one durable object.

```
workflows/swap-lifecycle.ts

export async function swapLifecycle(input: SwapInput) {
  "use workflow";

  const quote = await fetchQuote(input);            // a step
  const signed = await waitForSignature(input);     // a step, then a hook
  const tx = await submitTransaction(signed);       // a step
  const outcome = await pollUntilSettled(tx);       // steps separated by sleep()

  return outcome;
}
```

The polling loop sleeps between checks without consuming compute, the whole run survives a redeploy, and a step that fails is retried without the surrounding logic being rewritten.

## The approval

The human approval lives in the chat, and it is handled by the AI SDK's approval machinery rather than by a workflow hook.

For a plain `streamText` route, approval is configured on the call.

```ts
const result = streamText({
  model: nearAI(MODELS.primary),
  instructions: SYSTEM_INSTRUCTIONS,
  messages: await convertToModelMessages(messages),
  tools,
  stopWhen: isStepCount(8),
  toolApproval: { prepare_swap: "user-approval" },
  experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
});
```

For a `WorkflowAgent`, which is the durable variant, the same idea is expressed on the tool itself with `needsApproval`, and the approval survives a process restart so the user can approve hours later.

Whichever is used, `experimental_toolApprovalSecret` is what makes the approval meaningful, because the client resubmits the entire conversation on every turn and could otherwise fabricate an approval response. The secret lets the server verify that it issued the approval. With `WorkflowAgent` the option takes the shape `{ environmentVariable: "TOOL_APPROVAL_SECRET" }`, and the agent signs the approval identifier, the tool call identifier, the tool name, and the validated input together, so none of them can be swapped on the way back.

**The secret must be at least thirty-two bytes of high entropy, it must be present on every worker that can issue or resume an approval, and it must not change while an approval is pending.** Rotating it invalidates the pending approvals, which for a money flow means the user has to approve again.

## The workflow function

A workflow function orchestrates, and a step function does the work. The distinction is not stylistic. A workflow function is replayed from an event log every time it resumes, so it must be deterministic and it cannot touch Node.js modules. Anything that performs I/O belongs in a step.

```ts
import { sleep } from "workflow";

export async function swapLifecycle(input: SwapInput) {
  "use workflow";

  const quote = await getQuoteStep(input);

  // Sleep without consuming compute.
  await sleep("2s");

  const outcome = await checkStatusStep({ depositAddress: quote.depositAddress });
  return outcome;
}

async function getQuoteStep(input: SwapInput) {
  "use step";
  // Full Node.js access here: fetch, near-api-js, the database.
  return quote(input);
}
```

Everything that touches `near-api-js`, the AI SDK, or Supabase goes inside a step.

### Retries

A step that throws is retried automatically, three attempts by default. A step that throws `FatalError` is not retried, which is the right behaviour for a transaction that was rejected on-chain rather than a network blip.

The distinction matters for this application. A failed status poll should be retried, and a swap that reverted should not be.

### Idempotency

A replayed step does not guarantee exactly-once effects. If a step submitted a transaction and then the process died before recording the result, the replay could submit it again.

The mitigation is the one the transaction record was designed for: the step checks the record for an existing identifier before it acts, and it uses the chain as the authority on whether the action already happened. A swap that was already submitted is looked up on the chain rather than resubmitted.

## The chat stays out of it, at first

There is a durable variant of the agent, `WorkflowAgent` from `@ai-sdk/workflow`, which runs the tool loop inside a workflow and brings durable tool calls, durable approval, and resumable streams with it. The transport for the client is `WorkflowChatTransport` from `@ai-sdk/workflow/client`, and the effect is that a user who refreshes the page mid-answer reconnects to the same stream instead of losing it.

This is worth having, and it is worth having eventually, but it should not be the first thing built.

Three reasons for that order. The chat is the part of the application that has to work on the first day, and the workflow model adds concepts, namely determinism, serialization constraints, and the split between workflow and step functions, at exactly the moment there is the least time to learn them. The chat is also the part that generates the most events and the most written data, since every tool round in the agent loop is a step and every token chunk is written to a durable stream, and the swap lifecycle generates almost none of either. And the benefit is a better experience rather than a missing capability, whereas the swap lifecycle without a workflow engine is genuinely fragile.

So the plan is phased. The chat is a plain AI SDK route in the first phase. The swap lifecycle becomes a workflow in the second, which is a small and well-bounded piece of work that teaches the model cheaply. The chat moves to `WorkflowAgent` and `WorkflowChatTransport` in the third phase if the schedule allows, and the decision is made after the swap lifecycle has proved that the engine fits.

## Resumable streams, when the time comes

The wiring is three pieces. The route starts the run and returns its identifier in a header, the client keeps that identifier and passes it back, and a second route serves the stream for an existing run.

```ts
// app/api/chat/route.ts
const run = await start(chat, [messages]);

return createUIMessageStreamResponse({
  stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
  headers: { "x-workflow-run-id": run.runId },
});
```

```tsx
// client
const { messages, sendMessage } = useChat({
  resume: Boolean(activeRunId),
  transport: new WorkflowChatTransport({ api: "/api/chat" }),
});
```

Two details are easy to get wrong. The durable stream stores raw `ModelCallStreamPart` objects rather than `UIMessageChunk` objects, so the reconnection route has to replay from index zero and apply the interface cursor through `createModelCallToUIChunkTransform({ uiStartIndex })`. And because of that, a negative start index does not work with a durable agent stream, so the "resume from the end" shortcut that reads the last twenty chunks is unavailable unless the stream is stored in the interface shape.

## Deployment pinning

A run stays on the deployment that started it. A run that is sleeping, waiting on an approval, or retrying a step resumes on the original code even after a new deployment, which is the correct default, because it means a paused decision cannot resume into a different function body than the one the user approved.

The cost is that a bug in a paused run cannot be fixed by deploying. The run has to be cancelled and started again against the newest deployment.

```ts
const run = await start(swapLifecycle, [input], { deploymentId: "latest" });
```

During a hackathon, where deployments happen several times a day, this is worth planning for. The pattern that handles it is to make each run do a bounded piece of work and then start the next run on the latest deployment, which keeps the version boundary explicit and the serialised state as the migration point.

## The traps

**The proxy matcher.** Next 16 renamed middleware to `proxy.ts`, and the workflow runtime makes internal requests to a well-known path that the proxy must not intercept. The symptom is an error about performing a slice on a detached array buffer, which appears nowhere near the cause and is hard to diagnose.

```ts
export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)",
    },
  ],
};
```

**The version.** Next 16.1 and later need `workflow` at 5.2.3 or newer, or the build fails looking for a module that has moved.

**The step limit.** `WorkflowAgent` applies no default limit on the number of steps, unlike `streamText`, which defaults to one. If `stopWhen` is omitted the agent continues until the model stops calling tools, and a model that keeps calling tools can run indefinitely and incur real cost. Every agent call sets `stopWhen: isStepCount(N)` explicitly.

**The hook token.** A hook token identifies the approval, and anyone who learns it can respond to it. The route that resumes an approval authenticates the request and checks that the signed-in user owns the transaction, before it resumes anything. The wallet session already in the application is what makes that check possible.

**The local world on a deployment.** If `VERCEL_DEPLOYMENT_ID` is not visible to the deployment, the run starts on the Local World, where the filesystem is read-only, and it fails on the first write with a warning at startup.

## What was rejected

**Inngest.** It works, and it was the previous choice. It is an event-driven platform that calls the application over HTTP, which means the orchestration and the execution live in different places and the types cross a network boundary. The Workflow SDK co-locates them and replays from an event log. The difference did not matter when the only durable work was a status poller, and it matters more now that the approval and the execution are part of the same object.

**A scheduled route handler.** Simple, and free. It only runs while the application is up, and it cannot hold an in-progress decision across a restart.

**Cloudflare Workflows and Temporal.** Both are good durable engines, and both would mean a second platform. Cloudflare Workflows run on Durable Objects, which means Workers and a different deployment model. Temporal is a platform to operate.
