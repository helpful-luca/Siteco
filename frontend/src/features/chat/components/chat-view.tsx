'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AttachmentsButton, AttachmentTray, ImportLinkDialog, useUploads } from '@/features/library';
import { Page } from '@/features/shell';
import { toApiError } from '@/shared/api/errors';
import type { Lane } from '@/shared/api/types';
import { useConfig } from '@/shared/api/use-config';
import { useBackendDown } from '@/shared/api/use-connection';
import { Button, buttonStyles, cn, DelayedSpinner } from '@/shared/ui';
import { useChatSettings } from '../chat-settings';
import type { Answer } from '../answer';
import { isNotFound, useChat, useMessages, usePreferAnswer, useUpdateChat } from '../queries';
import { sendQuestion } from '../send-question';
import { isRunning } from '../stream/stream-reducer';
import { useRun, useStreamActions } from '../stream/stream-provider';
import { buildTurns, runIsPersisted, type Turn } from '../turns';
import { useComposerBlock } from '../use-composer-state';
import { useFollowScroll } from '../use-follow-scroll';
import { useRefusal } from '../use-refusal';
import { AssistantMessage } from './assistant-message';
import { ChatFrame } from './chat-frame';
import { ChatHeader } from './chat-header';
import { Composer } from './composer';
import { ComposerNotice } from './composer-notice';
import { CompareTurn } from './compare-turn';
import { ModelControls } from './model-controls';
import { OfflineNotice } from './offline-notice';
import { RefusalNotice } from './refusal-notice';
import { ScopePicker, type ScopeValue } from './scope-picker';
import { UserMessage } from './user-message';

const NOTICE_ID = 'composer-notice';

/** An existing chat: the conversation, live answers from the stream provider, the composer. */
export function ChatView({ chatId }: { chatId: string }) {
  const t = useTranslations('chat');
  const locale = useLocale() as 'de' | 'en';
  const { data: config } = useConfig();
  const chat = useChat(chatId);
  const runA = useRun(chatId, 'a');
  const runB = useRun(chatId, 'b');
  const running = isRunning(runA) || isRunning(runB);
  const messages = useMessages(chatId, { poll: !running });
  const streams = useStreamActions();
  const settings = useChatSettings();
  const updateChat = useUpdateChat();
  const preferAnswer = usePreferAnswer();
  const uploads = useUploads();
  const { block } = useComposerBlock(chatId);
  const down = useBackendDown();

  const { scrollRef, contentRef, atEnd, scrolled, scrollToEnd, scrollToTop } = useFollowScroll();
  const [viewHeight, setViewHeight] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);
  const [draft, setDraftState] = useState(() => settings.draft(chatId));
  const { refusal, refuse, clear: clearRefusal, endWait, waiting } = useRefusal();
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const setDraft = (value: string) => {
    setDraftState(value);
    settings.setDraft(chatId, value);
  };

  // Files dropped on the window while this chat is open become its attachments.
  const { addFiles, setDropTarget, openPicker } = uploads;
  useEffect(() => {
    setDropTarget({ onFiles: (files) => addFiles(files, chatId) });
    return () => setDropTarget(null);
  }, [addFiles, setDropTarget, chatId]);
  const attach = () => openPicker({ chatId });
  const [linkOpen, setLinkOpen] = useState(false);

  const list = messages.data?.messages;
  const turns = buildTurns(list ?? [], [runA, runB]);

  // A finished run leaves once the saved answer is loaded, so nothing flickers.
  useEffect(() => {
    for (const run of [runA, runB]) {
      if (run && list && runIsPersisted(list, run)) streams.clear(chatId, run.lane);
    }
  }, [runA, runB, list, streams, chatId]);

  // Leaving the chat drops finished runs; the saved answers load on the next visit.
  useEffect(
    () => () => {
      for (const lane of ['a', 'b'] as const) {
        if (streams.getRun(chatId, lane)?.outcome) streams.clear(chatId, lane);
      }
    },
    [streams, chatId],
  );

  // A new question (or regenerated answer) moves to the top and its turn fills the view.
  const run = runA ?? runB;
  const liveTurn = (runA?.meta ?? runB?.meta)?.user_message_id ?? null;
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
    clearRefusal();
    try {
      if (await sendQuestion(streams, settings, { chatId, question, locale })) setDraft('');
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code !== 'DUPLICATE_REQUEST') refuse(apiError);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const model = settings.model;
  const answerOptions = settings.answerOptions;
  const defaultModel = config?.default_model;
  const regenerate = useCallback(
    async (assistantId: string, question: string, previousModel: string | null, override?: string) => {
      clearRefusal();
      try {
        const chosen = override ?? model ?? previousModel ?? defaultModel ?? '';
        await streams.regenerate({ chatId, assistantId, question, model: chosen, locale, ...answerOptions(chosen) });
      } catch (error) {
        refuse(toApiError(error));
      }
    },
    [streams, chatId, model, answerOptions, defaultModel, locale, clearRefusal, refuse],
  );

  /** One column of a comparison again, with its own model (the other column keeps its answer). */
  const regenerateLane = useCallback(
    async (answer: Answer, question: string) => {
      clearRefusal();
      const chosen = answer.model ?? '';
      try {
        if (answer.messageId) {
          await streams.regenerate({
            chatId,
            assistantId: answer.messageId,
            question,
            model: chosen,
            locale,
            lane: answer.lane,
            ...answerOptions(chosen),
          });
          return;
        }
        // Refused before its stream: the lane joins its question again.
        const refused = streams.getRun(chatId, answer.lane);
        if (refused && answer.comparisonId) {
          await streams.retryLane({
            chatId,
            question,
            locale,
            lane: answer.lane,
            clientMessageId: refused.clientMessageId,
            comparisonId: answer.comparisonId,
            model: chosen,
            ...answerOptions(chosen),
          });
        }
      } catch (error) {
        refuse(toApiError(error));
      }
    },
    [streams, chatId, locale, answerOptions, clearRefusal, refuse],
  );
  const stopLane = useCallback((lane: Lane) => void streams.stop(chatId, lane), [streams, chatId]);
  const { mutate: preferMutate } = preferAnswer;
  const prefer = useCallback(
    (answer: Answer) => {
      if (answer.messageId && answer.comparisonId) {
        preferMutate({ chatId, assistantId: answer.messageId, comparisonId: answer.comparisonId });
      }
    },
    [preferMutate, chatId],
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
  const notice = down ? (
    <OfflineNotice id={NOTICE_ID} />
  ) : refusal ? (
    <RefusalNotice id={NOTICE_ID} refusal={refusal} onDismiss={clearRefusal} onWaitEnd={endWait} />
  ) : block ? (
    <ComposerNotice
      id={NOTICE_ID}
      tone="info"
      action={
        block === 'noDocuments' ? (
          <Button size="sm" onClick={attach}>
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
          <AttachmentsButton chatId={chatId} />
          <ScopePicker value={scope} onChange={changeScope} disabled={!current} />
          <ModelControls />
        </ChatHeader>
      }
      dock={
        <>
          <AttachmentTray chatId={chatId} />
          {notice}
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            onStop={() => void streams.stop(chatId)}
            onAttach={attach}
            onAttachLink={() => setLinkOpen(true)}
            busy={running}
            sending={sending}
            blocked={block !== null || !settings.model || down || waiting}
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
      ) : turns.length === 0 ? (
        // Turns, not saved messages: a chat created by an attachment has none saved while its
        // first question is still live (the list reloads after the answer).
        <p className="pt-16 text-reading text-ink-muted">{t('emptyChat')}</p>
      ) : (
        <ol className="flex flex-col gap-12">
          {turns.map((turn) => {
            const isLast = turn === lastTurn;
            const answer = turn.answer;
            const canRegenerate = Boolean(
              isLast && answer?.messageId && !running && answer.status !== 'streaming' && answer.status !== 'sources_only',
            );
            if (turn.comparison) {
              return (
                <CompareRow
                  key={turn.key}
                  turn={turn}
                  minHeight={isLast && turn.key === pinned && viewHeight > 0 ? viewHeight : undefined}
                  chatTitle={current?.title ?? null}
                  canRegenerate={isLast && !running}
                  onRegenerate={regenerateLane}
                  onStop={stopLane}
                  onPrefer={prefer}
                />
              );
            }
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
      <ImportLinkDialog open={linkOpen} onOpenChange={setLinkOpen} onImport={(url) => uploads.addLink(url, chatId)} />
    </ChatFrame>
  );
}

type TurnRowProps = {
  turn: Turn;
  minHeight: number | undefined;
  chatTitle: string | null;
  canRegenerate: boolean;
  onRegenerate: (assistantId: string, question: string, previousModel: string | null, model?: string) => void;
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
            canRegenerate && messageId
              ? (model?: string) => onRegenerate(messageId, turn.question, answer.model, model)
              : undefined
          }
        />
      )}
    </li>
  );
});

type CompareRowProps = {
  turn: Turn;
  minHeight: number | undefined;
  chatTitle: string | null;
  canRegenerate: boolean;
  onRegenerate: (answer: Answer, question: string) => void;
  onStop: (lane: Lane) => void;
  onPrefer: (answer: Answer) => void;
};

/** A question with the two answers of a comparison side by side. */
const CompareRow = memo(function CompareRow({
  turn,
  minHeight,
  chatTitle,
  canRegenerate,
  onRegenerate,
  onStop,
  onPrefer,
}: CompareRowProps) {
  const question = turn.question;
  const regenerate = useCallback((answer: Answer) => onRegenerate(answer, question), [onRegenerate, question]);
  if (!turn.comparison) return null;
  return (
    <li data-turn={turn.key} className="flex flex-col gap-8" style={minHeight ? { minHeight } : undefined}>
      <UserMessage text={turn.question} />
      <CompareTurn
        comparison={turn.comparison}
        chatTitle={chatTitle}
        canRegenerate={canRegenerate}
        onRegenerate={regenerate}
        onStop={onStop}
        onPrefer={onPrefer}
      />
    </li>
  );
});
