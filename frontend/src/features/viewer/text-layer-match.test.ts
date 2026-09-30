import { describe, expect, it } from 'vitest';
import { escapeHtml, matchTextItems } from './text-layer-match';

const ITEMS = ['Technische Daten', 'Die Mira L hat die Schutz-', 'art IP66 und eine', 'Schlagfestigkeit von IK09.', 'Gewicht 7,4 kg'];

describe('matchTextItems', () => {
  it('marks the items that carry the passage, across line breaks and hyphenation', () => {
    const matched = matchTextItems(ITEMS, 'Die Mira L hat die Schutzart IP66 und eine Schlagfestigkeit von IK09.');
    expect([...matched]).toEqual([1, 2, 3]);
  });

  it('finds a passage whose middle differs by its start and its end', () => {
    const matched = matchTextItems(ITEMS, 'Die Mira L hat die Schutzart IP 66 und eine Schlagfestigkeit von IK09.');
    expect([...matched]).toEqual([1, 2, 3]);
  });

  it('returns nothing when the passage is not on the page', () => {
    expect(matchTextItems(ITEMS, 'Ein ganz anderer Satz, der hier nicht steht.').size).toBe(0);
    expect(matchTextItems([], 'Die Mira').size).toBe(0);
    expect(matchTextItems(ITEMS, '   ').size).toBe(0);
  });
});

describe('escapeHtml', () => {
  it('escapes markup from the document text', () => {
    expect(escapeHtml('<img src=x onerror="a()"> & \'b\'')).toBe(
      '&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;b&#39;',
    );
  });
});
