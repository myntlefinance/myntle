"use client";

import ChatView from "@/components/app/ChatView";

/**
 * New-chat composer. After the first saved turn ChatView moves
 * to /chat/<slug>.
 */
export default function Page() {
  return <ChatView initialConversationId={null} />;
}
