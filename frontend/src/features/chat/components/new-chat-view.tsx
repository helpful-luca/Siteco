'use client';

import { FileUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useUploads } from '@/features/library';
import { ApiError } from '@/shared/api/errors';
import { useConfig } from '@/shared/api/use-config';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { useChatSettings } from '../chat-settings';
import { useCreateChat, useDeleteChat } from '../queries';
import { useStreams } from '../stream/stream-provider';
import { useComposerBlock } from '../use-composer-state';
import { ChatFrame } from './chat-frame';
import { ChatHeader } from './chat-header';
import { Composer } from './composer';
import { ComposerNotice } from './composer-notice';
import { ModelPicker } from './model-picker';
import { ScopePicker, type ScopeValue } from './scope-picker';

const NOTICE_ID = 'composer-notice';
const NEW = 'new';
const SUGGESTIONS = ['summary', 'specs', 'norms'] as const;

/**
 * Start of a new chat: a left-aligned greeting (design plan: no card trio). The chat is created on
 * the first send; once the server confirms the question the URL becomes /chat/<id> while the
 * answer keeps streaming in the provider (annex 11, 8.1).
 */
export function NewChatView() {
  const t = useTranslations('chat');
  const text = useCodeText();
  const locale = useLocale() as 'de' | 'en';
  const router = useRouter();
  const { data: config } = useConfig();
  const uploads = useUploads();
  const settings = useChatSettings();
  const streams = useStreams();
  const createChat = useCreateChat();
  const deleteChat = useDeleteChat();
  const { block, readyCount } = useComposerBlock();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<ScopeValue>({ scope: 'all' });
  const [draft, setDraftState] = useState(() => settings.draft(NEW));
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<ApiError | null>(null);

  const setDraft = (value: string) => {
    setDraftState(value);
    settings.setDraft(NEW, value);
  };

  const submit = async (question: string) => {
    if (!settings.model || sending) return;
    setSending(true);
    setRefusal(null);
    let chatId: string | null = null;
    try {
      const { chat } = await createChat.mutateAsync(
        scope.scope === 'all' ? { scope: 'all' } : { scope: 'selected', document_ids: scope.documentIds },
      );
      chatId = chat.id;
      await streams.ask({ chatId, question, model: settings.model, locale });
      setDraft('');
      router.replace(`/chat/${chatId}`);
    } catch (error) {
      // Refused before the stream: no empty chat stays behind, the question stays in the composer.
      if (chatId) deleteChat.mutate(chatId);
      setRefusal(error instanceof ApiError ? error : new ApiError('UNKNOWN_ERROR', 0));
      setSending(false);
    }
  };

  const hasDocuments = block !== 'noDocuments';
  const notice = refusal ? (
    <ComposerNotice id={NOTICE_ID} tone="error" onDismiss={() => setRefusal(null)}>
      {text.error(refusal.code, { seconds: refusal.retryAfter ?? 0, ...(refusal.params as Record<string, string>) })}
    </ComposerNotice>
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
          <ModelPicker value={settings.model} onChange={settings.setModel} />
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
            onAttach={uploads.openPicker}
            busy={false}
            sending={sending}
            blocked={block !== null || !settings.model}
            maxChars={config?.limits.max_question_chars}
            describedBy={notice ? NOTICE_ID : block === 'noDocuments' ? 'new-chat-hint' : undefined}
            autoFocus
          />
        </>
      }
    >
      <div className="flex min-h-[calc(100dvh-var(--spacing)*72)] flex-col">
        <div aria-hidden className="min-h-6 flex-2" />
        <h2 className="text-title-1 font-semibold">{t('greeting')}</h2>
        <p className="mt-2 text-reading text-ink-muted">{t('prompt')}</p>

        {hasDocuments ? (
          readyCount > 0 && (
            <ul aria-label={t('suggestionsLabel')} className="mt-8 flex flex-col items-start gap-1">
              {SUGGESTIONS.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    disabled={sending || block !== null}
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
              onClick={uploads.openPicker}
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
