'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useConfig } from '@/shared/api/use-config';

type ChatSettings = {
  /** The model for the next question; defaults to the backend's default until the user picks one. */
  model: string | null;
  setModel: (model: string) => void;
  /** Unsent text per chat ('new' for a chat that does not exist yet), kept in memory (annex 10, E23). */
  draft: (chatId: string) => string;
  setDraft: (chatId: string, text: string) => void;
};

const Context = createContext<ChatSettings | null>(null);

export function ChatSettingsProvider({ children }: { children: ReactNode }) {
  const { data: config } = useConfig();
  const [picked, setPicked] = useState<string | null>(null);
  const drafts = useRef(new Map<string, string>());

  const available = config?.models.filter((m) => m.available).map((m) => m.id) ?? [];
  const model = picked && available.includes(picked) ? picked : (config?.default_model ?? null);

  const draft = useCallback((chatId: string) => drafts.current.get(chatId) ?? '', []);
  const setDraft = useCallback((chatId: string, text: string) => {
    if (text) drafts.current.set(chatId, text);
    else drafts.current.delete(chatId);
  }, []);

  const value = useMemo(() => ({ model, setModel: setPicked, draft, setDraft }), [model, draft, setDraft]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChatSettings(): ChatSettings {
  const value = useContext(Context);
  if (!value) throw new Error('useChatSettings needs the ChatProvider');
  return value;
}
