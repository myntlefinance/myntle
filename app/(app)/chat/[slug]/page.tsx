import { cookies } from "next/headers";
import ChatView, { type InitialThread } from "@/components/app/ChatView";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getConversationMessages } from "@/lib/db/conversations";

/**
 * The saved thread is read here, on the server, so the first client render
 * already has its messages. The provider tree is still client-only, but the
 * RSC payload carries this data across the boundary, and ChatView can paint
 * the thread as soon as it mounts instead of starting with a message fetch.
 *
 * A signed-out visitor, a missing chat, or a failed read all fall through to
 * the client path; ChatView still owns the redirect and the recovery fetch.
 */
export default async function ChatPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const conversationId = decodeURIComponent(slug);

  let initialThread: InitialThread | null = null;
  try {
    const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = sessionId ? await getSession(sessionId) : null;
    if (session) {
      const thread = await getConversationMessages(
        session.userId,
        conversationId,
        20,
      );
      // Only seed a real transcript. An empty answer may mean the chat is
      // empty, or it may mean the read raced a write; the client still owns
      // the recovery fetch, so it must not be told "there is nothing here".
      if (thread.messages.length > 0) {
        initialThread = {
          messages: thread.messages,
          title: thread.title,
          hasMore: thread.hasMore,
          oldestSeq: thread.oldestSeq,
          // The payload can be reused from the client cache. The read time
          // travels with the messages so the view can tell a fresh seed from
          // one rendered minutes ago and revalidate the old one.
          // eslint-disable-next-line react-hooks/purity -- server read time: this RSC runs once per request, so Date.now() is the seed's read time, not render impurity.
          seededAt: Date.now(),
          activeRunId: thread.activeRunId,
          activeRunStartedAt: thread.activeRunStartedAt,
          activeRunFinishedAt: thread.activeRunFinishedAt,
        };
      }
    }
  } catch {
    // The client still knows how to fetch. A failed prefetch must not turn a
    // saved chat into an error page.
  }

  return (
    <ChatView
      initialConversationId={conversationId}
      initialThread={initialThread}
    />
  );
}
