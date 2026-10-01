'use client';

import { CornerDownRight, FileUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ImportLinkDialog, useDocuments, useUploads } from '@/features/library';
import { ApiError, toApiError } from '@/shared/api/errors';
import { useConfig } from '@/shared/api/use-config';
import { useBackendDown } from '@/shared/api/use-connection';
import { usePreferences } from '@/shared/preferences/preferences';
import { cn } from '@/shared/ui';
import { useChatSettings } from '../chat-settings';
import { greetingFor } from '../greeting';
import { suggestionsFor } from '../suggestions';
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
const noSubscription = () => () => undefined;

/** The time of day greeting, from the viewer's clock; null on the server (its clock may differ). */
function useGreeting() {
  return useSyncExternalStore(noSubscription, () => greetingFor(new Date()), () => null);
}

/**
 * Start of a new chat: a left-aligned greeting. The chat is created on
 * the first send; once the server confirms the question the URL becomes /chat/<id> while the
 * answer keeps streaming in the provider. Attaching a file creates the chat at
 * once, so the file has a chat to belong to, and opens it with the draft.
 */
export function NewChatView() {
  const t = useTranslations('chat');
  const locale = useLocale() as 'de' | 'en';
  const router = useRouter();
  const { data: config } = useConfig();
  const uploads = useUploads();
  const settings = useChatSettings();
  // Only for this greeting; the name never goes to the model.
  const { name } = usePreferences();
  const greeting = useGreeting();
  const { data: documents } = useDocuments();
  const suggestions = suggestionsFor(documents?.documents ?? []);
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

  const { addFiles, addLink, setDropTarget, openPicker } = uploads;
  const [linkOpen, setLinkOpen] = useState(false);
  /** Creates the chat, hands it what was attached, then opens it with the draft. */
  const attachTo = async (add: (chatId: string) => void) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    clearRefusal();
    try {
      const { chat } = await createChat.mutateAsync(scopeBody());
      add(chat.id);
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
  const attachFiles = (files: File[]) => attachTo((chatId) => addFiles(files, chatId));
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
        <ChatHeader title={<span className="sr-only">{t('untitled')}</span>}>{null}</ChatHeader>
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
            onAttachLink={() => setLinkOpen(true)}
            busy={false}
            sending={sending}
            blocked={block !== null || !settings.model || down || waiting}
            maxChars={config?.limits.max_question_chars}
            describedBy={notice ? NOTICE_ID : block === 'noDocuments' ? 'new-chat-hint' : undefined}
            tools={<ScopePicker value={scope} onChange={setScope} />}
            models={<ModelControls />}
            autoFocus
          />
        </>
      }
    >
      <div className="flex min-h-[calc(100dvh-var(--spacing)*72)] flex-col">
        <div aria-hidden className="min-h-6 flex-2" />
        {/* Fades in once the viewer's clock is known, so the server's greeting never flips. */}
        <h2
          className={cn(
            'text-title-1 font-semibold wrap-anywhere transition-opacity duration-500 ease-out-soft sm:text-large-title',
            greeting === null && 'opacity-0',
          )}
        >
          {t(`greeting.${greeting ?? 'day'}`)}
          {name && (
            <>
              {', '}
              <bdi>{name}</bdi>
            </>
          )}
        </h2>
        {readyCount > 0 && <p className="mt-1 text-reading text-ink-muted">{t('ready', { count: readyCount })}</p>}

        {hasDocuments ? (
          suggestions.length > 0 && (
            // Plain rows like Spotlight suggestions: a quiet glyph on the text edge, the question,
            // a fill on hover. The glyph turns to ink with the row.
            <ul aria-label={t('suggestionsLabel')} className="-mx-3 mt-8 flex flex-col gap-0.5 sm:max-w-xl">
              {suggestions.map(({ key, name }) => (
                <li key={key}>
                  <button
                    type="button"
                    disabled={sending || block !== null || down || waiting}
                    onClick={() => void submit(t(`suggestions.${key}`, { name: name ?? '' }))}
                    className="group flex h-10 w-full items-center gap-3 rounded-control px-3 text-left text-body text-ink/85 transition-colors hover:bg-fill hover:text-ink disabled:opacity-50 pointer-coarse:h-11"
                  >
                    <CornerDownRight
                      aria-hidden
                      className="size-4 shrink-0 text-ink-muted/70 transition-colors group-hover:text-ink"
                    />
                    <span className="min-w-0 truncate">{t(`suggestions.${key}`, { name: name ?? '' })}</span>
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
              className="group mt-8 flex w-full items-center gap-4 rounded-card border border-dashed border-hairline-strong p-4 text-left transition-colors hover:border-ink-muted/40 hover:bg-fill"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-fill-strong text-ink">
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
      <ImportLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onImport={(url) => void attachTo((chatId) => addLink(url, chatId))}
      />
    </ChatFrame>
  );
}
