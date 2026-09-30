import { ChatList, ChatProvider } from '@/features/chat';
import { DropOverlay, UploadProvider } from '@/features/library';
import { AppShell, ConnectionWatcher, StartupGate } from '@/features/shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StartupGate>
      <UploadProvider>
        <ChatProvider>
          <AppShell chatList={<ChatList />}>{children}</AppShell>
        </ChatProvider>
        <DropOverlay />
      </UploadProvider>
      <ConnectionWatcher />
    </StartupGate>
  );
}
