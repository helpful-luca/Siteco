import { cookies } from 'next/headers';
import { ChatList, ChatProvider } from '@/features/chat';
import { CommandPalette } from '@/features/command';
import { DropOverlay, LibraryCount, UploadProvider } from '@/features/library';
import { OnboardingHost } from '@/features/onboarding';
import {
  AppShell,
  ConnectionWatcher,
  parseSidebarLayout,
  SIDEBAR_COOKIE,
  SIDEBAR_WIDTH_COOKIE,
  StartupGate,
} from '@/features/shell';
import { PreferencesMirror } from '@/shared/preferences/preferences';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The sidebar renders collapsed or at its width from the first HTML: no jump after load.
  const jar = await cookies();
  const sidebar = parseSidebarLayout(jar.get(SIDEBAR_COOKIE)?.value, jar.get(SIDEBAR_WIDTH_COOKIE)?.value);
  return (
    <StartupGate>
      <PreferencesMirror />
      <OnboardingHost>
        <UploadProvider>
          <ChatProvider>
            <AppShell
              initialSidebar={sidebar}
              chatList={<ChatList />}
              libraryBadge={<LibraryCount />}
              palette={<CommandPalette />}
            >
              {children}
            </AppShell>
          </ChatProvider>
          <DropOverlay />
        </UploadProvider>
      </OnboardingHost>
      <ConnectionWatcher />
    </StartupGate>
  );
}
