import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import de from '../../../messages/de.json';
import { Markdown } from '@/shared/markdown';
import { TooltipProvider } from '@/shared/ui';
import { CITATION_ATTRIBUTE, GROUP_ATTRIBUTE, remarkCitations } from './remark-citations';

function chips(text: string) {
  const { container } = render(
    <NextIntlClientProvider locale="de" messages={de}>
      <TooltipProvider>
        <Markdown
          text={text}
          remarkPlugins={[remarkCitations]}
          components={{
            span: (props) => {
              const attributes = props as Record<string, unknown>;
              if (attributes[GROUP_ATTRIBUTE] !== undefined) return <span className="group">{props.children}</span>;
              const n = attributes[CITATION_ATTRIBUTE];
              return n ? <button type="button">{`[${String(n)}]`}</button> : <span>{props.children}</span>;
            },
          }}
        />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
  return container;
}

describe('remarkCitations', () => {
  it('turns sentinels in a paragraph into chips at the right place', () => {
    const container = chips('Die Mira hat **IP66**.⟦c:1⟧ Sie wiegt 7 kg.⟦c:2⟧⟦c:3⟧');
    expect(container.querySelector('p')?.textContent).toBe('Die Mira hat IP66.[1] Sie wiegt 7 kg.[2][3]');
    expect(container.querySelectorAll('button')).toHaveLength(3);
  });

  it('works inside table cells and list items', () => {
    const container = chips('| a | b |\n| - | - |\n| IP66⟦c:1⟧ | IK08⟦c:2⟧ |\n\n- Punkt⟦c:3⟧\n');
    expect(container.querySelector('tbody')?.textContent).toBe('IP66[1]IK08[2]');
    expect(container.querySelector('li')?.textContent).toBe('Punkt[3]');
  });

  it('removes sentinels from code and inline code', () => {
    const container = chips('`IP66⟦c:1⟧`\n\n```\nx⟦c:2⟧\n```');
    expect(container.querySelector('code')?.textContent).toBe('IP66');
    expect(container.querySelector('pre')?.textContent).toBe('x\n');
    expect(container.querySelectorAll('button[type="button"]:not([aria-label])')).toHaveLength(0);
  });

  it('moves a chip out of link text behind the link', () => {
    const container = chips('Siehe [Norm⟦c:1⟧](https://example.com) hier.');
    expect(container.querySelector('a')?.textContent).toBe('Norm');
    expect(container.querySelector('a button')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('Siehe Norm[1] hier.');
  });

  it('keeps the last word and its chips together so a chip never wraps alone', () => {
    const container = chips('Die Schutzart ist IP66.⟦c:1⟧⟦c:2⟧ Mehr.');
    expect([...container.querySelectorAll('.group')].map((g) => g.textContent)).toEqual(['IP66.[1][2]']);
  });

  it('leaves text without sentinels alone', () => {
    expect(chips('Nur Text.').querySelector('p')?.textContent).toBe('Nur Text.');
  });
});
