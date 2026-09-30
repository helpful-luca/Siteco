'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AnswerStyle, Effort } from '@/shared/api/types';
import { useConfig } from '@/shared/api/use-config';
import { useStoredPreferences } from '@/shared/preferences/preferences';

/** How the next answer is written, from the settings (annex 11, 4.2). */
export type AnswerOptions = { effort: Effort | null; style: AnswerStyle };

type ChatSettings = {
  /** The model for the next question; defaults to the backend's default until the user picks one. */
  model: string | null;
  setModel: (model: string) => void;
  /** Answer mode and length for a model; no effort for models without it (Haiku). */
  answerOptions: (model: string) => AnswerOptions;
  /** Unsent text per chat ('new' for a chat that does not exist yet), kept in memory (annex 10, E23). */
  draft: (chatId: string) => string;
  setDraft: (chatId: string, text: string) => void;
  /** The model picker in the chat header, opened from an error that asks for another model. */
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
};

const Context = createContext<ChatSettings | null>(null);

export function ChatSettingsProvider({ children }: { children: ReactNode }) {
  const { data: config } = useConfig();
  const { data: preferences } = useStoredPreferences();
  const [picked, setPicked] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const drafts = useRef(new Map<string, string>());

  // The default model from the settings. A model can become unavailable at runtime (annex 10,
  // B15): then the backend's default, else the first one that still answers.
  const available = config?.models.filter((m) => m.available).map((m) => m.id) ?? [];
  const preferred = [preferences?.default_model, config?.default_model].find((m) => m && available.includes(m));
  const fallback = preferred ?? available[0] ?? null;
  const model = picked && available.includes(picked) ? picked : fallback;

  const effort = preferences?.effort ?? null;
  const style = preferences?.style ?? 'concise';
  const models = config?.models;
  const answerOptions = useCallback(
    (id: string): AnswerOptions => {
      const efforts = models?.find((m) => m.id === id)?.efforts ?? [];
      return { effort: effort && efforts.includes(effort) ? effort : null, style };
    },
    [models, effort, style],
  );

  const draft = useCallback((chatId: string) => drafts.current.get(chatId) ?? '', []);
  const setDraft = useCallback((chatId: string, text: string) => {
    if (text) drafts.current.set(chatId, text);
    else drafts.current.delete(chatId);
  }, []);

  const value = useMemo(
    () => ({ model, setModel: setPicked, answerOptions, draft, setDraft, pickerOpen, setPickerOpen }),
    [model, answerOptions, draft, setDraft, pickerOpen],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChatSettings(): ChatSettings {
  const value = useContext(Context);
  if (!value) throw new Error('useChatSettings needs the ChatProvider');
  return value;
}
