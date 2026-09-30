import { DropOverlay, UploadProvider } from '@/features/library';
import { AppShell, StartupGate } from '@/features/shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StartupGate>
      <UploadProvider>
        <AppShell>{children}</AppShell>
        <DropOverlay />
      </UploadProvider>
    </StartupGate>
  );
}
