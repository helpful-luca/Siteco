'use client';

import type { Element, ElementContent } from 'hast';
import { useTranslations } from 'next-intl';
import { memo, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PluggableList } from 'unified';
import { cn, CopyButton } from '@/shared/ui';
import { closeOpenBlocks } from './close-open-blocks';
import { safeUrl } from './safe-url';
import { splitSettled } from './split-blocks';

const GFM = [remarkGfm];
const NO_IMAGES = ['img'];
const toSafeUrl = (url: string) => safeUrl(url) ?? '';

type ChunkProps = { text: string; plugins: PluggableList; components: Components };

/** One parse of one piece of markdown. Memoised, so finished blocks of a stream parse once. */
const Chunk = memo(function Chunk({ text, plugins, components }: ChunkProps) {
  return (
    <ReactMarkdown
      remarkPlugins={plugins}
      skipHtml
      disallowedElements={NO_IMAGES}
      urlTransform={toSafeUrl}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});

/** A table or code block, with its markdown source, for actions like "open in panel". */
export type MarkdownBlock = { kind: 'table' | 'code'; source: string; language: string | null };

type Props = {
  text: string;
  /** While streaming, open code fences and half tables are closed before parsing. */
  streaming?: boolean;
  /** Extra remark plugins (the chat adds citations; this module knows nothing about them). */
  remarkPlugins?: PluggableList;
  /** Extra renderers, merged over the safe defaults. */
  components?: Components;
  /** Rendered next to every table and code block. */
  blockAction?: (block: MarkdownBlock) => ReactNode;
  className?: string;
};

function textOf(node: ElementContent | Element): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

function sourceOf(text: string, node: Element | undefined): string {
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  return start === undefined || end === undefined ? '' : text.slice(start, end);
}

function languageOf(node: Element | undefined): string | null {
  const code = node?.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code');
  const classes = code?.properties.className;
  const match = Array.isArray(classes)
    ? classes.map(String).find((name) => name.startsWith('language-'))
    : undefined;
  return match ? match.slice('language-'.length) : null;
}

const NONE: PluggableList = [];

type Translate = (key: 'code' | 'copyCode' | 'copied') => string;

/** Safe renderers: links only to web and mail, code with copy, scrollable tables. */
function defaultsFor(t: Translate, source: string, blockAction: Props['blockAction']): Components {
  return {
    a: ({ href, children }) => {
      const url = href ? safeUrl(href) : null;
      if (!url) return <span>{children}</span>;
      return (
        <a href={url} target="_blank" rel="noopener noreferrer nofollow">
          {children}
        </a>
      );
    },
    p: ({ children }) => <p dir="auto">{children}</p>,
    li: ({ children, className: itemClass }) => (
      <li dir="auto" className={itemClass}>
        {children}
      </li>
    ),
    pre: ({ node, children }) => {
      const language = languageOf(node);
      const code = node ? textOf(node).replace(/\n$/, '') : '';
      return (
        <div className="md-code">
          <div className="flex h-8 items-center justify-between gap-2 pr-1 pl-4">
            <span className="truncate text-caption text-ink-muted">{language ?? t('code')}</span>
            <span className="flex items-center">
              {blockAction?.({ kind: 'code', source: sourceOf(source, node), language })}
              <CopyButton text={code} label={t('copyCode')} copiedLabel={t('copied')} />
            </span>
          </div>
          <pre>{children}</pre>
        </div>
      );
    },
    table: ({ node, children }) => (
      <div className="md-table">
        <div className="overflow-x-auto">
          <table>{children}</table>
        </div>
        {blockAction && (
          <div className="mt-1 flex justify-end">
            {blockAction({ kind: 'table', source: sourceOf(source, node), language: null })}
          </div>
        )}
      </div>
    ),
    input: ({ checked, type }) =>
      type === 'checkbox' ? <input type="checkbox" checked={Boolean(checked)} disabled readOnly /> : null,
  };
}

/**
 * Markdown for answers: GFM tables, lists and code, but no HTML, no images and only http(s) and
 * mailto links (annex 11, 8.4). Safe by default: raw HTML is skipped, never rendered.
 */
export function Markdown({ text, streaming = false, remarkPlugins = NONE, components, blockAction, className }: Props) {
  const t = useTranslations('markdown');
  // The source text only matters for block actions (settled answers); while streaming the
  // renderers stay identical from frame to frame, so memoised blocks do not render again.
  const source = blockAction ? text : '';
  const merged = useMemo<Components>(
    () => ({ ...defaultsFor(t, source, blockAction), ...components }),
    [t, source, blockAction, components],
  );
  const plugins = useMemo(() => [...GFM, ...remarkPlugins], [remarkPlugins]);

  if (!streaming) {
    return (
      <div className={cn('markdown', className)}>
        <Chunk text={text} plugins={plugins} components={merged} />
      </div>
    );
  }
  // Streaming: finished blocks render once, only the growing tail is parsed on every frame.
  const { settled, tail } = splitSettled(text);
  return (
    <div className={cn('markdown', className)}>
      {settled.map((block, index) => (
        <Chunk key={index} text={block} plugins={plugins} components={merged} />
      ))}
      <Chunk text={closeOpenBlocks(tail)} plugins={plugins} components={merged} />
    </div>
  );
}
