'use client';

import { FileUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useUploads } from '@/features/library';
import { ApiError, toApiError } from '@/shared/api/errors';
import { useConfig } from '@/shared/api/use-config';
import { useBackendDown } from '@/shared/api/use-connection';
import { usePreferences } from '@/shared/preferences/preferences';
import { useChatSettings } from '../chat-settings';
import { CHATS_KEY, useCreateChat, useDeleteChat } from '../queries';
import { useStreamActions } from '../stream/stream-provider';
import { sendQuestion } from '../send-question';
import { useComposerBlock } from '../use-composer-state';
import { useRefusal } from '../use-refusal';
import { ChatFrame } from './chat-frame';
import { ChatHeader } from './chat-header';
import { Composer } from './composer';
import { ComposerNotice } from './composer-notice';
import { ModelControls } from './model-controls';
import { OfflineNotice } from './offline-notice';
import { RefusalNotice } from './refusal-notice';
import { ScopePicker, type ScopeValue } from './scope-picker';

const NOTICE_ID = 'composer-notice';
const NEW = 'new';
const SUGGESTIONS = ['summary', 'specs', 'norms'] as const;

/**
 * Start of a new chat: a left-aligned greeting (design plan: no card trio). The chat is created on
 * the first send; once the server confirms the question the URL becomes /chat/<id> while the
 * answer keeps streaming in the provider (annex 11, 8.1). Attaching a file creates the chat at
 * once, so the file has a chat to belong to, and opens it with the draft.
 */
export function NewChatView() {
  const t = useTranslations('chat');
  const locale = useLocale() as 'de' | 'en';
  const router = useRouter();
  const { data: config } = useConfig();
  const uploads = useUploads();
  const settings = useChatSettings();
  // Only for this greeting; the name never goes to the model (annex 11, 5.4).
  const { name } = usePreferences();
  const streams = useStreamActions();
  const createChat = useCreateChat();
  const queryClient = useQueryClient();
  const deleteChat = useDeleteChat();
  const { block, readyCount } = useComposerBlock();
  const down = useBackendDown();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<ScopeValue>({ scope: 'all' });
  const [draft, setDraftState] = useState(() => settings.draft(NEW));
  const [sending, setSending] = useState(false);
  const { refusal, refuse, clear: clearRefusal, endWait, waiting } = useRefusal();
  // Refs, not state: a second Enter in the same frame must not create a second chat, and a
  // confirmation that arrives after the user went elsewhere must not pull them back.
  const sendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setDraft = (value: string) => {
    setDraftState(value);
    settings.setDraft(NEW, value);
  };

  const scopeBody = () =>
    scope.scope === 'all' ? { scope: 'all' as const } : { scope: 'selected' as const, document_ids: scope.documentIds };

  const { addFiles, setDropTarget, openPicker } = uploads;
  const attachFiles = async (files: File[]) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    clearRefusal();
    try {
      const { chat } = await createChat.mutateAsync(scopeBody());
      addFiles(files, chat.id);
      void queryClient.invalidateQueries({ queryKey: CHATS_KEY }); // listed before its first question
      settings.setDraft(chat.id, draft);
      setDraft('');
      if (mounted.current) router.replace(`/chat/${chat.id}`);
    } catch (error) {
      if (mounted.current) refuse(toApiError(error));
    } finally {
      sendingRef.current = false;
    }
  };
  const attachRef = useRef(attachFiles);
  useEffect(() => {
    attachRef.current = attachFiles;
  });
  useEffect(() => {
    setDropTarget({ onFiles: (files) => void attachRef.current(files) });
    return () => setDropTarget(null);
  }, [setDropTarget]);
  const attach = () => openPicker({ onFiles: (files) => void attachRef.current(files) });

  const submit = async (question: string) => {
    if (!settings.model || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    clearRefusal();
    let chatId: string | null = null;
    try {
      const { chat } = await createChat.mutateAsync(scopeBody());
      chatId = chat.id;
      if (!(await sendQuestion(streams, settings, { chatId, question, locale }))) {
        throw new ApiError('STREAM_INTERRUPTED', 0);
      }
      setDraft('');
      if (mounted.current) router.replace(`/chat/${chatId}`);
    } catch (error) {
      // Refused before the stream: no empty chat stays behind, the question stays in the composer.
      if (chatId) deleteChat.mutate(chatId);
      if (mounted.current) refuse(toApiError(error));
    } finally {
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    }
  };

  const hasDocuments = block !== 'noDocuments';
  const notice = down ? (
    <OfflineNotice id={NOTICE_ID} />
  ) : refusal ? (
    <RefusalNotice id={NOTICE_ID} refusal={refusal} onDismiss={clearRefusal} onWaitEnd={endWait} />
  ) : block === 'processing' ? (
    <ComposerNotice id={NOTICE_ID} tone="info">
      {t('composer.processing')}
    </ComposerNotice>
  ) : null;

  return (
    <ChatFrame
      scrollRef={scrollRef}
      contentRef={contentRef}
      header={
        <ChatHeader title={<span className="sr-only">{t('untitled')}</span>}>
          <ScopePicker value={scope} onChange={setScope} />
          <ModelControls />
        </ChatHeader>
      }
      dock={
        <>
          {notice}
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            onStop={() => undefined}
            onAttach={attach}
            busy={false}
            sending={sending}
            blocked={block !== null || !settings.model || down || waiting}
            maxChars={config?.limits.max_question_chars}
            describedBy={notice ? NOTICE_ID : block === 'noDocuments' ? 'new-chat-hint' : undefined}
            autoFocus
          />
        </>
      }
    >
      <div className="flex min-h-[calc(100dvh-var(--spacing)*72)] flex-col">
        <div aria-hidden className="min-h-6 flex-2" />
        <h2 className="text-title-1 font-semibold wrap-anywhere">
          {t('greeting')}
          {name && (
            <>
              {' '}
              <bdi>{name}</bdi>
            </>
          )}
        </h2>
        <p className="mt-2 text-reading text-ink-muted">{t('prompt')}</p>

        {hasDocuments ? (
          readyCount > 0 && (
            <ul aria-label={t('suggestionsLabel')} className="mt-8 flex flex-col items-start gap-1">
              {SUGGESTIONS.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    disabled={sending || block !== null || down || waiting}
                    onClick={() => void submit(t(`suggestions.${key}`))}
                    className="-mx-3 flex h-8 items-center rounded-control px-3 text-body text-ink/85 transition-colors hover:bg-fill hover:text-ink disabled:opacity-50 pointer-coarse:h-11"
                  >
                    {t(`suggestions.${key}`)}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            <button
              type="button"
              onClick={attach}
              className="group mt-8 flex w-full items-center gap-4 rounded-card border border-dashed border-hairline-strong p-4 text-left transition-colors hover:border-sodium/70 hover:bg-fill"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-highlight text-sodium-ink">
                <FileUp aria-hidden className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-body font-medium">{t('dropTitle')}</span>
                <span className="mt-0.5 block text-footnote text-ink-muted">{t('dropText')}</span>
              </span>
            </button>
            <p id="new-chat-hint" className="mt-4 max-w-[60ch] text-footnote text-ink-muted">
              {t('hint')}
            </p>
          </>
        )}
        <div aria-hidden className="min-h-6 flex-3" />
      </div>
    </ChatFrame>
  );
}
