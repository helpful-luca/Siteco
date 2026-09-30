'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useUploads } from '@/features/library';
import { Page } from '@/features/shell';
import { ApiError } from '@/shared/api/errors';
import { useConfig } from '@/shared/api/use-config';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { Button, buttonStyles, cn, DelayedSpinner } from '@/shared/ui';
import { useChatSettings } from '../chat-settings';
import { isNotFound, useChat, useMessages, useUpdateChat } from '../queries';
import { isRunning } from '../stream/stream-reducer';
import { useRun, useStreamActions } from '../stream/stream-provider';
import { buildTurns, runIsPersisted, type Turn } from '../turns';
import { useComposerBlock } from '../use-composer-state';
import { useFollowScroll } from '../use-follow-scroll';
import { AssistantMessage } from './assistant-message';
import { ChatFrame } from './chat-frame';
import { ChatHeader } from './chat-header';
import { Composer } from './composer';
import { ComposerNotice } from './composer-notice';
import { ModelPicker } from './model-picker';
import { ScopePicker, type ScopeValue } from './scope-picker';
import { UserMessage } from './user-message';

const NOTICE_ID = 'composer-notice';

/** An existing chat: the conversation, live answers from the stream provider, the composer. */
export function ChatView({ chatId }: { chatId: string }) {
  const t = useTranslations('chat');
  const text = useCodeText();
  const locale = useLocale() as 'de' | 'en';
  const { data: config } = useConfig();
  const chat = useChat(chatId);
  const run = useRun(chatId);
  const running = isRunning(run);
  const messages = useMessages(chatId, { poll: !running });
  const streams = useStreamActions();
  const settings = useChatSettings();
  const updateChat = useUpdateChat();
  const uploads = useUploads();
  const { block } = useComposerBlock();

  const { scrollRef, contentRef, atEnd, scrolled, scrollToEnd, scrollToTop } = useFollowScroll();
  const [viewHeight, setViewHeight] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);
  const [draft, setDraftState] = useState(() => settings.draft(chatId));
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const setDraft = (value: string) => {
    setDraftState(value);
    settings.setDraft(chatId, value);
  };

  const list = messages.data?.messages;
  const turns = buildTurns(list ?? [], run);

  // A finished run leaves once the saved answer is loaded, so nothing flickers.
  useEffect(() => {
    if (run && list && runIsPersisted(list, run)) streams.clear(chatId);
  }, [run, list, streams, chatId]);

  // Leaving the chat drops a finished run; the saved answer loads on the next visit.
  useEffect(
    () => () => {
      if (streams.getRun(chatId)?.outcome) streams.clear(chatId);
    },
    [streams, chatId],
  );

  // A new question (or regenerated answer) moves to the top and its turn fills the view.
  const liveTurn = run?.meta?.user_message_id ?? null;
  if (liveTurn && liveTurn !== pinned) setPinned(liveTurn);
  useEffect(() => {
    if (!liveTurn) return;
    requestAnimationFrame(() => {
      const element = contentRef.current?.querySelector<HTMLElement>(`[data-turn="${liveTurn}"]`);
      if (element) scrollToTop(element);
    });
  }, [liveTurn, scrollToTop, contentRef]);

  // Opening a chat shows its end.
  const loaded = Boolean(list);
  useEffect(() => {
    if (loaded) requestAnimationFrame(() => scrollToEnd(false));
  }, [loaded, scrollToEnd]);

  // One short, polite announcement when an answer ends, instead of every token (annex 10, O7).
  const outcome = run?.outcome?.kind;
  const announcement =
    outcome === 'done'
      ? t('announce.ready')
      : outcome === 'stopped'
        ? t('announce.stopped')
        : outcome === 'error'
          ? t('announce.failed')
          : '';

  const submit = async (question: string) => {
    // A ref, not state: a second Enter in the same frame must not send twice.
    if (!settings.model || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setRefusal(null);
    try {
      if (await streams.ask({ chatId, question, model: settings.model, locale })) setDraft('');
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      if (apiError?.code !== 'DUPLICATE_REQUEST') setRefusal(apiError ?? new ApiError('UNKNOWN_ERROR', 0));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const model = settings.model;
  const defaultModel = config?.default_model;
  const regenerate = useCallback(
    async (assistantId: string, question: string, previousModel: string | null) => {
      setRefusal(null);
      try {
        await streams.regenerate({
          chatId,
          assistantId,
          question,
          model: model ?? previousModel ?? defaultModel ?? '',
          locale,
        });
      } catch (error) {
        setRefusal(error instanceof ApiError ? error : new ApiError('UNKNOWN_ERROR', 0));
      }
    },
    [streams, chatId, model, defaultModel, locale],
  );

  if (isNotFound(chat.error) || isNotFound(messages.error)) {
    return (
      <Page width="reading" center>
        <h1 className="text-title-2 font-semibold">{t('notFound.title')}</h1>
        <p className="mt-2 text-body text-ink-muted">{t('notFound.text')}</p>
        <Link href="/chat" className={cn(buttonStyles({ variant: 'primary' }), 'mt-6 w-fit')}>
          {t('notFound.action')}
        </Link>
      </Page>
    );
  }

  const current = chat.data?.chat;
  const scope: ScopeValue =
    current?.scope === 'selected' ? { scope: 'selected', documentIds: current.document_ids } : { scope: 'all' };
  const changeScope = (next: ScopeValue) =>
    updateChat.mutate({
      chatId,
      patch: next.scope === 'all' ? { scope: 'all' } : { scope: 'selected', document_ids: next.documentIds },
    });

  const lastTurn = turns.at(-1);
  const notice = refusal ? (
    <ComposerNotice id={NOTICE_ID} tone="error" onDismiss={() => setRefusal(null)}>
      {text.error(refusal.code, refusal.params, refusal.retryAfter)}
    </ComposerNotice>
  ) : block ? (
    <ComposerNotice
      id={NOTICE_ID}
      tone="info"
      action={
        block === 'noDocuments' ? (
          <Button size="sm" onClick={uploads.openPicker}>
            {t('composer.addDocuments')}
          </Button>
        ) : undefined
      }
    >
      {t(`composer.${block}`)}
    </ComposerNotice>
  ) : null;

  return (
    <ChatFrame
      scrollRef={scrollRef}
      contentRef={contentRef}
      showJump={!atEnd}
      scrolled={scrolled}
      onJump={() => scrollToEnd()}
      onViewHeight={setViewHeight}
      header={
        <ChatHeader title={current ? (current.title ?? t('untitled')) : ''}>
          <ScopePicker value={scope} onChange={changeScope} disabled={!current} />
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
            onStop={() => void streams.stop(chatId)}
            onAttach={uploads.openPicker}
            busy={running}
            sending={sending}
            blocked={block !== null || !settings.model}
            maxChars={config?.limits.max_question_chars}
            describedBy={notice ? NOTICE_ID : undefined}
            autoFocus
          />
        </>
      }
    >
      {!list ? (
        messages.error ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-body">{t('loadError')}</p>
            <Button onClick={() => messages.refetch()}>{t('retry')}</Button>
          </div>
        ) : (
          <div className="grid place-items-center py-24">
            <DelayedSpinner label={t('loading')} className="size-5" />
          </div>
        )
      ) : (
        <ol className="flex flex-col gap-12">
          {turns.map((turn) => {
            const isLast = turn === lastTurn;
            const answer = turn.answer;
            const canRegenerate = Boolean(
              isLast && answer?.messageId && !running && answer.status !== 'streaming' && answer.status !== 'sources_only',
            );
            return (
              <TurnRow
                key={turn.key}
                turn={turn}
                minHeight={isLast && turn.key === pinned && viewHeight > 0 ? viewHeight : undefined}
                chatTitle={current?.title ?? null}
                canRegenerate={canRegenerate}
                onRegenerate={regenerate}
              />
            );
          })}
        </ol>
      )}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </ChatFrame>
  );
}

type TurnRowProps = {
  turn: Turn;
  minHeight: number | undefined;
  chatTitle: string | null;
  canRegenerate: boolean;
  onRegenerate: (assistantId: string, question: string, previousModel: string | null) => void;
};

/** One question and its answer. Memoised: while an answer streams, only its own row renders. */
const TurnRow = memo(function TurnRow({ turn, minHeight, chatTitle, canRegenerate, onRegenerate }: TurnRowProps) {
  const answer = turn.answer;
  const messageId = answer?.messageId;
  return (
    <li data-turn={turn.key} className="flex flex-col gap-8" style={minHeight ? { minHeight } : undefined}>
      <UserMessage text={turn.question} />
      {answer && (
        <AssistantMessage
          answer={answer}
          chatTitle={chatTitle}
          onRegenerate={
            canRegenerate && messageId ? () => onRegenerate(messageId, turn.question, answer.model) : undefined
          }
        />
      )}
    </li>
  );
});
