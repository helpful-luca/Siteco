import { ChatList, ChatProvider } from '@/features/chat';
import { DropOverlay, UploadProvider } from '@/features/library';
import { OnboardingHost } from '@/features/onboarding';
import { AppShell, ConnectionWatcher, StartupGate } from '@/features/shell';
import { PreferencesMirror } from '@/shared/preferences/preferences';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StartupGate>
      <PreferencesMirror />
      <OnboardingHost>
        <UploadProvider>
          <ChatProvider>
            <AppShell chatList={<ChatList />}>{children}</AppShell>
          </ChatProvider>
          <DropOverlay />
        </UploadProvider>
      </OnboardingHost>
      <ConnectionWatcher />
    </StartupGate>
  );
}
