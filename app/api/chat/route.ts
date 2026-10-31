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
  const { messages }: { messages: UIMessage[] } = await req.json();

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
    model: nearAI(DEFAULT_MODEL),
    instructions: SYSTEM_INSTRUCTIONS,
    messages: await convertToModelMessages(messages),
    tools,
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
