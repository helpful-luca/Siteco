import { ChatView } from '@/features/chat';

type Props = { params: Promise<{ chatId: string }> };

export default async function ChatPage({ params }: Props) {
  const { chatId } = await params;
  // The key remounts the view per chat: drafts, scroll position and notices belong to one chat.
  return <ChatView key={chatId} chatId={chatId} />;
}
