import { parseSection, SettingsView } from '@/features/settings';

/** Settings with one address per section (`?section=general|appearance|models|data|privacy|about`). */
export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  const { section } = await searchParams;
  return <SettingsView section={parseSection(section)} />;
}
