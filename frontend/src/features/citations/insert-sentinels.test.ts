import { describe, expect, it } from 'vitest';
import { insertSentinels, SENTINEL_PATTERN, stripSentinels } from './insert-sentinels';

const at = (offset: number, n: number) => ({ offset, n });

describe('insertSentinels', () => {
  it('places a chip at a sentence end', () => {
    const text = 'Die Mira hat IP66. Sie wiegt 7 kg.';
    expect(insertSentinels(text, [at(18, 1)])).toBe('Die Mira hat IP66.⟦c:1⟧ Sie wiegt 7 kg.');
  });

  it('moves a chip at a block end before the trailing blank lines', () => {
    expect(insertSentinels('Erster Absatz.\n\nZweiter.', [at(16, 1)])).toBe('Erster Absatz.⟦c:1⟧\n\nZweiter.');
  });

  it('keeps a chip inside the last table cell instead of opening a new one', () => {
    const text = '| Größe | Wert |\n| --- | --- |\n| Schutzart | IP66 |\n';
    expect(insertSentinels(text, [at(text.length, 2)])).toBe(
      '| Größe | Wert |\n| --- | --- |\n| Schutzart | IP66⟦c:2⟧ |\n',
    );
  });

  it('puts a chip at the end of a list item', () => {
    const text = '- IP66\n- IK08\n';
    expect(insertSentinels(text, [at(7, 1), at(14, 2)])).toBe('- IP66⟦c:1⟧\n- IK08⟦c:2⟧\n');
  });

  it('merges several citations at the same offset into one ordered, deduplicated run', () => {
    expect(insertSentinels('IP66.', [at(5, 3), at(5, 1), at(5, 3)])).toBe('IP66.⟦c:1⟧⟦c:3⟧');
  });

  it('drops chips that would land inside or on a code block', () => {
    const text = 'Beispiel:\n\n```\nIP66\n```\n';
    expect(insertSentinels(text, [at(17, 1), at(text.length, 2)])).toBe(text);
  });

  it('counts offsets in code points like the backend, not UTF-16 units', () => {
    // "𝐈" is one code point but two UTF-16 units.
    expect(insertSentinels('𝐈P66. Ende.', [at(5, 1)])).toBe('𝐈P66.⟦c:1⟧ Ende.');
  });

  it('clamps offsets beyond the text', () => {
    expect(insertSentinels('Kurz.', [at(99, 1)])).toBe('Kurz.⟦c:1⟧');
  });

  it('neutralizes sentinel-like text from the model, so it can never become a chip', () => {
    const text = 'Das Dokument schreibt ⟦c:9⟧ wörtlich. Ende.';
    const marked = insertSentinels(text, [at(text.indexOf('Ende.') + 5, 1)]);
    expect([...marked.matchAll(SENTINEL_PATTERN)].map((m) => m[1])).toEqual(['1']);
    // Offsets still refer to the original text, and the literal text reads the same.
    expect(marked.endsWith('Ende.⟦c:1⟧')).toBe(true);
    expect(stripSentinels(marked)).toBe(text);
  });

  it('neutralizes forged sentinels even without any real citation', () => {
    expect([...insertSentinels('⟦c:1⟧⟦c:2⟧', []).matchAll(SENTINEL_PATTERN)]).toHaveLength(0);
  });

  it('can be stripped again', () => {
    const marked = insertSentinels('A. B.', [at(2, 1), at(5, 2)]);
    expect(stripSentinels(marked)).toBe('A. B.');
    expect([...marked.matchAll(SENTINEL_PATTERN)].map((m) => m[1])).toEqual(['1', '2']);
  });
});
