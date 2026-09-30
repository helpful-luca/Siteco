import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import de from '../../../messages/de.json';
import { TooltipProvider } from '@/shared/ui';
import { Markdown } from './markdown';

function renderMarkdown(text: string, props: Partial<ComponentProps<typeof Markdown>> = {}) {
  return render(
    <NextIntlClientProvider locale="de" messages={de}>
      <TooltipProvider>
        <Markdown text={text} {...props} />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

describe('Markdown safety', () => {
  it('never renders raw HTML or scripts', () => {
    const { container } = renderMarkdown('Hallo <script>alert(1)</script> <b onclick="x()">fett</b>\n\n<div>block</div>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('div div div')).toBeNull();
    expect(container.innerHTML).not.toContain('onclick');
    expect(container.innerHTML).not.toContain('<script');
  });

  it('drops images, also as links to data or remote urls', () => {
    const { container } = renderMarkdown('![x](https://tracker.example/p.gif) ![y](data:image/png;base64,AAAA)');
    expect(container.querySelector('img')).toBeNull();
  });

  it('turns javascript: and data: links into plain text', () => {
    const { container } = renderMarkdown('[klick](javascript:alert(1)) und [daten](data:text/html,x) und [rel](/api/x)');
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('klick')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('javascript');
  });

  it('opens web and mail links safely in a new tab', () => {
    renderMarkdown('[Norm](https://example.com/norm) oder [Mail](mailto:info@example.com)');
    const link = screen.getByRole('link', { name: 'Norm' });
    expect(link).toHaveAttribute('href', 'https://example.com/norm');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Mail' })).toHaveAttribute('href', 'mailto:info@example.com');
  });

  it('shows HTML inside a code block as text', () => {
    const { container } = renderMarkdown('```html\n<script>alert(1)</script>\n```');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('Markdown rendering', () => {
  it('renders GFM tables, lists and read-only checkboxes', () => {
    const { container } = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n\n- eins\n- [x] zwei\n');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(container.querySelector('input[type="checkbox"]')).toBeDisabled();
  });

  it('labels code blocks with their language and offers a copy button', () => {
    renderMarkdown('```python\nprint(1)\n```');
    expect(screen.getByText('python')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Code kopieren' })).toBeInTheDocument();
  });

  it('hands tables and code blocks with their source to the block action', () => {
    const action = vi.fn(() => null);
    const text = 'Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nx\n```\n';
    renderMarkdown(text, { blockAction: action });
    expect(action).toHaveBeenCalledWith({ kind: 'table', source: '| a | b |\n| - | - |\n| 1 | 2 |', language: null });
    expect(action).toHaveBeenCalledWith({ kind: 'code', source: '```ts\nx\n```', language: 'ts' });
  });

  it('closes an open code fence while streaming', () => {
    const { container } = renderMarkdown('```\nhalf', { streaming: true });
    expect(container.querySelector('pre')?.textContent).toBe('half\n');
  });
});
