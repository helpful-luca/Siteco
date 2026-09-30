import { GlobalBanner, StartupGate } from '@/features/shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StartupGate>
      <GlobalBanner />
      <main className="mx-auto max-w-3xl px-6 py-16">{children}</main>
    </StartupGate>
  );
}
