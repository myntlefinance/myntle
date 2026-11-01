import ChatView from "@/components/app/ChatView";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ChatView initialConversationId={decodeURIComponent(slug)} />;
}
