'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AnswerStyle, Effort } from '@/shared/api/types';
import { useConfig } from '@/shared/api/use-config';
import { useStoredPreferences } from '@/shared/preferences/preferences';

/** How the next answer is written, from the settings. */
export type AnswerOptions = { effort: Effort | null; style: AnswerStyle };

export type ChatSettings = {
  /** The model for the next question; defaults to the backend's default until the user picks one. */
  model: string | null;
  setModel: (model: string) => void;
  /** Answer mode and length for a model; no effort for models without it (Haiku). */
  answerOptions: (model: string) => AnswerOptions;
  /** Unsent text per chat ('new' for a chat that does not exist yet), kept in memory. */
  draft: (chatId: string) => string;
  setDraft: (chatId: string, text: string) => void;
  /** The model picker in the chat header, opened from an error that asks for another model. */
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  /** Comparison mode: the next question goes to `model` and `compareModel` side by side. */
  compare: boolean;
  /** Turning it on starts from the pair in the settings. */
  setCompare: (on: boolean) => void;
  /** Null when fewer than two models can answer: then there is nothing to compare. */
  compareModel: string | null;
  setCompareModel: (model: string) => void;
};

const Context = createContext<ChatSettings | null>(null);

export function ChatSettingsProvider({ children }: { children: ReactNode }) {
  const { data: config } = useConfig();
  const { data: preferences } = useStoredPreferences();
  const [picked, setPicked] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [compareOn, setCompareOn] = useState(false);
  const [pickedSecond, setPickedSecond] = useState<string | null>(null);
  const drafts = useRef(new Map<string, string>());

  // The default model from the settings. A model can become unavailable at runtime:
  // then the backend's default, else the first one that still answers.
  const available = config?.models.filter((m) => m.available).map((m) => m.id) ?? [];
  const preferred = [preferences?.default_model, config?.default_model].find((m) => m && available.includes(m));
  const fallback = preferred ?? available[0] ?? null;
  const model = picked && available.includes(picked) ? picked : fallback;

  // The second model: the user's pick, else the partner from the settings pair, else any other.
  const pair = preferences?.compare_models ?? [];
  const second =
    [pickedSecond, ...[...pair].reverse(), ...available].find((m) => m && m !== model && available.includes(m)) ?? null;
  const compare = compareOn && second !== null;
  const pairKey = pair.join(',');
  const availableKey = available.join(',');
  const setCompare = useCallback(
    (on: boolean) => {
      setCompareOn(on);
      const [first, partner] = pairKey.split(',');
      const ids = availableKey.split(',');
      if (on && first && partner && first !== partner && ids.includes(first) && ids.includes(partner)) {
        setPicked(first);
        setPickedSecond(partner);
      }
    },
    [pairKey, availableKey],
  );

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
    () => ({
      model,
      setModel: setPicked,
      answerOptions,
      draft,
      setDraft,
      pickerOpen,
      setPickerOpen,
      compare,
      setCompare,
      compareModel: second,
      setCompareModel: setPickedSecond,
    }),
    [model, answerOptions, draft, setDraft, pickerOpen, compare, setCompare, second],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChatSettings(): ChatSettings {
  const value = useContext(Context);
  if (!value) throw new Error('useChatSettings needs the ChatProvider');
  return value;
}
