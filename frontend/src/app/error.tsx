'use client';

import { ErrorScreen } from '@/features/shell';

/** The app shell itself failed: the calm error screen on its own, with a way to try again. */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen digest={error.digest} onRetry={retry} framed={false} />;
}
