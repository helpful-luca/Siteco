'use client';

import { Code2, RotateCcw, Table2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { AnswerMarkdown, markCitations, SourcesList } from '@/features/citations';
import { useActiveSourceId, useOpenArtifact, useOpenSource } from '@/features/viewer';
import type { NoticeOut, SourceOut } from '@/shared/api/types';
import type { MarkdownBlock } from '@/shared/markdown';
import { Button, Tooltip } from '@/shared/ui';
import type { Answer } from '../answer';
import { AnswerError } from './answer-error';
import { AnswerFooter } from './answer-footer';
import { AnswerNotices } from './answer-notices';
import { SourcesOnlyCard } from './sources-only-card';
import { StatusLine } from './status-line';

/** Answers longer than this get an "open in panel" action (annex 11, 8.4). */
export const ARTIFACT_MIN_CHARS = 1500;
const LEADING_NOTICES = new Set(['SOURCES_PARTIAL', 'SUMMARY_PARTIAL']);

type Props = {
  answer: Answer;
  chatTitle: string | null;
  /** Only the answer to the latest question can be regenerated, optionally with another model. */
  onRegenerate?: (model?: string) => void;
  /** In a comparison column: retry only this lane, no other model, details in the column head. */
  inComparison?: boolean;
};

function hash(text: string): string {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) | 0;
  return (value >>> 0).toString(36);
}

/** The answer: no bubble, reading width, chips in the text, then sources and details. */
export function AssistantMessage({ answer, chatTitle, onRegenerate, inComparison = false }: Props) {
  const t = useTranslations('chat');
  const openSource = useOpenSource();
  const openArtifact = useOpenArtifact();
  const activeSourceId = useActiveSourceId(answer.key);
  const streaming = answer.status === 'streaming' && answer.live;
  const elsewhere = answer.status === 'streaming' && !answer.live;
  const settled = answer.status !== 'streaming';

  const open = useCallback(
    (source: SourceOut, citedText: string | null) =>
      openSource({ messageKey: answer.key, source, citedText, citations: answer.citations }),
    [openSource, answer.key, answer.citations],
  );

  // Stable while the answer is unchanged: a new function would remount every rendered block, and
  // with it the chip that should get focus back when the source panel closes.
  const { citations, sources, key: messageKey } = answer;
  const blockAction = useMemo(
    () =>
      settled
        ? (block: MarkdownBlock) => {
            const label = block.kind === 'table' ? t('answer.openTable') : t('answer.openCode');
            const open = () =>
              openArtifact(
                { kind: block.kind, markdown: block.source, citations, sources, messageKey, chatTitle },
                `${messageKey}:${hash(block.source)}`,
              );
            return (
              <Tooltip content={label}>
                <Button icon variant="ghost" size="sm" aria-label={label} onClick={open}>
                  {block.kind === 'table' ? <Table2 /> : <Code2 />}
                </Button>
              </Tooltip>
            );
          }
        : undefined,
    [settled, t, openArtifact, citations, sources, messageKey, chatTitle],
  );

  const openWholeAnswer =
    settled && answer.text.length > ARTIFACT_MIN_CHARS
      ? () =>
          openArtifact(
            {
              kind: 'answer',
              markdown: markCitations(answer.text, answer.citations, answer.sources),
              citations: answer.citations,
              sources: answer.sources,
              messageKey: answer.key,
              chatTitle,
            },
            `${answer.key}:answer`,
          )
      : undefined;

  const leading: NoticeOut[] = answer.notices.filter((n) => LEADING_NOTICES.has(n.code));
  const trailing: NoticeOut[] = answer.notices.filter(
    (n) => !LEADING_NOTICES.has(n.code) && !(answer.status === 'sources_only' && n.code === 'LLM_NOT_CONFIGURED'),
  );
  const label =
    answer.status === 'stopped'
      ? t('answer.stopped')
      : answer.status === 'interrupted'
        ? t('answer.interrupted')
        : answer.error?.partial
          ? t('answer.incomplete')
          : null;
  const retry = onRegenerate ? () => onRegenerate() : undefined;
  const hasFooter =
    settled && answer.status !== 'error' && answer.status !== 'refused' && (answer.text.length > 0 || answer.sources.length > 0);

  return (
    <article aria-label={t('answer.label')} aria-busy={streaming} className="flex flex-col gap-4 transition-opacity duration-300 ease-out-soft starting:opacity-0">
      {leading.length > 0 && <AnswerNotices notices={leading} />}
      {streaming && !answer.text && answer.phase && <StatusLine phase={answer.phase} startedAt={answer.startedAt} />}
      {elsewhere && <p className="text-footnote text-ink-muted">{t('answer.otherWindow')}</p>}

      {answer.status === 'sources_only' ? (
        <SourcesOnlyCard sources={answer.sources} onOpen={(source) => open(source, null)} />
      ) : (
        answer.text && (
          <AnswerMarkdown
            text={answer.text}
            citations={answer.citations}
            sources={answer.sources}
            streaming={streaming}
            activeSourceId={activeSourceId}
            onOpenSource={open}
            blockAction={blockAction}
          />
        )
      )}
      {streaming && answer.text && answer.phase && <StatusLine phase={answer.phase} startedAt={null} />}

      {label && <p className="text-caption font-medium text-ink-muted">{label}</p>}
      {answer.error && (
        <AnswerError
          error={answer.error}
          model={answer.model}
          onRetry={retry}
          onRetryWith={inComparison ? undefined : onRegenerate}
        />
      )}
      {label && !answer.error && !hasFooter && retry && (
        <Button size="sm" variant="ghost" className="-ml-3 w-fit" onClick={retry}>
          <RotateCcw aria-hidden />
          {t('answer.regenerate')}
        </Button>
      )}
      {settled && trailing.length > 0 && <AnswerNotices notices={trailing} />}

      {hasFooter && (
        <div className="flex flex-col gap-2">
          {answer.status !== 'sources_only' && (
            <SourcesList
              sources={answer.sources}
              citations={answer.citations}
              activeSourceId={activeSourceId}
              onOpenSource={open}
            />
          )}
          <AnswerFooter
            answer={answer}
            onRegenerate={retry}
            onOpenArtifact={openWholeAnswer}
            showDetails={!inComparison}
          />
        </div>
      )}
    </article>
  );
}
