"use client";

import ChatView from "@/components/app/ChatView";
import { ProvidersLoader } from "./providers-loader";

/**
 * New-chat composer. After the first saved turn ChatView moves
 * to /chat/<slug>.
 */
export default function Page() {
  return (
    <ProvidersLoader>
      <ChatView initialConversationId={null} />
    </ProvidersLoader>
  );
}
