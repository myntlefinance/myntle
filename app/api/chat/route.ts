import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { nearAI, DEFAULT_MODEL } from "@/lib/ai/provider";
import { SYSTEM_INSTRUCTIONS } from "@/lib/ai/prompts";
import { tools } from "@/lib/ai/tools";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages, model }: { messages: UIMessage[]; model?: string } = await req.json();

  if (!process.env.NEAR_AI_CLOUD_API_KEY) {
    return Response.json(
      {
        error:
          "The assistant is not configured. Add NEAR_AI_CLOUD_API_KEY to .env.local.",
      },
      { status: 503 },
    );
  }

  const result = streamText({
    model: nearAI(model ?? DEFAULT_MODEL),
    instructions: SYSTEM_INSTRUCTIONS,
    messages: await convertToModelMessages(messages),
    tools,
    // GLM 5.3 Flash is a reasoning model, and its thinking arrives through
    // the reasoning channel, which `toUIMessageStream` forwards as reasoning
    // parts of the UI message. The interface renders those as the thinking
    // pills of the activity record (`components/app/ActivityPills`) rather
    // than as chat output. Do not pass reasoningEffort here: verified against
    // the live service, a forced "none" does not stop this model from
    // reasoning — it reroutes the thinking into the answer channel, where the
    // user would read it as chat output.
    // The default is one step, which would end the assistant after a single
    // tool round and leave a question like "swap some and tell me my balance"
    // half answered.
    stopWhen: isStepCount(8),
    toolApproval: {
      prepare_swap: "user-approval",
    },
    // The client resubmits the whole conversation every turn, so without this
    // a modified client could fabricate an approval for a trade.
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
