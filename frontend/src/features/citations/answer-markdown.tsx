'use client';

import { createContext, useContext, useMemo } from 'react';
import type { Components } from 'react-markdown';
import type { CitationOut, SourceOut } from '@/shared/api/types';
import { Markdown, type MarkdownBlock } from '@/shared/markdown';
import type { ReactNode } from 'react';
import { CitationChip } from './citation-chip';
import { insertSentinels } from './insert-sentinels';
import { CITATION_ATTRIBUTE, GROUP_ATTRIBUTE, remarkCitations } from './remark-citations';

const PLUGINS = [remarkCitations];

/** The answer text with a sentinel wherever a chip goes. */
export function markCitations(text: string, citations: CitationOut[], sources: SourceOut[]): string {
  const indexOf = new Map(sources.map((s) => [s.id, s.index]));
  const marks = citations.flatMap((c) => {
    const n = indexOf.get(c.source_id);
    return n === undefined ? [] : [{ offset: c.char_offset, n }];
  });
  return insertSentinels(text, marks);
}

type Props = {
  /** Plain answer text, or already marked text (`marked`), e.g. one table of an answer. */
  text: string;
  marked?: boolean;
  citations: CitationOut[];
  sources: SourceOut[];
  streaming?: boolean;
  activeSourceId?: string | null;
  onOpenSource?: (source: SourceOut, citedText: string | null) => void;
  blockAction?: (block: MarkdownBlock) => ReactNode;
  className?: string;
};

type ChipContext = {
  byIndex: Map<number, SourceOut>;
  citations: CitationOut[];
  activeSourceId: string | null;
  onOpenSource?: (source: SourceOut, citedText: string | null) => void;
};

// Chips read what changes (the active source) from context, so the markdown components stay the
// same objects: the chips are not remounted when a panel opens, and focus can return to them.
const ChipContext = createContext<ChipContext | null>(null);

function Chip({ n }: { n: number }) {
  const context = useContext(ChipContext);
  const source = context?.byIndex.get(n);
  const citedText = source ? (context?.citations.find((c) => c.source_id === source.id)?.cited_text ?? null) : null;
  const onOpenSource = context?.onOpenSource;
  return (
    <CitationChip
      n={n}
      source={source}
      citedText={citedText}
      active={source !== undefined && source.id === context?.activeSourceId}
      onOpen={source && onOpenSource ? () => onOpenSource(source, citedText) : undefined}
    />
  );
}

const COMPONENTS: Components = {
  span: (props) => {
    const attributes = props as Record<string, unknown>;
    if (attributes[GROUP_ATTRIBUTE] !== undefined) return <span className="whitespace-nowrap">{props.children}</span>;
    const value = attributes[CITATION_ATTRIBUTE];
    if (value === undefined) return <span>{props.children}</span>;
    return <Chip n={Number(value)} />;
  },
};

/** Answer markdown with citation chips at the offsets the backend reported. */
export function AnswerMarkdown({
  text,
  marked: premarked = false,
  citations,
  sources,
  streaming = false,
  activeSourceId = null,
  onOpenSource,
  blockAction,
  className,
}: Props) {
  const byIndex = useMemo(() => new Map(sources.map((s) => [s.index, s])), [sources]);
  const marked = useMemo(
    () => (premarked ? text : markCitations(text, citations, sources)),
    [premarked, text, citations, sources],
  );

  const chips = useMemo<ChipContext>(
    () => ({ byIndex, citations, activeSourceId, onOpenSource }),
    [byIndex, citations, activeSourceId, onOpenSource],
  );

  return (
    <ChipContext.Provider value={chips}>
      <Markdown
        text={marked}
        streaming={streaming}
        remarkPlugins={PLUGINS}
        components={COMPONENTS}
        blockAction={blockAction}
        className={className}
      />
    </ChipContext.Provider>
  );
}
