'use client';

import type { ReactNode } from 'react';
import { ChatSettingsProvider } from './chat-settings';
import { StreamProvider } from './stream/stream-provider';

/** Chat state that must outlive the routes: running answers, model choice and drafts. */
export function ChatProvider({ children }: { children: ReactNode }) {
  return (
    <StreamProvider>
      <ChatSettingsProvider>{children}</ChatSettingsProvider>
    </StreamProvider>
  );
}
