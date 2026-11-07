import ChatView from "@/components/app/ChatView";
import { ProvidersLoader } from "../../providers-loader";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProvidersLoader>
      <ChatView initialConversationId={decodeURIComponent(slug)} />
    </ProvidersLoader>
  );
}
