'use client';

import { ErrorScreen } from '@/features/shell';

/** A view failed to render: sidebar and uploads stay, the view shows the calm error screen. */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen digest={error.digest} onRetry={retry} />;
}
