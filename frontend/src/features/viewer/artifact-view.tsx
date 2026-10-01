'use client';

import { Download, FileSpreadsheet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { AnswerMarkdown, stripSentinels } from '@/features/citations';
import type { CitationOut, SourceOut } from '@/shared/api/types';
import { downloadText } from '@/shared/lib/download';
import { Button, CopyButton, Tooltip } from '@/shared/ui';
import { downloadName } from './file-name';
import { tableToCsv } from './table-export';
import { useActiveSourceId, useOpenSource } from './use-open-source';

export type Artifact = {
  kind: 'answer' | 'table' | 'code';
  /** Markdown of the whole answer or of one block, with citation sentinels already in place. */
  markdown: string;
  /** For the cited sentence in chip previews. */
  citations: CitationOut[];
  sources: SourceOut[];
  messageKey: string;
  chatTitle: string | null;
};

/** A wide reading view of an answer, table or code block with copy and exports. */
export function ArtifactView({ artifact }: { artifact: Artifact }) {
  const t = useTranslations('viewer.artifact');
  const locale = useLocale();
  const openSource = useOpenSource();
  const activeSourceId = useActiveSourceId(artifact.messageKey);
  const plain = stripSentinels(artifact.markdown);
  const name = (extension: string) => downloadName(artifact.chatTitle, t('fallbackName'), extension);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
        <Tooltip content={t('saveMarkdown')}>
          <Button
            size="sm"
            aria-label={t('saveMarkdown')}
            onClick={() => downloadText(name('md'), plain, 'text/markdown;charset=utf-8')}
          >
            <Download aria-hidden />
            Markdown
          </Button>
        </Tooltip>
        {artifact.kind === 'table' && (
          <Tooltip content={t('saveCsv')}>
            <Button
              size="sm"
              aria-label={t('saveCsv')}
              onClick={() =>
                downloadText(name('csv'), tableToCsv(artifact.markdown, locale === 'de' ? ';' : ','), 'text/csv;charset=utf-8')
              }
            >
              <FileSpreadsheet aria-hidden />
              CSV
            </Button>
          </Tooltip>
        )}
        <CopyButton text={plain} label={t('copy')} copiedLabel={t('copied')} />
      </div>
      <div className="px-6 pt-6 pb-16">
        <AnswerMarkdown
          text={artifact.markdown}
          marked
          citations={artifact.citations}
          sources={artifact.sources}
          activeSourceId={activeSourceId}
          onOpenSource={(source, citedText) =>
            openSource({ messageKey: artifact.messageKey, source, citedText, citations: artifact.citations })
          }
          className="markdown-wide"
        />
      </div>
    </div>
  );
}
